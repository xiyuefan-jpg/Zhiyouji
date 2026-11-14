import { describe, expect, it } from "vitest";
import type { SeasonState } from "@zhiyouji/engine";
import { ledgerDetail } from "../src/season/play.js";
import { sectionOf } from "../src/season/reports.js";

const s = { lands: { E1: { id: "E1" }, C1: { id: "C1" } }, contests: { K1: { landId: "E1" } } } as unknown as SeasonState;
const names = new Map([["E1", "火焰山"], ["C1", "谛听台"]]);

describe("ledger lines say what they were for (part 5 E6)", () => {
  it("lands, contests, weeks, items, the admin's reason, reversals", () => {
    expect(ledgerDetail(s, { source: "territory", refId: "land:E1", note: "D3" }, names)).toBe("火焰山 · D3");
    expect(ledgerDetail(s, { source: "attack", refId: "K1" }, names)).toBe("火焰山的争夺");
    expect(ledgerDetail(s, { source: "item_effect", refId: "K1", note: "jianbi" }, names)).toBe("火焰山的争夺（坚壁清野）");
    expect(ledgerDetail(s, { source: "war", refId: "war:2" }, names)).toBe("第 2 周周战争");
    expect(ledgerDetail(s, { source: "participation", refId: "participation:3" }, names)).toBe("第 3 周");
    expect(ledgerDetail(s, { source: "big_battle_line", refId: "line:0" }, names)).toBe("大团战第 1 条战线");
    expect(ledgerDetail(s, { source: "center_land", refId: "C1" }, names)).toBe("谛听台");
    expect(ledgerDetail(s, { source: "auction_bid", refId: "auction", note: "E1" }, names)).toBe("火焰山");
    expect(ledgerDetail(s, { source: "item_effect", refId: "shengsi", note: "E1" }, names)).toBe("生死簿 · 火焰山");
    expect(ledgerDetail(s, { source: "admin", refId: "admin:x", note: "补发军需" }, names)).toBe("老师：补发军需");
    expect(ledgerDetail(s, { source: "attack", refId: "K1", reverses: "L9" }, names)).toBe("冲正 · 火焰山的争夺");
    expect(ledgerDetail(s, { source: "opening" }, names)).toBeNull();
  });
});

describe("report sections (part 5 F1)", () => {
  it("each feed kind has a section", () => {
    expect(["contest_captured", "war_result", "supply_result", "item_used", "center_bought", "big_battle_result", "season_paused"].map(sectionOf)).toEqual(["contest", "war", "supply", "item", "shop", "battle", "other"]);
  });
});
