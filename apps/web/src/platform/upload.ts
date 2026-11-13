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
