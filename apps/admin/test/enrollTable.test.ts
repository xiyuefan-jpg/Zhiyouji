import { describe, expect, it } from "vitest";
import { parseEnrollTable } from "../src/pages/SeasonSetupPages";

describe("表格批量开通: reading a pasted table (part 7 §3)", () => {
  it("tabs or commas; the header and empty lines are skipped; the nickname may be empty", () => {
    const text = "家长手机号\t昵称\t缴费备注\n13800000001\t小明\t订单 1001\n\n13800000002,,订单 1002\r\n13800000003，小红\n12345";
    expect(parseEnrollTable(text)).toEqual([
      { phone: "13800000001", nickname: "小明", paymentNote: "订单 1001" },
      { phone: "13800000002", paymentNote: "订单 1002" },
      { phone: "13800000003", nickname: "小红" },
    ]);
  });
});
