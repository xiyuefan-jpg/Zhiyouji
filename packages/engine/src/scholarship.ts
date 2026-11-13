/**
 * Scholarship split (PRD part 3 §15):
 * each team gets pool × (0.5 × rank share + 0.5 × score share), rounded to
 * whole yuan; the rounding remainder goes to rank 1 (§20.7).
 * - Rank share: weight 1 for rank 1, ×0.72 for each rank below.
 * - Score share: points^1.5 (points ≤ 0 count as 0).
 */

import type { SeasonParams } from "./params.js";
import { roundHalfAway, ptsValue, type Pts } from "./units.js";

export interface ScholarshipLine {
  teamId: string;
  rank: number;
  rankShare: number;
  scoreShare: number;
  yuan: number;
}

export function computeScholarship(
  ranked: readonly { teamId: string; points: Pts }[],
  poolYuan: number,
  p: SeasonParams,
): ScholarshipLine[] {
  if (ranked.length === 0) return [];
  const s = p.scholarship;
  const rankW = ranked.map((_, i) => Math.pow(s.rankDecay, i));
  const rankSum = rankW.reduce((a, b) => a + b, 0);
  const scoreW = ranked.map((t) => Math.pow(Math.max(0, ptsValue(t.points)), s.scoreExponent));
  const scoreSum = scoreW.reduce((a, b) => a + b, 0);
  const lines = ranked.map((t, i) => {
    const rankShare = (rankW[i] ?? 0) / rankSum;
    // If nobody has positive points, the score half follows the rank weights.
    const scoreShare = scoreSum > 0 ? (scoreW[i] ?? 0) / scoreSum : rankShare;
    const exact = poolYuan * (s.rankShare * rankShare + (1 - s.rankShare) * scoreShare);
    return { teamId: t.teamId, rank: i + 1, rankShare, scoreShare, yuan: roundHalfAway(exact) };
  });
  const diff = poolYuan - lines.reduce((a, l) => a + l.yuan, 0);
  const first = lines[0];
  if (first) first.yuan += diff;
  return lines;
}
