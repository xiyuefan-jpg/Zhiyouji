import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  allocateRareItems,
  minimumBid,
  openEpicAuction,
  placeBid,
  settleEpicAuction,
  shopCheck,
  shopPrice,
  type BidContext,
  type EpicAuction,
} from "../src/index.js";

const ctx = (spendableGrain = 500): BidContext => ({ spendableGrain, leadingElsewhere: false, hasEpic: false });
const MIN = 60_000;

describe("shop rules (§13.3)", () => {
  it("prices and limits", () => {
    expect(shopPrice("bihuo", P)).toBe(50);
    expect(shopPrice("zijin", P)).toBe(80);
    expect(shopCheck("bihuo", { items: [] }, 50, 50, P)).toBeNull();
    expect(shopCheck("bihuo", { items: ["bihuo"] }, 99, 50, P)).toBe("already_have_kind");
    expect(shopCheck("taixu", { items: ["bihuo", "zijin", "sanmei"] }, 99, 50, P)).toBe("shop_limit");
    expect(shopCheck("taixu", { items: [] }, 49, 50, P)).toBe("not_enough_grain");
    expect(shopCheck("zijin", { items: [] }, 99, 80, P, 0)).toBe("out_of_stock");
  });
  it("rare items go to the last-placed teams first, one per round", () => {
    const r = allocateRareItems({
      reverseRankOrder: ["H", "G", "A"],
      prefs: { H: ["dianhua", "zijin"], G: ["dianhua", "zijin"], A: ["dianhua"] },
      stock: { dianhua: 2, zijin: 2 },
      spendableGrain: { H: 200, G: 100, A: 500 },
      bought: {},
      p: P,
    });
    expect(r).toEqual([
      { teamId: "H", item: "dianhua", round: 1 },
      { teamId: "G", item: "dianhua", round: 1 },
      { teamId: "H", item: "zijin", round: 2 },
    ]);
  });
});

describe("epic auction (§13.3)", () => {
  const start = 1_000_000_000_000;
  const fresh = (): EpicAuction => openEpicAuction("bagua", start, P);
  it("opens for 24 hours at 150 with +10 steps", () => {
    const a = fresh();
    expect(a.endAt - a.startAt).toBe(24 * 60 * MIN);
    expect(minimumBid(a, P)).toBe(150);
    expect(placeBid(a, { teamId: "A", amount: 140, at: start + MIN }, ctx(), P)).toEqual({ ok: false, refusal: "too_low" });
  });
  it("outbidding releases the previous leader's frozen grain", () => {
    let a = fresh();
    const r1 = placeBid(a, { teamId: "A", amount: 150, at: start + MIN }, ctx(), P);
    if (!r1.ok) throw new Error("bid refused");
    a = r1.auction;
    expect(minimumBid(a, P)).toBe(160);
    expect(placeBid(a, { teamId: "A", amount: 200, at: start + 2 * MIN }, ctx(), P)).toEqual({ ok: false, refusal: "already_leading" });
    const r2 = placeBid(a, { teamId: "B", amount: 160, at: start + 3 * MIN }, ctx(), P);
    expect(r2.ok && r2.releasedFor?.teamId).toBe("A");
  });
  it("a bid in the last 10 minutes pushes the end back by 10 minutes", () => {
    const a = fresh();
    const late = a.endAt - 5 * MIN;
    const r = placeBid(a, { teamId: "A", amount: 150, at: late }, ctx(), P);
    expect(r.ok && r.auction.endAt).toBe(a.endAt + 10 * MIN);
    const early = placeBid(a, { teamId: "A", amount: 150, at: a.endAt - 11 * MIN }, ctx(), P);
    expect(early.ok && early.auction.endAt).toBe(a.endAt);
  });
  it("one epic per team: no leading on two auctions, no bidding after winning one", () => {
    const a = fresh();
    expect(placeBid(a, { teamId: "A", amount: 150, at: start + MIN }, { ...ctx(), leadingElsewhere: true }, P)).toEqual({
      ok: false,
      refusal: "leading_elsewhere",
    });
    expect(placeBid(a, { teamId: "A", amount: 150, at: start + MIN }, { ...ctx(), hasEpic: true }, P)).toEqual({
      ok: false,
      refusal: "epic_limit",
    });
    expect(placeBid(a, { teamId: "A", amount: 150, at: start + MIN }, ctx(149), P)).toEqual({ ok: false, refusal: "not_enough_grain" });
  });
  it("settles after the end", () => {
    const a = fresh();
    const r = placeBid(a, { teamId: "A", amount: 150, at: start + MIN }, ctx(), P);
    if (!r.ok) throw new Error("bid refused");
    expect(settleEpicAuction(r.auction, a.endAt - 1)).toEqual({ done: false });
    expect(settleEpicAuction(r.auction, a.endAt)).toEqual({ done: true, winner: { teamId: "A", amount: 150, at: start + MIN } });
    expect(settleEpicAuction(a, a.endAt)).toEqual({ done: true, winner: null });
  });
});
