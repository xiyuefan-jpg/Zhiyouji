/**
 * End of season (PRD part 3 §15): leftover grain converts to points at 30:1,
 * kept to one decimal place and rounded down.
 */

import type { SeasonParams } from "./params.js";
import type { Pts } from "./units.js";

export function grainConversion(grain: number, p: SeasonParams): Pts {
  if (grain <= 0) return 0;
  const tenths = Math.floor((grain * 10) / p.final.grainPerPoint + 1e-9);
  return tenths * 10;
}
