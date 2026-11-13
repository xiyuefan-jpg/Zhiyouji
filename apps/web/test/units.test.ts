import { describe, expect, it } from "vitest";
import { ApiError, api } from "../src/api";
import { countdown, greeting, shortTime } from "../src/format";
import { pickMimeType } from "../src/platform/recorder";
import { chunkRanges } from "../src/platform/upload";
import { vi } from "vitest";

describe("website helpers", () => {
  it("greets and shows times in Beijing time", () => {
    expect(greeting(new Date("2027-01-04T00:30:00Z"))).toBe("早上好"); // 08:30 Beijing
    expect(greeting(new Date("2027-01-04T12:30:00Z"))).toBe("晚上好"); // 20:30
    expect(shortTime("2027-01-04T13:05:00Z")).toBe("1月4日 21:05");
  });

  it("countdowns: time left and the Beijing weekday time", () => {
    const wed21 = Date.parse("2027-01-06T13:00:00Z"); // Wednesday 21:00 Beijing
    expect(countdown(wed21, wed21 - (27 * 60 + 5) * 60_000)).toBe("还剩 1 天 3 小时（周三 21:00）");
    expect(countdown(wed21, wed21 - 125 * 60_000)).toBe("还剩 2 小时 5 分（周三 21:00）");
    expect(countdown(wed21, wed21 - 20_000)).toBe("还剩 1 分钟（周三 21:00）");
    expect(countdown(wed21, wed21)).toBe("已截止（周三 21:00）");
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

import { monthGrid, shiftMonth } from "../src/pages/JournalPages";

describe("修行日志 calendar helpers", () => {
  it("months shift across years; the grid starts on Monday", () => {
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2027-12", 1)).toBe("2028-01");
    const g = monthGrid("2027-02"); // 1 Feb 2027 is a Monday
    expect(g[0]).toBe("2027-02-01");
    expect(g.filter(Boolean)).toHaveLength(28);
    // 1 Jan 2027 is a Friday: four blanks first
    expect(monthGrid("2027-01").slice(0, 5)).toEqual([null, null, null, null, "2027-01-01"]);
  });
});
