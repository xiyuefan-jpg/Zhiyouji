import { afterEach, describe, expect, it, vi } from "vitest";
import { ticketUploader, uploadTiming } from "../src/platform/upload";

/**
 * A fake server for the uploader: multipart above 10 bytes in parts of 4,
 * storage remembers parts; `failNext` makes the next PUTs fail like a
 * dropped connection.
 */
function fakeServer() {
  const parts = new Map<number, number>();
  let fileId = 0;
  let failNext = 0;
  const calls: string[] = [];
  const request = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    calls.push(`${method} ${path}`);
    if (method === "POST" && path.endsWith("/uploads")) {
      const size = (body as { size: number }).size;
      fileId++;
      return (size > 10 ? { fileId: `f${fileId}`, multipart: { partSize: 4, parts: Math.ceil(size / 4) } } : { fileId: `f${fileId}`, upload: { url: "/put/whole", method: "PUT", headers: {} } }) as T;
    }
    if (method === "GET" && path.endsWith("/parts")) return { partSize: 4, parts: 4, done: [...parts.keys()].sort(), complete: false } as T;
    if (method === "POST" && path.endsWith("/parts"))
      return { parts: (body as { partNumbers: number[] }).partNumbers.map((n) => ({ partNumber: n, url: `/put/part/${n}`, method: "PUT", headers: {} })) } as T;
    if (path.endsWith("/complete")) {
      if (parts.size > 0 && parts.size < 4) throw new Error("upload_missing");
      return { ok: true } as T;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (failNext > 0) {
      failNext--;
      throw new TypeError("Failed to fetch");
    }
    const m = /\/put\/part\/(\d+)/.exec(url);
    if (m) parts.set(Number(m[1]), (init.body as Blob).size);
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { request, parts, calls, fetchMock, fail: (n: number) => (failNext = n) };
}

const file = (n: number) => new File([new Uint8Array(n)], "大视频.mp4", { type: "video/mp4", lastModified: 1 });

describe("uploader: parts, retries, resume (part 5 §5 断点续传)", () => {
  uploadTiming.retryWaitsMs = [0, 0, 0];
  afterEach(() => vi.unstubAllGlobals());

  it("a small file goes up whole; a dropped connection is retried", async () => {
    const s = fakeServer();
    s.fail(2);
    const up = ticketUploader("/v1/season", s.request);
    expect(await up.upload(file(5), { purpose: "video", durationSec: 30 })).toEqual({ fileId: "f1" });
    expect(s.fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a big file goes up in parts with progress", async () => {
    const s = fakeServer();
    const seen: number[] = [];
    await ticketUploader("/v1/season", s.request).upload(file(13), { purpose: "video", onProgress: (p) => seen.push(p.sent) });
    expect([...s.parts.entries()].sort()).toEqual([[1, 4], [2, 4], [3, 4], [4, 1]]);
    expect(seen.at(-1)).toBe(13);
  });

  it("the network stays down: the upload stops; choosing the same file again sends only the missing parts", async () => {
    const s = fakeServer();
    const up = ticketUploader("/v1/season", s.request);
    // parts 1 and 2 go up, then four failures in a row (more than the retries)
    let n = 0;
    const orig = s.fetchMock.getMockImplementation()!;
    s.fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (++n > 2 && n <= 6) throw new TypeError("Failed to fetch");
      return orig(url, init);
    });
    await expect(up.upload(file(13), { purpose: "video" })).rejects.toThrow("接着传");
    expect([...s.parts.keys()].sort()).toEqual([1, 2]);
    s.calls.length = 0;
    expect(await up.upload(file(13), { purpose: "video" })).toEqual({ fileId: "f1" });
    expect(s.calls).toEqual(["GET /v1/season/uploads/f1/parts", "POST /v1/season/uploads/f1/parts", "POST /v1/season/uploads/f1/complete"]);
    expect([...s.parts.keys()].sort()).toEqual([1, 2, 3, 4]);
    // finished: the next upload of the same file is a new one
    expect((await up.upload(file(13), { purpose: "video" })).fileId).toBe("f2");
  });
});
