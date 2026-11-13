/**
 * Daily task grain and the full-participation award (PRD part 3 §7, §20.2).
 *
 * - Each passed daily task of a season player earns grain for their team
 *   (3, or 5 while 还魂金丹 is active), at most 2 per day and 4 per week per
 *   child. Tasks beyond the caps still go into the 修行日志, without grain.
 * - The day a task counts for is the Beijing date it was submitted, even if
 *   the review finishes after 21:00 or after midnight.
 * - Grain starts on D1; D0 tasks only go into the journal.
 * - The participation award: in weeks 1–4, if ≥ 75% of the team's active
 *   members each have ≥ 2 counted tasks that week, the team gets +3 points.
 */

import type { SeasonParams } from "./params.js";
import { beijingDate, seasonDayOf, seasonWeekOf, DAY, type DateStr, type Instant } from "./time.js";
import { pts, type Pts } from "./units.js";

export interface PassedTask {
  id: string;
  childId: string;
  teamId: string;
  submittedAt: Instant;
}

export type NotCountedReason = "before_grain_start" | "after_season" | "day_cap" | "week_cap";

export interface TaskCount {
  id: string;
  childId: string;
  teamId: string;
  seasonDay: number;
  week: number;
  counted: boolean;
  grain: number;
  reason?: NotCountedReason;
}

/** 还魂金丹 used by a team at `usedAt` lasts `days` × 24 hours. */
export interface HuanhunWindow {
  teamId: string;
  usedAt: Instant;
}

export function huanhunActive(teamId: string, t: Instant, windows: readonly HuanhunWindow[], p: SeasonParams): boolean {
  return windows.some((w) => w.teamId === teamId && t >= w.usedAt && t < w.usedAt + p.items.huanhun.days * DAY);
}

/** Decide, in submission order, which passed tasks earn grain and how much. */
export function countDailyTasks(
  passes: readonly PassedTask[],
  opening: DateStr,
  p: SeasonParams,
  huanhun: readonly HuanhunWindow[] = [],
): TaskCount[] {
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  const sorted = [...passes].sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
  return sorted.map((t) => {
    const seasonDay = seasonDayOf(opening, t.submittedAt);
    const week = seasonWeekOf(seasonDay);
    const base = { id: t.id, childId: t.childId, teamId: t.teamId, seasonDay, week };
    if (seasonDay < p.dailyTask.grainFromDay) return { ...base, counted: false, grain: 0, reason: "before_grain_start" };
    if (seasonDay > p.time.seasonDays) return { ...base, counted: false, grain: 0, reason: "after_season" };
    const dayKey = `${t.childId}|${beijingDate(t.submittedAt)}`;
    const weekKey = `${t.childId}|${week}`;
    const d = perDay.get(dayKey) ?? 0;
    const w = perWeek.get(weekKey) ?? 0;
    if (d >= p.dailyTask.capPerDay) return { ...base, counted: false, grain: 0, reason: "day_cap" };
    if (w >= p.dailyTask.capPerWeek) return { ...base, counted: false, grain: 0, reason: "week_cap" };
    perDay.set(dayKey, d + 1);
    perWeek.set(weekKey, w + 1);
    const grain = huanhunActive(t.teamId, t.submittedAt, huanhun, p)
      ? p.items.huanhun.grainPerTask
      : p.dailyTask.grainPerTask;
    return { ...base, counted: true, grain };
  });
}

export interface TeamMember {
  childId: string;
  /** Members who left the season are not in the denominator (§5). */
  active: boolean;
}

/**
 * Full-participation award for one team and one week, in Pts.
 * `counts` is the output of countDailyTasks (any teams, any weeks).
 */
export function participationAward(
  week: number,
  members: readonly TeamMember[],
  counts: readonly TaskCount[],
  p: SeasonParams,
): Pts {
  if (week < 1 || week > p.participation.weeks) return 0;
  const active = members.filter((m) => m.active);
  if (active.length === 0) return 0;
  const perChild = new Map<string, number>();
  for (const c of counts) if (c.counted && c.week === week) perChild.set(c.childId, (perChild.get(c.childId) ?? 0) + 1);
  const ok = active.filter((m) => (perChild.get(m.childId) ?? 0) >= p.participation.minTasks).length;
  return ok / active.length >= p.participation.ratio - 1e-9 ? pts(p.participation.bonus) : 0;
}
