/**
 * Supply tasks (军需任务, PRD part 3 §12): AI scores out of 100, no human review.
 * - Participation 40: share of active members who submitted (computed here).
 * - Quality 40 and team summary 20: from the AI.
 * - Grain: < 50 → 10, 50–64.99 → 20, ≥ 65 → 30. Nobody submitted → 0.
 */

import type { SeasonParams } from "./params.js";

export interface SupplyInput {
  submittedMembers: number;
  activeMembers: number;
  /** AI quality score, 0 … qualityWeight (40). */
  quality: number;
  /** AI score of the team summary, 0 … summaryWeight (20); 0 when there is none. */
  summary: number;
}

export function supplyScore(i: SupplyInput, p: SeasonParams): number {
  const s = p.supply;
  const share = i.activeMembers > 0 ? Math.min(1, i.submittedMembers / i.activeMembers) : 0;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  return s.participationWeight * share + clamp(i.quality, s.qualityWeight) + clamp(i.summary, s.summaryWeight);
}

export function supplyGrain(score: number, anySubmitted: boolean, p: SeasonParams): number {
  if (!anySubmitted) return 0;
  const [low, high] = p.supply.tierBounds;
  const [g1, g2, g3] = p.supply.tierGrain;
  if (score >= high) return g3;
  if (score >= low) return g2;
  return g1;
}
