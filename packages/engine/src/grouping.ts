/**
 * Grouping (PRD part 3 §4, §20.1).
 * 1. Plan servers: 8 teams per server, at most 88 players per server.
 * 2. Sort by grade, high to low, and deal players out in a snake (1→N, N→1, …),
 *    first across servers, then across the 8 teams of each server.
 * 3. Swap same-grade players between teams to make each team's play styles as
 *    varied as possible.
 * 4. Siblings (same family account) never share a team: swap one of them with
 *    the closest-grade player of another team that causes no new conflict.
 * The admin can still move players by hand afterwards.
 */

import { planServers, type SeasonParams } from "./params.js";
import type { Rng } from "./rng.js";

export type PlayStyle = "fighter" | "strategist" | "healer" | "builder";

export interface Player {
  childId: string;
  familyId: string;
  /** 1 = first grade of primary school … 9 = third year of junior high, 10+ = senior high. */
  grade: number;
  style: PlayStyle | null;
}

export interface GroupingResult {
  servers: { teams: Player[][] }[];
  /** Sibling pairs that could not be separated (should be empty). */
  unresolvedSiblings: [string, string][];
}

function snake<T>(items: readonly T[], buckets: number): T[][] {
  const out: T[][] = Array.from({ length: buckets }, () => []);
  items.forEach((it, i) => {
    const round = Math.floor(i / buckets);
    const pos = i % buckets;
    (out[round % 2 === 0 ? pos : buckets - 1 - pos] as T[]).push(it);
  });
  return out;
}

function styleVariety(team: readonly Player[]): number {
  return new Set(team.map((p) => p.style).filter((s) => s !== null)).size;
}

function siblingConflicts(team: readonly Player[]): number {
  const seen = new Map<string, number>();
  for (const p of team) seen.set(p.familyId, (seen.get(p.familyId) ?? 0) + 1);
  let c = 0;
  for (const n of seen.values()) if (n > 1) c += n - 1;
  return c;
}

function improveStyles(teams: Player[][]): void {
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const ti = teams[i] as Player[];
        const tj = teams[j] as Player[];
        for (let a = 0; a < ti.length; a++) {
          for (let b = 0; b < tj.length; b++) {
            const pa = ti[a] as Player;
            const pb = tj[b] as Player;
            if (pa.grade !== pb.grade || pa.style === pb.style) continue;
            const before = styleVariety(ti) + styleVariety(tj) - 10 * (siblingConflicts(ti) + siblingConflicts(tj));
            ti[a] = pb;
            tj[b] = pa;
            const after = styleVariety(ti) + styleVariety(tj) - 10 * (siblingConflicts(ti) + siblingConflicts(tj));
            if (after > before) improved = true;
            else {
              ti[a] = pa;
              tj[b] = pb;
            }
          }
        }
      }
    }
    if (!improved) break;
  }
}

function separateSiblings(teams: Player[][]): [string, string][] {
  const unresolved: [string, string][] = [];
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i] as Player[];
    for (let a = 0; a < team.length; a++) {
      const pa = team[a] as Player;
      const sibling = team.find((x, k) => k !== a && x.familyId === pa.familyId);
      if (!sibling) continue;
      // Find the closest-grade player elsewhere whose move creates no new conflict.
      let best: { j: number; b: number; gap: number } | null = null;
      for (let j = 0; j < teams.length; j++) {
        if (j === i) continue;
        const other = teams[j] as Player[];
        if (other.some((x) => x.familyId === pa.familyId)) continue;
        other.forEach((pb, b) => {
          const restHere = team.filter((_, k) => k !== a);
          if (restHere.some((x) => x.familyId === pb.familyId)) return;
          const gap = Math.abs(pb.grade - pa.grade);
          if (!best || gap < best.gap) best = { j, b, gap };
        });
      }
      if (best) {
        const { j, b } = best as { j: number; b: number; gap: number };
        const other = teams[j] as Player[];
        team[a] = other[b] as Player;
        other[b] = pa;
      } else unresolved.push([pa.childId, sibling.childId]);
    }
  }
  return unresolved;
}

export function groupPlayers(players: readonly Player[], p: SeasonParams, rng: Rng): GroupingResult {
  const plan = planServers(players.length, p);
  const sorted = rng.shuffle(players).sort((a, b) => b.grade - a.grade);
  const perServer = snake(sorted, plan.servers);
  const unresolvedSiblings: [string, string][] = [];
  const servers = perServer.map((serverPlayers) => {
    const teams = snake(serverPlayers, plan.teamsPerServer);
    improveStyles(teams);
    unresolvedSiblings.push(...separateSiblings(teams));
    return { teams };
  });
  return { servers, unresolvedSiblings };
}
