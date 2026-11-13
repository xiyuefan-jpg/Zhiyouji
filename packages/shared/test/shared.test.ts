import { describe, expect, it } from "vitest";
import { childCreate, errorText, isMainlandMobile, loginRequest, maskPhone, SMS_TEMPLATE_OF, SMS_TEMPLATE_TEXT } from "../src/index.js";

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
});
