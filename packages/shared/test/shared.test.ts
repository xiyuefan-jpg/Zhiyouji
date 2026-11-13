import { describe, expect, it } from "vitest";
import { childCreate, errorText, formatBeijing, isMainlandMobile, loginRequest, maskPhone, SMS_TEMPLATE_OF, SMS_TEMPLATE_TEXT } from "../src/index.js";

describe("shared", () => {
  it("checks mainland mobile numbers", () => {
    expect(isMainlandMobile("13812345678")).toBe(true);
    expect(isMainlandMobile("12812345678")).toBe(false);
    expect(isMainlandMobile("1381234567")).toBe(false);
    expect(maskPhone("13812345678")).toBe("138****5678");
  });

  it("validates login and child forms", () => {
    expect(loginRequest.safeParse({ phone: "13812345678", code: "123456" }).success).toBe(true);
    expect(loginRequest.safeParse({ phone: "13812345678", code: "12345" }).success).toBe(false);
    const c = childCreate.parse({ nickname: " 小明 ", grade: 4 });
    expect(c).toEqual({ nickname: "小明", grade: 4, avatar: "a1", explainPref: "voice" });
    expect(childCreate.safeParse({ nickname: "", grade: 4 }).success).toBe(false);
    expect(childCreate.safeParse({ nickname: "一二三四五六七八九十一二三", grade: 4 }).success).toBe(false);
    expect(childCreate.safeParse({ nickname: "a", grade: 11 }).success).toBe(false);
  });

  it("SMS texts never mention 游戏 and only four kinds send SMS", () => {
    for (const t of Object.values(SMS_TEMPLATE_TEXT)) expect(t).not.toContain("游戏");
    expect(Object.keys(SMS_TEMPLATE_OF).sort()).toEqual(["attacked", "joined_attack", "outbid", "supply_due", "work_due_6h"]);
    expect(errorText("nope")).toBe(errorText("bad_request"));
  });

  it("formats Beijing time", () => {
    expect(formatBeijing(Date.UTC(2027, 1, 9, 13, 0))).toBe("2月9日 21:00");
    expect(formatBeijing(Date.UTC(2027, 1, 9, 16, 5))).toBe("2月10日 00:05");
  });

  it("survey curiosity scores (content library 10.3)", async () => {
    const { curiosityScores } = await import("../src/index.js");
    const rounds = Array.from({ length: 8 }, (_, i) => [`q${2 * i + 1}`, `q${2 * i + 2}`, `q${2 * i + 1}`] as [string, string, string]);
    const s = curiosityScores({ rounds, final: "q1" });
    expect(s["物理与天文"]).toBe(4);
    expect(s["生命科学"]).toBe(2);
    expect(s["化学与材料"]).toBeUndefined();
  });
});
