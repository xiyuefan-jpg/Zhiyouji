import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS as P, supplyGrain, supplyScore } from "../src/index.js";

describe("supply tasks (§12)", () => {
  it("participation is 40 × share of active members who submitted", () => {
    expect(supplyScore({ submittedMembers: 9, activeMembers: 9, quality: 30, summary: 15 }, P)).toBe(85);
    expect(supplyScore({ submittedMembers: 5, activeMembers: 10, quality: 20, summary: 0 }, P)).toBe(40);
    expect(supplyScore({ submittedMembers: 3, activeMembers: 3, quality: 99, summary: 99 }, P)).toBe(100);
  });
  it("grain tiers: < 50 → 10, 50–65 → 20, ≥ 65 → 30, nobody → 0", () => {
    expect([40, 49.99, 50, 64.99, 65, 100].map((s) => supplyGrain(s, true, P))).toEqual([10, 10, 20, 20, 30, 30]);
    expect(supplyGrain(0, false, P)).toBe(0);
  });
});
