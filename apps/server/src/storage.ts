/**
 * Object storage for uploaded works (PRD part 2 §4.5): the website gets an
 * upload ticket and sends the bytes straight to storage (Aliyun OSS with a
 * presigned PUT); the server never carries large files. Until OSS is set up,
 * `LocalStorage` keeps files in memory (or a folder) and the server itself
 * serves the upload and download URLs under /v1/dev-storage.
 *
 * Big files (videos up to 500 MB) go up in parts (OSS multipart upload): the
 * website asks for a signed URL per part, a broken upload resumes with the
 * parts storage already has, and the server stitches them together at the end
 * (part 2 §4.5 断点续传).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface UploadTicket {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: number;
}

export interface ObjectStorage {
  uploadTicket(key: string, contentType: string, size: number, now: number): Promise<UploadTicket>;
  /** Size and type once the object is there; null if it is missing. */
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  /** A short-lived URL to read the object (players, reviewers). */
  downloadUrl(key: string, now: number): Promise<string>;
  /** Server-side write (data exports). */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Remove an object (account deletion). Missing objects are fine. */
  delete(key: string): Promise<void>;

  /** Start a multipart upload (OSS InitiateMultipartUpload). */
  startMultipart(key: string, contentType: string): Promise<{ uploadId: string }>;
  /** Signed URL for one part (1-based), like OSS UploadPart with a presigned URL. */
  partTicket(key: string, uploadId: string, partNumber: number, now: number): Promise<UploadTicket>;
  /** Parts already stored (OSS ListParts): what a resumed upload can skip. */
  listParts(key: string, uploadId: string): Promise<{ partNumber: number; size: number }[]>;
  /** Join the parts 1…n into the object (OSS CompleteMultipartUpload). */
  completeMultipart(key: string, uploadId: string, parts: number): Promise<void>;
}


const TICKET_MS = 60 * 60_000;

/** Development and tests: objects in memory (or under `dir`), served by the API's /v1/dev-storage routes. */
export class LocalStorage implements ObjectStorage {
  private mem = new Map<string, { bytes: Buffer; contentType: string }>();
  private multiparts = new Map<string, { key: string; contentType: string; parts: Map<number, Buffer> }>();
  private nextUpload = 1;

  constructor(
    private readonly secret: string,
    private readonly dir?: string,
  ) {}

  sign(key: string, op: "put" | "get" | "part", expiresAt: number, extra = ""): string {
    return createHmac("sha256", this.secret).update(`${op}\n${key}\n${expiresAt}${extra ? `\n${extra}` : ""}`).digest("hex");
  }

  verify(key: string, op: "put" | "get" | "part", expiresAt: number, sig: string, now: number, extra = ""): boolean {
    if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
    const want = Buffer.from(this.sign(key, op, expiresAt, extra));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private url(key: string, op: "put" | "get", now: number): { url: string; expiresAt: number } {
    const expiresAt = now + TICKET_MS;
    return { url: `/v1/dev-storage/${encodeURIComponent(key)}?op=${op}&exp=${expiresAt}&sig=${this.sign(key, op, expiresAt)}`, expiresAt };
  }

  async uploadTicket(key: string, contentType: string, _size: number, now: number): Promise<UploadTicket> {
    const { url, expiresAt } = this.url(key, "put", now);
    return { url, method: "PUT", headers: { "content-type": contentType }, expiresAt };
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    if (this.dir) {
      const p = join(this.dir, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, bytes);
      await writeFile(`${p}.type`, contentType);
    } else this.mem.set(key, { bytes, contentType });
  }

  async get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (this.dir) {
      try {
        const p = join(this.dir, key);
        return { bytes: await readFile(p), contentType: (await readFile(`${p}.type`)).toString() };
      } catch {
        return null;
      }
    }
    return this.mem.get(key) ?? null;
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    if (this.dir) {
      try {
        const p = join(this.dir, key);
        return { size: (await stat(p)).size, contentType: (await readFile(`${p}.type`)).toString() };
      } catch {
        return null;
      }
    }
    const o = this.mem.get(key);
    return o ? { size: o.bytes.length, contentType: o.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    if (this.dir) {
      const { rm } = await import("node:fs/promises");
      await rm(join(this.dir, key), { force: true });
      await rm(`${join(this.dir, key)}.type`, { force: true });
    } else this.mem.delete(key);
  }

  async downloadUrl(key: string, now: number): Promise<string> {
    return this.url(key, "get", now).url;
  }

  async startMultipart(key: string, contentType: string): Promise<{ uploadId: string }> {
    const uploadId = `mp${this.nextUpload++}-${createHmac("sha256", this.secret).update(key).digest("hex").slice(0, 8)}`;
    this.multiparts.set(uploadId, { key, contentType, parts: new Map() });
    return { uploadId };
  }

  async partTicket(key: string, uploadId: string, partNumber: number, now: number): Promise<UploadTicket> {
    const expiresAt = now + TICKET_MS;
    const extra = `${uploadId}\n${partNumber}`;
    const url = `/v1/dev-storage/${encodeURIComponent(key)}?op=part&exp=${expiresAt}&upload=${encodeURIComponent(uploadId)}&part=${partNumber}&sig=${this.sign(key, "part", expiresAt, extra)}`;
    return { url, method: "PUT", headers: {}, expiresAt };
  }

  /** The dev route stores one part (a repeated part replaces the earlier bytes, as in OSS). */
  async putPart(key: string, uploadId: string, partNumber: number, bytes: Buffer): Promise<boolean> {
    const m = this.multiparts.get(uploadId);
    if (!m || m.key !== key) return false;
    m.parts.set(partNumber, bytes);
    return true;
  }

  async listParts(key: string, uploadId: string): Promise<{ partNumber: number; size: number }[]> {
    const m = this.multiparts.get(uploadId);
    if (!m || m.key !== key) return [];
    return [...m.parts.entries()].sort((a, b) => a[0] - b[0]).map(([partNumber, b]) => ({ partNumber, size: b.length }));
  }

  async completeMultipart(key: string, uploadId: string, parts: number): Promise<void> {
    const m = this.multiparts.get(uploadId);
    if (!m || m.key !== key) throw new Error("no such upload");
    const chunks: Buffer[] = [];
    for (let n = 1; n <= parts; n++) {
      const b = m.parts.get(n);
      if (!b) throw new Error(`part ${n} missing`);
      chunks.push(b);
    }
    await this.put(key, Buffer.concat(chunks), m.contentType);
    this.multiparts.delete(uploadId);
  }
}
