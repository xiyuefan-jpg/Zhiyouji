import { describe, expect, it } from "vitest";
import { balanceOf, balances, canSpendGrain, checkLedger, grainEntry, pointsEntry, reversalOf } from "../src/index.js";

describe("ledger", () => {
  const entries = [
    grainEntry({ id: "g1", teamId: "A", at: 1, amount: 60, source: "opening" }),
    grainEntry({ id: "g2", teamId: "A", at: 2, amount: -46, source: "attack", refId: "c1" }),
    pointsEntry({ id: "p1", teamId: "A", at: 3, amount: 396, source: "territory" }),
    grainEntry({ id: "g3", teamId: "B", at: 1, amount: 60, source: "opening" }),
  ];
  it("balances are sums of entries", () => {
    expect(balanceOf(entries, "A", "grain")).toBe(14);
    expect(balanceOf(entries, "A", "points")).toBe(396);
    expect(balances(entries, "grain")).toEqual(new Map([["A", 14], ["B", 60]]));
  });
  it("rejects non-integer amounts", () => {
    expect(() => grainEntry({ id: "x", teamId: "A", at: 1, amount: 1.5, source: "admin" })).toThrow();
    expect(() => pointsEntry({ id: "x", teamId: "A", at: 1, amount: 3.96, source: "admin" })).toThrow();
  });
  it("reversals cancel exactly", () => {
    const r = reversalOf(entries[1]!, "r1", 5, "admin cancelled the contest");
    expect(r).toMatchObject({ teamId: "A", currency: "grain", amount: 46, source: "reversal", reverses: "g2" });
    expect(balanceOf([...entries, r], "A", "grain")).toBe(60);
    expect(checkLedger([...entries, r])).toEqual([]);
  });
  it("frozen grain cannot be spent", () => {
    expect(canSpendGrain(entries, "B", 60)).toBe(true);
    expect(canSpendGrain(entries, "B", 60, 10)).toBe(false);
  });
  it("finds broken ledgers", () => {
    const bad = [
      grainEntry({ id: "g1", teamId: "A", at: 1, amount: 10, source: "opening" }),
      grainEntry({ id: "g2", teamId: "A", at: 2, amount: -20, source: "attack" }),
      { ...reversalOf(entries[0]!, "r1", 3), amount: -50 },
    ];
    const problems = checkLedger(bad);
    expect(problems.some((p) => p.includes("grain went negative"))).toBe(true);
    expect(problems.some((p) => p.includes("does not cancel"))).toBe(true);
  });
});
