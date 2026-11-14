/**
 * File uploads behind a small interface (PRD part 5 §5: keep the file on the
 * device first, upload in the background, resume after a break, retry).
 * The website version uploads in chunks with fetch; the packaged app later
 * swaps in a native background uploader. Server side (upload credentials,
 * OSS direct upload) is still to do — see PROGRESS.md.
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

/**
 * The website's uploader for this server: ask for a ticket, PUT the bytes
 * straight to storage (OSS later, the server's dev storage now), confirm.
 * `prefix` is "/v1/daily" (a child's own files) or "/v1/season" (team works).
 */
export function ticketUploader(prefix: "/v1/daily" | "/v1/season", request: <T>(method: string, path: string, body?: unknown) => Promise<T>): Uploader {
  return {
    async upload(file, opts) {
      const t = await request<{ fileId: string; upload: { url: string; method: "PUT"; headers: Record<string, string> } }>("POST", `${prefix}/uploads`, {
        kind: opts.purpose,
        // "audio/webm;codecs=opus" → "audio/webm": the server checks the bare type.
        contentType: (file.type || "application/octet-stream").split(";")[0]!.trim(),
        size: file.size,
        // Length of a video or recording, when known: the server refuses ones over the limit before any bytes move.
        ...(opts.durationSec != null && Number.isFinite(opts.durationSec) ? { durationSec: opts.durationSec } : {}),
      });
      opts.onProgress?.({ sent: 0, total: file.size });
      const res = await fetch(t.upload.url, { method: "PUT", headers: t.upload.headers, body: file, signal: opts.signal });
      if (!res.ok) throw new Error("上传没有成功，请再试一次");
      opts.onProgress?.({ sent: file.size, total: file.size });
      await request("POST", `${prefix}/uploads/${t.fileId}/complete`);
      return { fileId: t.fileId };
    },
  };
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
