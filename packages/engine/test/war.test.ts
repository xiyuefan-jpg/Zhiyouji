import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  COMMON_ITEMS,
  byeAward,
  createRng,
  drawGiftCards,
  isGiftWeek,
  openLoserChest,
  pairKey,
  pairWeeklyWar,
  settleWarMatch,
} from "../src/index.js";

describe("weekly war pairing (§11)", () => {
  const ranked = ["A", "B", "C", "D", "E", "F", "G", "H"];
  it("pairs 1 v 2, 3 v 4, … by rank", () => {
    expect(pairWeeklyWar(ranked, new Set())).toEqual({
      pairs: [["A", "B"], ["C", "D"], ["E", "F"], ["G", "H"]],
      bye: null,
      repeats: 0,
    });
  });
  it("swaps with the neighbouring pair to avoid a repeat", () => {
    const r = pairWeeklyWar(ranked, new Set([pairKey("A", "B")]));
    expect(r.pairs).toEqual([["A", "C"], ["B", "D"], ["E", "F"], ["G", "H"]]);
    expect(r.repeats).toBe(0);
  });
  it("odd count: the last team gets the bye", () => {
    expect(pairWeeklyWar(ranked.slice(0, 7), new Set()).bye).toBe("G");
    expect(byeAward(P)).toBe(500);
  });
  it("repeats only when unavoidable", () => {
    expect(pairWeeklyWar(["A", "B"], new Set([pairKey("A", "B")]))).toEqual({
      pairs: [["A", "B"]],
      bye: null,
      repeats: 1,
    });
  });
});

describe("weekly war settlement (§11, §20.3)", () => {
  it("win +15, lose −5 and the loser opens a chest", () => {
    const [a, b] = settleWarMatch({ teamId: "A", score: 80 }, { teamId: "B", score: 70 }, P);
    expect(a).toEqual({ teamId: "A", outcome: "win", points: 1500, chest: false });
    expect(b).toEqual({ teamId: "B", outcome: "lose", points: -500, chest: true });
  });
  it("大闹天宫: +25 / −10; 玉净瓶: a loss costs nothing but the chest still opens", () => {
    expect(settleWarMatch({ teamId: "A", score: 80, danao: true }, { teamId: "B", score: 70 }, P)[0].points).toBe(2500);
    expect(settleWarMatch({ teamId: "A", score: 60, danao: true }, { teamId: "B", score: 70 }, P)[0].points).toBe(-1000);
    expect(settleWarMatch({ teamId: "A", score: 60, yujing: true }, { teamId: "B", score: 70 }, P)[0]).toMatchObject({
      points: 0,
      chest: true,
    });
    expect(
      settleWarMatch({ teamId: "A", score: 60, yujing: true, danao: true }, { teamId: "B", score: 70 }, P)[0].points,
    ).toBe(0);
  });
  it("tie: both +5, no chest", () => {
    const r = settleWarMatch({ teamId: "A", score: 70, danao: true }, { teamId: "B", score: 70 }, P);
    expect(r.map((x) => [x.outcome, x.points, x.chest])).toEqual([
      ["tie", 500, false],
      ["tie", 500, false],
    ]);
  });
  it("missing submissions", () => {
    const one = settleWarMatch({ teamId: "A", score: null }, { teamId: "B", score: 10 }, P);
    expect(one.map((x) => [x.outcome, x.points, x.chest])).toEqual([
      ["lose", -500, false],
      ["win", 1500, false],
    ]);
    expect(settleWarMatch({ teamId: "A", score: null, yujing: true }, { teamId: "B", score: 10 }, P)[0].points).toBe(0);
    const none = settleWarMatch({ teamId: "A", score: null }, { teamId: "B", score: null }, P);
    expect(none.map((x) => x.points)).toEqual([-500, -500]);
    expect(none.some((x) => x.chest)).toBe(false);
  });
});

describe("chests and cards", () => {
  it("loser chest: each common item about 20%", () => {
    const rng = createRng(42);
    const tally: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) {
      const k = openLoserChest(rng);
      tally[k] = (tally[k] ?? 0) + 1;
    }
    for (const k of COMMON_ITEMS) expect(tally[k]! / 5000).toBeGreaterThan(0.17);
  });
  it("gift weeks and card draws", () => {
    expect([1, 2, 3, 4].map((w) => isGiftWeek(w, P))).toEqual([false, true, false, true]);
    const cards = drawGiftCards(["S1", "S2", "S3", "R1", "R2"], createRng(1));
    expect(new Set(cards).size).toBe(3);
  });
});
