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
  upload(file: Blob, opts: { purpose: string; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal }): Promise<{ fileId: string }>;
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
        contentType: file.type || "application/octet-stream",
        size: file.size,
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
