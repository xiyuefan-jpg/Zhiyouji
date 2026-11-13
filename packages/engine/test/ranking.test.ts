import { describe, expect, it } from "vitest";
import { createRng, rankTeams } from "../src/index.js";

describe("ranking (§1)", () => {
  it("orders by points, then war wins, then merit count", () => {
    const r = rankTeams(
      [
        { teamId: "a", points: 1000, warWins: 1, meritCount: 0 },
        { teamId: "b", points: 1200, warWins: 0, meritCount: 0 },
        { teamId: "c", points: 1000, warWins: 2, meritCount: 0 },
        { teamId: "d", points: 1000, warWins: 2, meritCount: 3 },
      ],
      createRng(1),
    );
    expect(r.map((t) => t.teamId)).toEqual(["b", "d", "c", "a"]);
    expect(r.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
  });
  it("full ties are random but reproducible from the seed", () => {
    const teams = ["x", "y", "z"].map((teamId) => ({ teamId, points: 0, warWins: 0, meritCount: 0 }));
    const a = rankTeams(teams, createRng(7)).map((t) => t.teamId);
    const b = rankTeams([...teams].reverse(), createRng(7)).map((t) => t.teamId);
    expect(a).toEqual(b);
    const seen = new Set<string>();
    for (let s = 0; s < 50; s++) seen.add(rankTeams(teams, createRng(s)).map((t) => t.teamId).join());
    expect(seen.size).toBeGreaterThan(1);
  });
});
