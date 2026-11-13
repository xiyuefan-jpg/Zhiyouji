/**
 * Daily territory income (PRD part 3 §6).
 *
 * Lands are sorted by base value (high to low); the first `fullCount` earn in
 * full and the n-th earns decay^(n − fullCount). A land zeroed by 生死簿 still
 * takes its place in the order. Item bonuses (点化之术, 八卦炉) are computed
 * separately and are not diminished.
 */

import type { SeasonParams } from "./params.js";
import { pts, type Pts } from "./units.js";

export type LandKind = "edge" | "center";

export interface OwnedLand {
  landId: string;
  kind: LandKind;
  /** True while 生死簿 has zeroed this land's output. */
  zeroed?: boolean;
}

export interface LandIncome {
  landId: string;
  /** Position in the diminishing order, starting at 1. */
  position: number;
  factor: number;
  pts: Pts;
}

export function baseOutput(kind: LandKind, p: SeasonParams): number {
  return kind === "center" ? p.territory.centerOutput : p.territory.edgeOutput;
}

export function dailyTerritoryIncome(lands: readonly OwnedLand[], p: SeasonParams): { total: Pts; lands: LandIncome[] } {
  const sorted = [...lands].sort(
    (a, b) => baseOutput(b.kind, p) - baseOutput(a.kind, p) || a.landId.localeCompare(b.landId),
  );
  const out: LandIncome[] = sorted.map((land, i) => {
    const position = i + 1;
    const factor = position <= p.territory.fullCount ? 1 : Math.pow(p.territory.decay, position - p.territory.fullCount);
    const value = land.zeroed ? 0 : pts(baseOutput(land.kind, p) * factor);
    return { landId: land.landId, position, factor, pts: value };
  });
  return { total: out.reduce((s, l) => s + l.pts, 0), lands: out };
}
