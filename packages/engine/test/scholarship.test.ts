import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS as P, computeScholarship, pts } from "../src/index.js";

describe("scholarship (§15)", () => {
  const ranked = [180, 150, 130, 110, 95, 80, 70, 60].map((p, i) => ({ teamId: `t${i + 1}`, points: pts(p) }));
  it("rank shares decay by 0.72 (30.2 / 21.7 / 15.6 / 11.3 / 8.1 / 5.8 / 4.2 / 3.0 %)", () => {
    const lines = computeScholarship(ranked, 5000, P);
    expect(lines.map((l) => Math.round(l.rankShare * 1000) / 10)).toEqual([30.2, 21.7, 15.6, 11.3, 8.1, 5.8, 4.2, 3.0]);
  });
  it("whole yuan that add up to the pool", () => {
    const lines = computeScholarship(ranked, 5000, P);
    expect(lines.every((l) => Number.isInteger(l.yuan))).toBe(true);
    expect(lines.reduce((a, l) => a + l.yuan, 0)).toBe(5000);
    expect(lines[0]!.yuan).toBeGreaterThan(lines[7]!.yuan * 5);
  });
  it("points ≤ 0 count as 0 in the score half", () => {
    const lines = computeScholarship(
      [
        { teamId: "a", points: pts(10) },
        { teamId: "b", points: pts(-5) },
      ],
      1000,
      P,
    );
    expect(lines[1]!.scoreShare).toBe(0);
  });
});
