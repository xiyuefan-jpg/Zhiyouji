/**
 * File uploads behind a small interface (PRD part 5 §5: keep the file on the
 * device first, upload in the background, resume after a break, retry).
 * The website version uploads in chunks with fetch; the packaged app later
 * swaps in a native background uploader. The server hands out upload
 * tickets (OSS direct upload once the account exists).
 */

export interface UploadProgress {
  sent: number;
  total: number;
}

export interface Uploader {
  /** Upload a file for a submission; resolves with the stored file id. */
  upload(file: Blob, opts: { purpose: string; durationSec?: number | null; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal }): Promise<{ fileId: string }>;
}

/** Split a file into chunks for resumable upload. */
export function chunkRanges(size: number, chunkSize = 2 * 1024 * 1024): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < size; start += chunkSize) out.push({ start, end: Math.min(size, start + chunkSize) });
  return out;
}

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;
type Ticket = { url: string; method: "PUT"; headers: Record<string, string> };

/** How the uploader waits between tries; tests make it instant. */
export const uploadTiming = { retryWaitsMs: [1000, 3000, 8000], sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

/** PUT one piece, trying again after a short wait when the network fails (part 5 §5: 失败自动重试). */
async function putWithRetry(t: Ticket, body: Blob, signal?: AbortSignal): Promise<void> {
  const waits = uploadTiming.retryWaitsMs;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(t.url, { method: "PUT", headers: t.headers, body, signal });
      if (res.ok) return;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw Object.assign(new Error("上传没有成功，请再试一次"), { final: true });
    } catch (e) {
      if (signal?.aborted || (e as { final?: boolean }).final) throw e;
    }
    if (attempt >= waits.length) throw new Error("网络不太好，上传没有成功。再点一次上传，会从断开的地方接着传");
    await uploadTiming.sleep(waits[attempt]!);
  }
}

/** Remember unfinished big uploads on this device, so choosing the same file again resumes it. */
const RESUME_KEY = "zyj.uploads";
function fingerprint(prefix: string, purpose: string, file: Blob): string {
  const f = file as Blob & { name?: string; lastModified?: number };
  return [prefix, purpose, f.name ?? "", f.size, f.lastModified ?? 0, f.type].join("|");
}
function resumeGet(fp: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, string>)[fp] ?? null;
  } catch {
    return null;
  }
}
function resumeSet(fp: string, fileId: string | null): void {
  try {
    const m = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, string>;
    if (fileId) m[fp] = fileId;
    else delete m[fp];
    localStorage.setItem(RESUME_KEY, JSON.stringify(m));
  } catch {
    /* private mode: no resume across page loads, the upload still works */
  }
}

/**
 * The website's uploader for this server: ask for a ticket, PUT the bytes
 * straight to storage (OSS later, the server's dev storage now), confirm.
 * Big team files go up in parts (the server decides): only missing parts are
 * sent, each part is retried, and an interrupted upload of the same file
 * picks up where it stopped (断点续传).
 * `prefix` is "/v1/daily" (a child's own files) or "/v1/season" (team works).
 */
export function ticketUploader(prefix: "/v1/daily" | "/v1/season", request: Request): Uploader {
  return {
    async upload(file, opts) {
      const fp = fingerprint(prefix, opts.purpose, file);
      const resumed = prefix === "/v1/season" ? resumeGet(fp) : null;
      if (resumed) {
        try {
          const p = await request<{ partSize: number; parts: number; done: number[]; complete: boolean }>("GET", `${prefix}/uploads/${resumed}/parts`);
          if (!p.complete) await sendParts(prefix, request, resumed, file, p, opts);
          await request("POST", `${prefix}/uploads/${resumed}/complete`);
          resumeSet(fp, null);
          return { fileId: resumed };
        } catch (e) {
          if (opts.signal?.aborted) throw e;
          resumeSet(fp, null); // gone or broken: start again
        }
      }
      const t = await request<{ fileId: string; upload?: Ticket; multipart?: { partSize: number; parts: number } }>("POST", `${prefix}/uploads`, {
        kind: opts.purpose,
        // "audio/webm;codecs=opus" → "audio/webm": the server checks the bare type.
        contentType: (file.type || "application/octet-stream").split(";")[0]!.trim(),
        size: file.size,
        // Length of a video or recording, when known: the server refuses ones over the limit before any bytes move.
        ...(opts.durationSec != null && Number.isFinite(opts.durationSec) ? { durationSec: opts.durationSec } : {}),
      });
      opts.onProgress?.({ sent: 0, total: file.size });
      if (t.multipart) {
        resumeSet(fp, t.fileId);
        await sendParts(prefix, request, t.fileId, file, { ...t.multipart, done: [] }, opts);
        await request("POST", `${prefix}/uploads/${t.fileId}/complete`);
        resumeSet(fp, null);
        return { fileId: t.fileId };
      }
      await putWithRetry(t.upload!, file, opts.signal);
      opts.onProgress?.({ sent: file.size, total: file.size });
      await request("POST", `${prefix}/uploads/${t.fileId}/complete`);
      return { fileId: t.fileId };
    },
  };
}

/** Send the parts storage does not have yet, a few signed URLs at a time. */
async function sendParts(
  prefix: string,
  request: Request,
  fileId: string,
  file: Blob,
  plan: { partSize: number; parts: number; done: number[] },
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
): Promise<void> {
  const ranges = chunkRanges(file.size, plan.partSize);
  const done = new Set(plan.done);
  let sent = ranges.filter((_, i) => done.has(i + 1)).reduce((a, r) => a + (r.end - r.start), 0);
  opts.onProgress?.({ sent, total: file.size });
  const todo = ranges.map((_, i) => i + 1).filter((n) => !done.has(n));
  for (let i = 0; i < todo.length; i += 5) {
    const batch = todo.slice(i, i + 5);
    const { parts } = await request<{ parts: (Ticket & { partNumber: number })[] }>("POST", `${prefix}/uploads/${fileId}/parts`, { partNumbers: batch });
    for (const p of parts) {
      const r = ranges[p.partNumber - 1]!;
      await putWithRetry(p, file.slice(r.start, r.end), opts.signal);
      sent += r.end - r.start;
      opts.onProgress?.({ sent, total: file.size });
    }
  }
}

/**
 * Length of a chosen video or audio file in seconds, read from its metadata
 * in the browser; null when the browser cannot tell (then the server finds
 * out after the upload). Never waits more than `timeoutMs`.
 */
export function mediaDuration(file: Blob, timeoutMs = 5000): Promise<number | null> {
  const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
  if (!kind || typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => finish(null);
    el.src = url;
  });
}
