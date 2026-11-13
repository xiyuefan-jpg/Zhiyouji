import { describe, expect, it } from "vitest";
import { allocateByPreference, createRng, resolveBlindAuction, resolveStarterItems } from "../src/index.js";

describe("blind auction (§8)", () => {
  const lands = ["L1", "L2", "L3", "L4"];
  it("highest bid first, earlier submission breaks ties, missing teams last", () => {
    const r = resolveBlindAuction({
      teams: ["A", "B", "C", "D"],
      lands,
      bids: [
        { teamId: "A", bid: 20, prefs: ["L1", "L2"], submittedAt: 2 },
        { teamId: "B", bid: 20, prefs: ["L1", "L3"], submittedAt: 1 },
        { teamId: "C", bid: 5, prefs: ["L1", "L2", "L3"], submittedAt: 3 },
      ],
      grain: { A: 60, B: 60, C: 60, D: 60 },
      rng: createRng(3),
    });
    expect(r.order).toEqual(["B", "A", "C", "D"]);
    const got = Object.fromEntries(r.assignments.map((a) => [a.teamId, [a.landId, a.paid]]));
    expect(got).toEqual({ B: ["L1", 20], A: ["L2", 20], C: ["L3", 5], D: ["L4", 0] });
  });
  it("a bid above the team's grain is capped", () => {
    const r = resolveBlindAuction({
      teams: ["A", "B"],
      lands: ["L1", "L2"],
      bids: [{ teamId: "A", bid: 999, prefs: ["L1"], submittedAt: 1 }],
      grain: { A: 60, B: 60 },
      rng: createRng(1),
    });
    expect(r.assignments.find((a) => a.teamId === "A")?.paid).toBe(60);
  });
});

describe("starter items (§8)", () => {
  it("picks in reverse auction order with limited stock and no duplicates", () => {
    const kinds = ["huanhun", "yujing", "jianbi", "bihuo", "taixu"];
    const allWant = ["yujing", "taixu", "huanhun", "jianbi", "bihuo"];
    const r = resolveStarterItems({
      auctionOrder: ["A", "B", "C", "D"],
      prefs: { A: allWant, B: allWant, C: allWant, D: allWant },
      kinds,
      stockPerKind: 2,
      freeItems: 2,
      rng: createRng(1),
    });
    const byTeam: Record<string, string[]> = {};
    for (const a of r) (byTeam[a.teamId] ??= []).push(a.item);
    expect(byTeam).toEqual({
      D: ["yujing", "huanhun"],
      C: ["yujing", "huanhun"],
      B: ["taixu", "jianbi"],
      A: ["taixu", "jianbi"],
    });
  });
});

describe("allocate by preference", () => {
  it("repeats rounds until nothing more can be assigned", () => {
    const grain: Record<string, number> = { A: 100, B: 200 };
    const r = allocateByPreference({
      order: [
        { teamId: "A", prefs: ["x", "y"] },
        { teamId: "B", prefs: ["x", "y"] },
      ],
      stock: { x: 2, y: 2 },
      rounds: "untilExhausted",
      canTake: (t) => (grain[t] ?? 0) >= 80,
      onTake: (t) => {
        grain[t] = (grain[t] ?? 0) - 80;
      },
    });
    expect(r).toEqual([
      { teamId: "A", item: "x", round: 1 },
      { teamId: "B", item: "x", round: 1 },
      { teamId: "B", item: "y", round: 2 },
    ]);
  });
});
