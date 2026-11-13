import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS as P, attackCost, meritPoints, resolveContest } from "../src/index.js";

describe("attack cost (§10.1)", () => {
  it("matches the PRD example: 1 active attack, 2 lands, target is first → 46", () => {
    expect(attackCost({ activeAttacks: 1, heldLands: 2, targetOwnerIsFirst: true }, P).cost).toBe(46);
  });
  it("流亡令 halves the cost for a team with no land", () => {
    expect(attackCost({ activeAttacks: 0, heldLands: 0, targetOwnerIsFirst: false }, P)).toEqual({
      cost: 15,
      base: 30,
      exile: true,
      crusade: false,
    });
  });
  it("discounts stack and round up", () => {
    expect(attackCost({ activeAttacks: 0, heldLands: 0, targetOwnerIsFirst: true }, P).cost).toBe(11);
    expect(attackCost({ activeAttacks: 0, heldLands: 2, targetOwnerIsFirst: true }, P).cost).toBe(35);
  });
});

describe("contest resolution (§10.6)", () => {
  const att = (teamId: string, score: number | null, order: number) => ({ teamId, score, order });
  it("defender wins ties", () => {
    expect(resolveContest({ attackers: [att("A", 70, 0)], defender: { teamId: "D", score: 70 } }, P)).toEqual({
      kind: "defended",
      defender: "D",
    });
    expect(resolveContest({ attackers: [att("A", 70.5, 0)], defender: { teamId: "D", score: 70 } }, P).kind).toBe(
      "captured",
    );
  });
  it("undefended land needs the quality line", () => {
    expect(resolveContest({ attackers: [att("A", 50, 0)], defender: { teamId: "D", score: null } }, P).kind).toBe(
      "captured",
    );
    expect(resolveContest({ attackers: [att("A", 49.9, 0)], defender: { teamId: "D", score: null } }, P).kind).toBe(
      "nothing",
    );
  });
  it("among attackers, the highest wins and the earlier one breaks ties", () => {
    const r = resolveContest(
      { attackers: [att("B", 80, 1), att("A", 80, 0), att("C", 60, 2)], defender: { teamId: "D", score: 75 } },
      P,
    );
    expect(r).toEqual({ kind: "captured", winner: "A", winningScore: 80 });
  });
  it("attackers who did not submit do not compete", () => {
    expect(resolveContest({ attackers: [att("A", null, 0)], defender: { teamId: "D", score: 10 } }, P).kind).toBe(
      "defended",
    );
    expect(resolveContest({ attackers: [att("A", null, 0)], defender: { teamId: "D", score: null } }, P).kind).toBe(
      "nothing",
    );
  });
  it("merit points, doubled by 九转兵劫印", () => {
    expect(meritPoints("capture", false, P)).toBe(4);
    expect(meritPoints("defend", true, P)).toBe(6);
  });
});
