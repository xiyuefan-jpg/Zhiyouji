/**
 * Daily 24:00 settlement (PRD part 3 §6, §13.4, §20.2):
 * - territory income per land, diminishing by value order; 生死簿 zeroes a land
 *   but it keeps its place in the order;
 * - 点化之术: +1 per held land per day, not diminished;
 * - 八卦炉: +1.5 a day while the team still holds the chosen land, through D28;
 *   nothing while 生死簿 zeroes that land; gone once the land changes owner
 *   (both as in the simulator);
 * - 三昧真火: the victim's chosen land's income that day × share moves to the
 *   beneficiary, until the land changes owner.
 * Runs for D1 … D33 (first payout D1 24:00, last D33 24:00). Paused seasons
 * pay nothing for a day whose 24:00 falls inside a pause (§16). Each day runs
 * once (idempotent).
 */

import { dateOfSeasonDay, addDays, beijingInstant, type Instant } from "../time.js";
import { dailyTerritoryIncome } from "../territory.js";
import { pts, roundHalfAway } from "../units.js";
import {
  addPoints,
  cloneState,
  effectActive,
  landsOf,
  landZeroed,
  notice,
  transferPoints,
  type Notice,
  type Result,
  type SeasonState,
} from "./state.js";

export type DailyRefusal = "out_of_season" | "already_settled";

/** 24:00 at the end of season day `day`, i.e. 00:00 of the next Beijing date. */
export function endOfSeasonDay(s: SeasonState, day: number): Instant {
  return beijingInstant(addDays(dateOfSeasonDay(s.opening, day), 1), 0);
}

export function settleDay(input: SeasonState, day: number): Result<DailyRefusal> {
  const p = input.params;
  if (!Number.isInteger(day) || day < 1 || day > p.time.seasonDays) return { ok: false, refusal: "out_of_season" };
  if (input.settledDays.includes(day)) return { ok: false, refusal: "already_settled" };
  const s = cloneState(input);
  const at = endOfSeasonDay(s, day);
  s.settledDays.push(day);
  const notices: Notice[] = [];
  if (s.paused || s.pauses.some((x) => at >= x.from && (x.until === null || at < x.until))) {
    notices.push(notice("daily_skipped_paused", at, false, { day }));
    return { ok: true, state: s, notices };
  }

  /** Income each land earned today, for 三昧真火. */
  const landIncome = new Map<string, number>();
  for (const teamId of s.teamOrder) {
    const owned = landsOf(s, teamId);
    if (owned.length === 0) continue;
    const income = dailyTerritoryIncome(
      owned.map((l) => ({ landId: l.id, kind: l.kind, zeroed: landZeroed(s, l.id, at) })),
      p,
    );
    for (const li of income.lands) {
      landIncome.set(li.landId, li.pts);
      addPoints(s, teamId, li.pts, "territory", at, { refId: `land:${li.landId}`, note: `D${day}` });
    }
    for (const e of s.effects) {
      if (e.kind === "dianhua" && e.teamId === teamId && effectActive(e, at))
        addPoints(s, teamId, pts(e.bonusPerLand * owned.length), "item_effect", at, { refId: "dianhua", note: `D${day}` });
      if (
        e.kind === "bagua" &&
        e.teamId === teamId &&
        e.endedAt === undefined &&
        day <= p.items.bagua.lastDay &&
        owned.some((l) => l.id === e.landId) &&
        !landZeroed(s, e.landId, at)
      )
        addPoints(s, teamId, pts(p.items.bagua.dailyBonus), "item_effect", at, { refId: "bagua", note: `D${day}` });
    }
  }
  for (const e of s.effects) {
    if (e.kind !== "sanmei" || e.endedAt !== undefined || !effectActive(e, at)) continue;
    if (s.lands[e.landId]?.owner !== e.victim) continue;
    const amount = roundHalfAway((landIncome.get(e.landId) ?? 0) * e.share);
    if (amount > 0) transferPoints(s, e.victim, e.beneficiary, amount, "item_effect", at, { refId: "sanmei", note: `D${day}` });
  }
  notices.push(notice("daily_settled", at, false, { day }));
  return { ok: true, state: s, notices };
}
