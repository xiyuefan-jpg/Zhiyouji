/**
 * Daily tasks, the full-participation award and supply tasks
 * (PRD part 3 §7, §12, §20.2).
 */

import { participationAward, type TaskCount } from "../dailyTask.js";
import { supplyGrain, supplyScore } from "../supply.js";
import { addDays, beijingDate, beijingInstant, dateOfSeasonDay, seasonDayOf, seasonWeekOf, type Instant } from "../time.js";
import {
  addGrain,
  addPoints,
  cloneState,
  effectActive,
  notice,
  teamOfChild,
  type Result,
  type SeasonState,
  type TaskPass,
} from "./state.js";

export type TaskRefusal = "duplicate" | "unknown_child" | "already_done" | "too_early" | "bad_week" | "unknown_team";

export interface DailyTaskPassed {
  taskId: string;
  childId: string;
  submittedAt: Instant;
  /** When the review passed it (the ledger entry is dated then). */
  at: Instant;
}

/**
 * One passed daily task: +3 grain (5 while 还魂金丹 is active at submission),
 * at most 2 per child per Beijing day and 4 per season week; from D1 on.
 * Tasks over the caps still go to the journal, without grain.
 */
export function dailyTaskPassed(input: SeasonState, e: DailyTaskPassed): Result<TaskRefusal> {
  if (input.taskPasses.some((t) => t.id === e.taskId)) return { ok: false, refusal: "duplicate" };
  const teamId = teamOfChild(input, e.childId);
  if (!teamId) return { ok: false, refusal: "unknown_child" };
  const p = input.params;
  const s = cloneState(input);
  const day = seasonDayOf(s.opening, e.submittedAt);
  const date = beijingDate(e.submittedAt);
  const week = seasonWeekOf(day);
  const mine = s.taskPasses.filter((t) => t.childId === e.childId && t.counted);
  let reason: string | null = null;
  if (day < p.dailyTask.grainFromDay) reason = "before_grain_start";
  else if (day > p.time.seasonDays) reason = "after_season";
  else if (mine.filter((t) => t.date === date).length >= p.dailyTask.capPerDay) reason = "day_cap";
  else if (mine.filter((t) => t.week === week).length >= p.dailyTask.capPerWeek) reason = "week_cap";
  const huanhun = s.effects.some((x) => x.kind === "huanhun" && x.teamId === teamId && effectActive(x, e.submittedAt));
  const grain = reason ? 0 : huanhun ? p.items.huanhun.grainPerTask : p.dailyTask.grainPerTask;
  const pass: TaskPass = { id: e.taskId, childId: e.childId, teamId, submittedAt: e.submittedAt, date, week, counted: reason === null, grain };
  s.taskPasses.push(pass);
  addGrain(s, teamId, grain, "daily_task", e.at, { refId: e.taskId });
  return { ok: true, state: s, notices: [notice("daily_task_counted", e.at, false, { ...pass, reason })] };
}

/** Monday 00:00 after season week `week`. */
export function weekEnd(s: SeasonState, week: number): Instant {
  return beijingInstant(addDays(dateOfSeasonDay(s.opening, 7 * week), 1), 0);
}

/** Monday 00:00: +3 to every team where ≥75% of active members have ≥2 counted tasks that week (weeks 1–4). */
export function runParticipationAward(input: SeasonState, e: { week: number; at: Instant }): Result<TaskRefusal> {
  const key = `participation:${e.week}`;
  if (input.done.includes(key)) return { ok: false, refusal: "already_done" };
  if (!Number.isInteger(e.week) || e.week < 1 || e.week > input.params.participation.weeks) return { ok: false, refusal: "bad_week" };
  if (e.at < weekEnd(input, e.week)) return { ok: false, refusal: "too_early" };
  const s = cloneState(input);
  const counts: TaskCount[] = s.taskPasses.map((t) => ({
    id: t.id,
    childId: t.childId,
    teamId: t.teamId,
    seasonDay: seasonDayOf(s.opening, t.submittedAt),
    week: t.week,
    counted: t.counted,
    grain: t.grain,
  }));
  const awarded: string[] = [];
  for (const teamId of s.teamOrder) {
    const v = participationAward(e.week, s.teams[teamId]!.members, counts, s.params);
    if (v > 0) {
      addPoints(s, teamId, v, "participation", e.at, { refId: key });
      awarded.push(teamId);
    }
  }
  s.done.push(key);
  return { ok: true, state: s, notices: [notice("participation_award", e.at, false, { week: e.week, awarded })] };
}

export interface SupplyTeamResult {
  teamId: string;
  submittedMembers: number;
  quality: number;
  summary: number;
}

/** A supply task scored by the AI (§12): participation share + quality + summary → 10 / 20 / 30 grain. */
export function settleSupply(
  input: SeasonState,
  e: { supplyId: string; at: Instant; results: readonly SupplyTeamResult[] },
): Result<TaskRefusal> {
  const key = `supply:${e.supplyId}`;
  if (input.done.includes(key)) return { ok: false, refusal: "already_done" };
  if (e.results.some((r) => !input.teams[r.teamId])) return { ok: false, refusal: "unknown_team" };
  const s = cloneState(input);
  const p = s.params;
  const out = e.results.map((r) => {
    const activeMembers = s.teams[r.teamId]!.members.filter((m) => m.active).length;
    const score = supplyScore({ ...r, activeMembers }, p);
    const grain = supplyGrain(score, r.submittedMembers > 0, p);
    addGrain(s, r.teamId, grain, "supply", e.at, { refId: e.supplyId });
    return { teamId: r.teamId, score, grain };
  });
  s.done.push(key);
  return { ok: true, state: s, notices: [notice("supply_result", e.at, false, { supplyId: e.supplyId, results: out })] };
}
