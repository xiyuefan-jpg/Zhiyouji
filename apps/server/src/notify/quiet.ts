/**
 * Night quiet hours (PRD part 8 §1.3): no SMS to families between 21:30 and
 * 07:00 Beijing time; what comes up then waits until 07:00.
 */

import { addDays, beijingDate, beijingInstant } from "@zhiyouji/engine";

export const QUIET_START = { h: 21, m: 30 };
export const QUIET_END = { h: 7, m: 0 };

export function isQuiet(t: number): boolean {
  const d = beijingDate(t);
  return t >= beijingInstant(d, QUIET_START.h, QUIET_START.m) || t < beijingInstant(d, QUIET_END.h, QUIET_END.m);
}

/** The earliest time at or after `t` outside quiet hours. */
export function quietRelease(t: number): number {
  const d = beijingDate(t);
  if (t >= beijingInstant(d, QUIET_START.h, QUIET_START.m)) return beijingInstant(addDays(d, 1), QUIET_END.h, QUIET_END.m);
  if (t < beijingInstant(d, QUIET_END.h, QUIET_END.m)) return beijingInstant(d, QUIET_END.h, QUIET_END.m);
  return t;
}

/** Start of the Beijing day containing `t` (for "per day" limits). */
export function beijingDayStart(t: number): number {
  return beijingInstant(beijingDate(t), 0, 0);
}
