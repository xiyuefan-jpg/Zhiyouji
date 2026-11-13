/**
 * Ranking (PRD part 3 §1): points high to low; ties broken by weekly-war
 * wins, then merit count, then at random (seeded, so it can be replayed).
 */

import type { Rng } from "./rng.js";
import type { Pts } from "./units.js";

export interface RankInput {
  teamId: string;
  points: Pts;
  warWins: number;
  meritCount: number;
}

export interface Ranked extends RankInput {
  rank: number;
}

export function rankTeams(teams: readonly RankInput[], rng: Rng): Ranked[] {
  const stable = [...teams].sort((a, b) => a.teamId.localeCompare(b.teamId));
  const key = new Map(stable.map((t) => [t.teamId, rng.next()]));
  return stable
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.warWins - a.warWins ||
        b.meritCount - a.meritCount ||
        (key.get(a.teamId) ?? 0) - (key.get(b.teamId) ?? 0),
    )
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
