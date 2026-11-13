/**
 * Units used across the engine (PRD part 3 §1, §20.7).
 *
 * - Team points (团队分) are stored as integer hundredths (`Pts`): 1 point = 100.
 *   Every ledger entry is rounded half away from zero to 0.01.
 * - Grain (粮草) is an integer. Discounted costs are rounded up.
 */

export type Pts = number;

export const PTS_SCALE = 100;

/** Guards against binary floating point noise such as 45.5000000001 or 0.36 * 100 = 36.00000000000001. */
const EPS = 1e-9;

/** Round half away from zero, tolerant of floating point noise. */
export function roundHalfAway(x: number): number {
  const r = Math.floor(Math.abs(x) + 0.5 + EPS);
  return x < 0 ? -r : r;
}

/** Convert a point value such as 3.96 into stored hundredths (396). */
export function pts(points: number): Pts {
  return roundHalfAway(points * PTS_SCALE);
}

/** Convert stored hundredths back to a point value. */
export function ptsValue(p: Pts): number {
  return p / PTS_SCALE;
}

/** Display with one decimal place, e.g. 396 -> "4.0", -250 -> "-2.5". */
export function formatPts(p: Pts): string {
  const tenths = roundHalfAway(p / 10);
  const sign = tenths < 0 ? "-" : "";
  const abs = Math.abs(tenths);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}`;
}

/** Discounted grain costs are rounded up (PRD part 3 §1). */
export function ceilGrain(x: number): number {
  return Math.ceil(x - EPS);
}

/** Refunds such as 袖里乾坤 are rounded down. */
export function floorGrain(x: number): number {
  return Math.floor(x + EPS);
}

export function assertInt(name: string, v: number): void {
  if (!Number.isInteger(v)) throw new Error(`${name} must be an integer, got ${v}`);
}
