/**
 * Beijing-time calendar helpers (PRD part 3 §1, §1.1, §3, §10.1, §20.2).
 *
 * - Instants are epoch milliseconds (UTC).
 * - Calendar dates are "YYYY-MM-DD" strings in Beijing time (UTC+8, no DST).
 * - Season day d: D0 is the opening date (a Sunday), D1 the following Monday.
 */

import type { PublicationSlot, SeasonParams } from "./params.js";

export type Instant = number;
export type DateStr = string;
export type DayKind = "school" | "rest";

/** Admin overrides from the calendar page (holidays, 调休, winter break). */
export type DayKindOverrides = Readonly<Record<DateStr, DayKind>>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BEIJING_OFFSET = 8 * HOUR;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(d: DateStr): { y: number; m: number; day: number } {
  const m = DATE_RE.exec(d);
  if (!m) throw new Error(`bad date "${d}", expected YYYY-MM-DD`);
  return { y: Number(m[1]), m: Number(m[2]), day: Number(m[3]) };
}

/** Beijing midnight of a date, as an instant. */
function midnight(d: DateStr): Instant {
  const { y, m, day } = parseDate(d);
  return Date.UTC(y, m - 1, day) - BEIJING_OFFSET;
}

/** The Beijing calendar date of an instant. */
export function beijingDate(t: Instant): DateStr {
  const shifted = new Date(t + BEIJING_OFFSET);
  return shifted.toISOString().slice(0, 10);
}

/** Instant of a Beijing wall-clock time on a date. */
export function beijingInstant(d: DateStr, hour: number, minute = 0): Instant {
  return midnight(d) + hour * HOUR + minute * 60_000;
}

export function addDays(d: DateStr, n: number): DateStr {
  return beijingDate(midnight(d) + n * DAY + HOUR);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(d: DateStr): number {
  return new Date(midnight(d) + BEIJING_OFFSET).getUTCDay();
}

export function assertOpeningDate(opening: DateStr): void {
  if (dayOfWeek(opening) !== 0) throw new Error(`opening date ${opening} must be a Sunday (§20.2)`);
}

/** Whole days between two dates (b − a). */
export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round((midnight(b) - midnight(a)) / DAY);
}

export function seasonDayOf(opening: DateStr, t: Instant): number {
  return daysBetween(opening, beijingDate(t));
}

export function dateOfSeasonDay(opening: DateStr, d: number): DateStr {
  return addDays(opening, d);
}

/** Season week of a season day: D1–D7 → 1, …, D29–D33 → 5; D0 → 0. */
export function seasonWeekOf(d: number): number {
  return d <= 0 ? 0 : Math.floor((d - 1) / 7) + 1;
}

/** Monday–Friday are school days and weekends rest days unless the admin calendar says otherwise. */
export function dayKind(d: DateStr, overrides: DayKindOverrides = {}): DayKind {
  const o = overrides[d];
  if (o) return o;
  const dow = dayOfWeek(d);
  return dow === 0 || dow === 6 ? "rest" : "school";
}

const SLOT_INDEX: Record<PublicationSlot, 0 | 1 | 2> = { morning: 0, noon: 1, evening: 2 };

export function publicationTime(
  d: DateStr,
  slot: PublicationSlot,
  p: SeasonParams,
  overrides: DayKindOverrides = {},
): Instant {
  const hours = dayKind(d, overrides) === "school" ? p.time.publishSchoolDay : p.time.publishRestDay;
  return beijingInstant(d, hours[SLOT_INDEX[slot]]);
}

export function publicationTimes(d: DateStr, p: SeasonParams, overrides: DayKindOverrides = {}): Instant[] {
  return (["morning", "noon", "evening"] as const).map((s) => publicationTime(d, s, p, overrides));
}

/** The first publication time strictly after `t` (results of graded work are published then, §1.2). */
export function nextPublicationAfter(t: Instant, p: SeasonParams, overrides: DayKindOverrides = {}): Instant {
  let d = beijingDate(t);
  for (let i = 0; i < 3; i++) {
    const next = publicationTimes(d, p, overrides).find((x) => x > t);
    if (next !== undefined) return next;
    d = addDays(d, 1);
  }
  throw new Error("no publication time found within 3 days");
}

/** 21:00 Beijing on a date. */
export function deadlineOn(d: DateStr, p: SeasonParams): Instant {
  return beijingInstant(d, p.time.deadlineHour);
}

export interface ContestTimes {
  /** Day 0 is the Beijing date the contest was started. */
  day0: DateStr;
  joinDeadline: Instant;
  deadline: Instant;
  /** Debate regions: defender picks a side within 12 hours. */
  debateSideDeadline: Instant;
  /** Debate regions: opening statements due on day 2 at 21:00. */
  debateOpeningDeadline: Instant;
}

export function contestTimes(startedAt: Instant, p: SeasonParams): ContestTimes {
  const day0 = beijingDate(startedAt);
  return {
    day0,
    joinDeadline: deadlineOn(addDays(day0, p.contest.joinWindowDays), p),
    deadline: deadlineOn(addDays(day0, p.contest.durationDays), p),
    debateSideDeadline: startedAt + p.contest.debateSideHours * HOUR,
    debateOpeningDeadline: deadlineOn(addDays(day0, p.contest.debateOpeningDay), p),
  };
}

/** Contests may be started after the D1 auction closes (D1 21:00) and until D25 21:00 (§10.1). */
export function canStartContest(opening: DateStr, t: Instant, p: SeasonParams): boolean {
  const from = deadlineOn(dateOfSeasonDay(opening, 1), p);
  const until = deadlineOn(dateOfSeasonDay(opening, p.contest.lastInitiationDay), p);
  return t >= from && t <= until;
}

export { HOUR, DAY };
