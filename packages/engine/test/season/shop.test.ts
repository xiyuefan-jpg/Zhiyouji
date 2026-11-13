import { describe, expect, it } from "vitest";
import { pts } from "../../src/index.js";
import {
  addGrain,
  addPoints,
  bidEpic,
  buyShopItem,
  closeEpicAuction,
  epicAuctionsStartAt,
  frozenGrain,
  grainOf,
  openEpicAuctions,
  runRareRound,
  shopClosesAt,
  shopOpensAt,
  spendableGrain,
  startContest,
  type SeasonState,
} from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

function rich(): SeasonState {
  const s = withOwners(newSeason(), defaultOwners);
  s.teamOrder.forEach((t, i) => {
    addPoints(s, t, pts(100 - i * 10), "admin", at(14, 0));
    addGrain(s, t, 440, "admin", at(14, 0)); // 500 grain each
  });
  return s;
}

describe("shop window", () => {
  it("opens D15 morning, closes D17 21:00", () => {
    const s = rich();
    expect(shopOpensAt(s)).toBe(at(15, 7));
    expect(shopClosesAt(s)).toBe(at(17, 21));
    expect(epicAuctionsStartAt(s)).toBe(at(15, 19));
    expect(buyShopItem(s, { teamId: "T1", itemId: "yujing", at: at(15, 6) })).toMatchObject({ refusal: "shop_closed" });
    expect(buyShopItem(s, { teamId: "T1", itemId: "yujing", at: at(17, 21, 1) })).toMatchObject({ refusal: "shop_closed" });
  });
});

describe("common and rare items", () => {
  it("common: 50, one per kind, at most 3 items", () => {
    let s = rich();
    s = ok(buyShopItem(s, { teamId: "T1", itemId: "yujing", at: at(15, 8) }));
    expect(grainOf(s, "T1")).toBe(450);
    expect(buyShopItem(s, { teamId: "T1", itemId: "yujing", at: at(15, 8) })).toMatchObject({ refusal: "already_have_kind" });
    s = ok(buyShopItem(s, { teamId: "T1", itemId: "zhencha", at: at(15, 8) }));
    s = ok(buyShopItem(s, { teamId: "T1", itemId: "bihuo", at: at(15, 8) }));
    expect(buyShopItem(s, { teamId: "T1", itemId: "taixu", at: at(15, 8) })).toMatchObject({ refusal: "shop_limit" });
    expect(s.teams.T1!.items.map((i) => i.itemId)).toEqual(["yujing", "zhencha", "bihuo"]);
  });
  it("rare: allocation at D15 21:00 last place first, then first come first served", () => {
    let s = rich();
    expect(buyShopItem(s, { teamId: "T1", itemId: "zijin", at: at(15, 8) })).toMatchObject({ refusal: "rare_round_pending" });
    const prefs = { T1: ["zijin"], T7: ["zijin", "dianhua"], T8: ["zijin", "zijin", "dianhua"], T5: ["zijin"] };
    expect(runRareRound(s, { at: at(15, 20), prefs })).toMatchObject({ refusal: "before_deadline" });
    s = ok(runRareRound(s, { at: at(15, 21), prefs }));
    // T8 then T7 take the 2 zijin; round 2: T8 dianhua, T7 dianhua
    const held = (t: string) => s.teams[t]!.items.map((i) => i.itemId);
    expect(held("T8")).toEqual(["zijin", "dianhua"]);
    expect(held("T7")).toEqual(["zijin", "dianhua"]);
    expect(held("T1")).toEqual([]);
    expect(s.shop.rareStock.zijin).toBe(0);
    expect(grainOf(s, "T8")).toBe(500 - 160);
    expect(buyShopItem(s, { teamId: "T1", itemId: "zijin", at: at(16, 8) })).toMatchObject({ refusal: "out_of_stock" });
    s = ok(buyShopItem(s, { teamId: "T1", itemId: "sanmei", at: at(16, 8) }));
    expect(s.shop.rareStock.sanmei).toBe(1);
  });
});

describe("epic auctions (§13.3)", () => {
  function open(): SeasonState {
    return ok(openEpicAuctions(rich(), { at: at(15, 19) }));
  }
  it("opens three auctions; bids start at 150 and rise by 10; grain is frozen while leading", () => {
    let s = open();
    expect(s.shop.auctions.map((a) => a.itemId)).toEqual(["bagua", "qibao", "diaobing"]);
    expect(bidEpic(s, { teamId: "T1", itemId: "bagua", amount: 140, at: at(15, 20) })).toMatchObject({ refusal: "too_low" });
    s = ok(bidEpic(s, { teamId: "T1", itemId: "bagua", amount: 150, at: at(15, 20) }));
    expect(frozenGrain(s, "T1")).toBe(150);
    expect(spendableGrain(s, "T1")).toBe(350);
    expect(bidEpic(s, { teamId: "T2", itemId: "bagua", amount: 155, at: at(15, 21) })).toMatchObject({ refusal: "too_low" });
    s = ok(bidEpic(s, { teamId: "T2", itemId: "bagua", amount: 160, at: at(15, 21) }));
    expect(frozenGrain(s, "T1")).toBe(0);
    expect(bidEpic(s, { teamId: "T2", itemId: "qibao", amount: 150, at: at(15, 21) })).toMatchObject({ refusal: "leading_elsewhere" });
    s = ok(bidEpic(s, { teamId: "T1", itemId: "qibao", amount: 150, at: at(15, 22) }));
  });
  it("frozen grain cannot be spent elsewhere", () => {
    let s = open();
    s = ok(bidEpic(s, { teamId: "T1", itemId: "bagua", amount: 480, at: at(15, 20) }));
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(15, 20) })).toMatchObject({ refusal: "not_enough_grain" });
  });
  it("anti-snipe extends by 10 minutes; the leader pays at the end and gets the item", () => {
    let s = open();
    s = ok(bidEpic(s, { teamId: "T1", itemId: "bagua", amount: 150, at: at(15, 20) }));
    s = ok(bidEpic(s, { teamId: "T2", itemId: "bagua", amount: 170, at: at(16, 18, 55) }));
    s = ok(bidEpic(s, { teamId: "T3", itemId: "qibao", amount: 150, at: at(16, 18, 58) }));
    s = ok(bidEpic(s, { teamId: "T4", itemId: "qibao", amount: 160, at: at(16, 19, 5) }));
    expect(s.shop.auctions[0]!.endAt).toBe(at(16, 19, 10));
    expect(closeEpicAuction(s, { itemId: "bagua", at: at(16, 19, 5) })).toMatchObject({ refusal: "not_ended" });
    s = ok(closeEpicAuction(s, { itemId: "bagua", at: at(16, 19, 10) }));
    expect(s.shop.auctions[0]).toMatchObject({ closed: true, winner: "T2" });
    expect(grainOf(s, "T2")).toBe(330);
    expect(s.teams.T2!.items.map((i) => [i.itemId, i.source])).toEqual([["bagua", "auction"]]);
    // one epic per team
    expect(bidEpic(s, { teamId: "T2", itemId: "qibao", amount: 150, at: at(16, 19, 11) })).toMatchObject({ refusal: "epic_limit" });
    // unsold
    s = ok(closeEpicAuction(s, { itemId: "diaobing", at: at(16, 19, 11) }));
    expect(s.shop.auctions[2]).toMatchObject({ closed: true, winner: null });
  });
  it("a leading bid reserves one of the 3 slots", () => {
    let s = open();
    s = ok(buyShopItem(s, { teamId: "T1", itemId: "yujing", at: at(15, 20) }));
    s = ok(buyShopItem(s, { teamId: "T1", itemId: "bihuo", at: at(15, 20) }));
    s = ok(bidEpic(s, { teamId: "T1", itemId: "bagua", amount: 150, at: at(15, 20) }));
    expect(buyShopItem(s, { teamId: "T1", itemId: "taixu", at: at(15, 20) })).toMatchObject({ refusal: "shop_limit" });
    s = ok(buyShopItem(s, { teamId: "T2", itemId: "yujing", at: at(15, 20) }));
    s = ok(buyShopItem(s, { teamId: "T2", itemId: "bihuo", at: at(15, 20) }));
    s = ok(buyShopItem(s, { teamId: "T2", itemId: "taixu", at: at(15, 20) }));
    expect(bidEpic(s, { teamId: "T2", itemId: "bagua", amount: 160, at: at(15, 21) })).toMatchObject({ refusal: "shop_limit" });
  });
});
