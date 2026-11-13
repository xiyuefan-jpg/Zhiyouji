/**
 * Region contests (PRD part 3 §10).
 */

import type { SeasonParams } from "./params.js";
import { ceilGrain } from "./units.js";

export interface AttackCostInput {
  /** Attacks this team is in (started or joined) that are not yet settled (§20.2). */
  activeAttacks: number;
  /** Lands this team holds right now. */
  heldLands: number;
  /** The target land belongs to the current first-place team (讨伐令). */
  targetOwnerIsFirst: boolean;
}

export interface AttackCost {
  cost: number;
  base: number;
  exile: boolean;
  crusade: boolean;
}

/** Cost to start or join an attack: (30 + 15 × active + 10 × lands) × 流亡令 × 讨伐令, rounded up (§10.1). */
export function attackCost(i: AttackCostInput, p: SeasonParams): AttackCost {
  const c = p.contest;
  const base = c.baseCost + c.perActiveAttack * i.activeAttacks + c.perLand * i.heldLands;
  const exile = i.heldLands === 0;
  const crusade = i.targetOwnerIsFirst;
  const factor = (exile ? c.exileFactor : 1) * (crusade ? c.crusadeFactor : 1);
  return { cost: ceilGrain(base * factor), base, exile, crusade };
}

export interface ContestEntry {
  teamId: string;
  /** Settlement score; null when the team did not submit. */
  score: number | null;
  /** 0 for the starter, then 1, 2, … in join order. Earlier wins ties among attackers. */
  order: number;
}

export interface ContestResolutionInput {
  attackers: readonly ContestEntry[];
  defender: { teamId: string; score: number | null };
}

export type ContestOutcome =
  | { kind: "captured"; winner: string; winningScore: number }
  | { kind: "defended"; defender: string }
  | { kind: "nothing" };

/**
 * §10.6:
 * 1. best attacker = highest score, ties to the earlier starter/joiner;
 * 2. defender submitted → attacker must score strictly higher, else the defender holds (+3);
 * 3. defender did not submit → attacker needs ≥ quality line, else nothing happens.
 * Attackers who did not submit do not compete.
 */
export function resolveContest(i: ContestResolutionInput, p: SeasonParams): ContestOutcome {
  const submitted = i.attackers.filter((a): a is ContestEntry & { score: number } => a.score !== null);
  const best = [...submitted].sort((a, b) => b.score - a.score || a.order - b.order)[0];
  const defenderScore = i.defender.score;
  if (defenderScore !== null) {
    if (best && best.score > defenderScore) return { kind: "captured", winner: best.teamId, winningScore: best.score };
    return { kind: "defended", defender: i.defender.teamId };
  }
  if (best && best.score >= p.contest.qualityLine) return { kind: "captured", winner: best.teamId, winningScore: best.score };
  return { kind: "nothing" };
}

/** Merit points for a capture or a successful defence; 九转兵劫印 multiplies them (§10.6, §13.4). */
export function meritPoints(kind: "capture" | "defend", doubled: boolean, p: SeasonParams): number {
  const base = kind === "capture" ? p.contest.meritCapture : p.contest.meritDefend;
  return doubled ? base * p.items.jiuzhuan.multiplier : base;
}
