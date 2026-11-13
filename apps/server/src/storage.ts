/**
 * Object storage for uploaded works (PRD part 2 §4.5): the website gets an
 * upload ticket and sends the bytes straight to storage (Aliyun OSS with a
 * presigned PUT); the server never carries large files. Until OSS is set up,
 * `LocalStorage` keeps files in memory (or a folder) and the server itself
 * serves the upload and download URLs under /v1/dev-storage.
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
}

const TICKET_MS = 60 * 60_000;

/** Development and tests: objects in memory (or under `dir`), served by the API's /v1/dev-storage routes. */
export class LocalStorage implements ObjectStorage {
  private mem = new Map<string, { bytes: Buffer; contentType: string }>();

  constructor(
    private readonly secret: string,
    private readonly dir?: string,
  ) {}

  sign(key: string, op: "put" | "get", expiresAt: number): string {
    return createHmac("sha256", this.secret).update(`${op}\n${key}\n${expiresAt}`).digest("hex");
  }

  verify(key: string, op: "put" | "get", expiresAt: number, sig: string, now: number): boolean {
    if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
    const want = Buffer.from(this.sign(key, op, expiresAt));
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
}
