import { describe, expect, it } from "vitest";
import { ApiError, api } from "../src/api";
import { greeting, shortTime } from "../src/format";
import { pickMimeType } from "../src/platform/recorder";
import { chunkRanges } from "../src/platform/upload";
import { vi } from "vitest";

describe("website helpers", () => {
  it("greets and shows times in Beijing time", () => {
    expect(greeting(new Date("2027-01-04T00:30:00Z"))).toBe("早上好"); // 08:30 Beijing
    expect(greeting(new Date("2027-01-04T12:30:00Z"))).toBe("晚上好"); // 20:30
    expect(shortTime("2027-01-04T13:05:00Z")).toBe("1月4日 21:05");
  });

  it("recording format and upload chunks", () => {
    expect(pickMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeUndefined();
    expect(chunkRanges(5, 2)).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 5 }]);
  });

  it("network failures become a plain message", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const e = await api.me().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe("网络连不上，请检查一下网络再试");
    vi.unstubAllGlobals();
  });
});
