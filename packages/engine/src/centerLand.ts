/**
 * Center land price after the D8 round (PRD part 3 §9.2):
 * 75 × max(0.2, min(1, (33 − d) ÷ (33 − 8))), rounded up.
 */

import type { SeasonParams } from "./params.js";
import { ceilGrain } from "./units.js";

export function centerLandPrice(day: number, p: SeasonParams): number {
  const { price, minFactor, openDay } = p.centerLand;
  const total = p.time.seasonDays;
  const frac = (total - day) / (total - openDay);
  return ceilGrain(price * Math.max(minFactor, Math.min(1, frac)));
}
