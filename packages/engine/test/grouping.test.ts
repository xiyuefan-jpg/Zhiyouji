import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS as P, createRng, groupPlayers, type PlayStyle, type Player } from "../src/index.js";

const STYLES: PlayStyle[] = ["fighter", "strategist", "healer", "builder"];

function makePlayers(n: number, seed: number, siblingPairs = 0): Player[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => ({
    childId: `c${i}`,
    familyId: i < siblingPairs * 2 ? `fam${Math.floor(i / 2)}` : `solo${i}`,
    grade: 1 + rng.int(9),
    style: rng.pick(STYLES),
  }));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("grouping (§4, §20.1)", () => {
  it("72 players → 1 server, 8 teams of 9, balanced by grade", () => {
    const players = makePlayers(72, 1);
    const r = groupPlayers(players, P, createRng(5));
    expect(r.servers).toHaveLength(1);
    const teams = r.servers[0]!.teams;
    expect(teams.map((t) => t.length)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
    const overall = mean(players.map((p) => p.grade));
    for (const t of teams) expect(Math.abs(mean(t.map((p) => p.grade)) - overall)).toBeLessThan(1);
    expect(new Set(teams.flat().map((p) => p.childId)).size).toBe(72);
  });
  it("mixes play styles in every team", () => {
    const r = groupPlayers(makePlayers(72, 2), P, createRng(5));
    for (const t of r.servers[0]!.teams) expect(new Set(t.map((p) => p.style)).size).toBeGreaterThanOrEqual(3);
  });
  it("siblings end up in different teams", () => {
    const r = groupPlayers(makePlayers(64, 3, 8), P, createRng(9));
    expect(r.unresolvedSiblings).toEqual([]);
    for (const t of r.servers[0]!.teams) expect(new Set(t.map((p) => p.familyId)).size).toBe(t.length);
  });
  it("120 players → 2 servers of 60", () => {
    const r = groupPlayers(makePlayers(120, 4), P, createRng(1));
    expect(r.servers.map((s) => s.teams.flat().length)).toEqual([60, 60]);
    expect(r.servers.every((s) => s.teams.length === 8)).toBe(true);
  });
  it("is reproducible from the seed", () => {
    const players = makePlayers(50, 6);
    const ids = (seed: number) => groupPlayers(players, P, createRng(seed)).servers[0]!.teams.map((t) => t.map((p) => p.childId).sort().join());
    expect(ids(3)).toEqual(ids(3));
  });
});
