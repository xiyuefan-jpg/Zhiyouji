/**
 * Big battle in the season state, D29–D33 (PRD part 3 §14, §13.4, §20.5).
 *
 * - D29 noon publication: camps by snake draft on the current ranking, line values.
 * - Until D29 21:00: any leader or deputy of the camp submits the line
 *   assignment (latest wins); 侦察令 / 背水阵 / 坚城令 are used before then.
 * - D29 21:00: assignments locked (missing → random); published D30 morning.
 * - 调兵符: within 12 hours after that publication, swap with the camp's
 *   teammate on a chosen line.
 * - D33 21:00: line works and the main battlefield close; 乾坤圈 before then.
 */

import { completeLineAssignment, formCamps, mainBattlefieldPoints, mainBattlefieldWinner, settleBattleLine } from "../bigBattle.js";
import { itemDef, isItemEnabled } from "../items.js";
import { battleLineValues } from "../params.js";
import { baseOutput, type LandKind } from "../territory.js";
import { dateOfSeasonDay, deadlineOn, publicationTime, seasonDayOf, HOUR, type Instant } from "../time.js";
import { canActForTeam } from "./contests.js";
import {
  addPoints,
  cloneState,
  eventRng,
  landsOf,
  logUsedItem,
  notice,
  rankingAt,
  takeItem,
  type BigBattleState,
  type Camp,
  type Notice,
  type Result,
  type SeasonState,
  afterPauses,
} from "./state.js";

export type BattleRefusal =
  | "too_early"
  | "too_late"
  | "already_done"
  | "not_formed"
  | "not_locked"
  | "bad_assignment"
  | "not_in_camp"
  | "not_leader"
  | "unknown_team"
  | "not_held"
  | "disabled"
  | "not_battle_item"
  | "already_active"
  | "no_assignment"
  | "bad_line"
  | "out_of_season"
  | "war_unsettled";

export function campsFormAt(s: SeasonState): Instant {
  return afterPauses(s, publicationTime(dateOfSeasonDay(s.opening, s.params.time.bigBattleStartDay), s.params.review.w4DeadlineSlot, s.params, s.calendar));
}

export function linesDeadline(s: SeasonState): Instant {
  return afterPauses(s, deadlineOn(dateOfSeasonDay(s.opening, s.params.time.bigBattleStartDay), s.params));
}

export function linesPublishedAt(s: SeasonState): Instant {
  return afterPauses(s, publicationTime(dateOfSeasonDay(s.opening, s.params.time.bigBattleStartDay + 1), "morning", s.params, s.calendar));
}

export function battleDeadline(s: SeasonState): Instant {
  return s.deadlines?.battle ?? afterPauses(s, deadlineOn(dateOfSeasonDay(s.opening, s.params.time.seasonDays), s.params));
}

export function campOf(bb: BigBattleState, teamId: string): Camp | null {
  if (bb.camps.a.includes(teamId)) return "a";
  if (bb.camps.b.includes(teamId)) return "b";
  return null;
}

const other = (c: Camp): Camp => (c === "a" ? "b" : "a");

export function formBigBattle(input: SeasonState, e: { at: Instant }): Result<BattleRefusal> {
  if (input.bigBattle) return { ok: false, refusal: "already_done" };
  if (e.at < campsFormAt(input)) return { ok: false, refusal: "too_early" };
  // §14: the camps follow the ranking after W4 is settled ("结算 W4 后，按排名蛇形分成两个阵营").
  if (Object.values(input.wars).some((w) => w.pairs.length > 0 && !w.settled)) return { ok: false, refusal: "war_unsettled" };
  const s = cloneState(input);
  const ranked = rankingAt(s, e.at).map((r) => r.teamId);
  const camps = formCamps(ranked);
  s.bigBattle = {
    camps,
    lineValues: battleLineValues(s.teamOrder.length, s.params),
    formedAt: e.at,
    submitted: { a: null, b: null },
    final: null,
    lockedAt: null,
    flags: {},
    settled: false,
  };
  return { ok: true, state: s, notices: [notice("big_battle_formed", e.at, false, { camps, lineValues: s.bigBattle.lineValues, ranking: ranked })] };
}

/** Any leader or deputy of a team in the camp may submit; the latest submission before 21:00 counts. */
export function submitLines(input: SeasonState, e: { teamId: string; lines: readonly string[]; at: Instant; by?: string }): Result<BattleRefusal> {
  const bb0 = input.bigBattle;
  if (!bb0) return { ok: false, refusal: "not_formed" };
  if (e.at >= linesDeadline(input)) return { ok: false, refusal: "too_late" };
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  const camp = campOf(bb0, e.teamId);
  if (!camp) return { ok: false, refusal: "not_in_camp" };
  const members = bb0.camps[camp];
  if (e.lines.length !== bb0.lineValues.length || new Set(e.lines).size !== e.lines.length || e.lines.some((t) => !members.includes(t)))
    return { ok: false, refusal: "bad_assignment" };
  const s = cloneState(input);
  s.bigBattle!.submitted[camp] = { lines: [...e.lines], by: e.by ?? null, at: e.at };
  // Shown in the camp's feed only (§14), not broadcast to the other camp.
  return { ok: true, state: s, notices: [notice("lines_submitted", e.at, false, { camp, teamId: e.teamId, by: e.by ?? null })] };
}

export function lockLines(input: SeasonState, e: { at: Instant }): Result<BattleRefusal> {
  const bb0 = input.bigBattle;
  if (!bb0) return { ok: false, refusal: "not_formed" };
  if (bb0.final) return { ok: false, refusal: "already_done" };
  if (e.at < linesDeadline(input)) return { ok: false, refusal: "too_early" };
  const s = cloneState(input);
  const bb = s.bigBattle!;
  const n = bb.lineValues.length;
  const rng = eventRng(s, "lines");
  bb.final = {
    a: completeLineAssignment(bb.camps.a, n, bb.submitted.a?.lines ?? null, rng),
    b: completeLineAssignment(bb.camps.b, n, bb.submitted.b?.lines ?? null, rng),
  };
  bb.lockedAt = e.at;
  return { ok: true, state: s, notices: [notice("lines_locked", e.at, false, { final: bb.final, publishAt: linesPublishedAt(s) })] };
}

export interface UseBattleItem {
  teamId: string;
  itemId: "zhencha" | "beishui" | "jiancheng" | "qiankun" | "diaobing";
  at: Instant;
  by?: string;
  uid?: string;
  /** 调兵符: the line to move to. */
  line?: number;
}

export function useBattleItem(input: SeasonState, e: UseBattleItem): Result<BattleRefusal> {
  const p = input.params;
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  if (!itemDef(e.itemId).bigBattle) return { ok: false, refusal: "not_battle_item" };
  if (!isItemEnabled(e.itemId, p)) return { ok: false, refusal: "disabled" };
  const day = seasonDayOf(input.opening, e.at);
  if (day < 1 || day > p.time.seasonDays) return { ok: false, refusal: "out_of_season" };
  if (!input.teams[e.teamId]!.items.some((i) => i.itemId === e.itemId && (e.uid === undefined || i.uid === e.uid)))
    return { ok: false, refusal: "not_held" };

  const s = cloneState(input);
  const notices: Notice[] = [];
  const flags = (s.bigBattle?.flags ?? {})[e.teamId] ?? {};
  let broadcast = true;
  let data: Record<string, unknown> = {};
  switch (e.itemId) {
    case "beishui":
    case "jiancheng": {
      if (e.at >= linesDeadline(s)) return { ok: false, refusal: "too_late" };
      if (!s.bigBattle) return { ok: false, refusal: "not_formed" };
      if (flags[e.itemId]) return { ok: false, refusal: "already_active" };
      s.bigBattle.flags[e.teamId] = { ...flags, [e.itemId]: true };
      break;
    }
    case "qiankun": {
      if (e.at >= battleDeadline(s)) return { ok: false, refusal: "too_late" };
      if (!s.bigBattle) return { ok: false, refusal: "not_formed" };
      if (flags.qiankun) return { ok: false, refusal: "already_active" };
      s.bigBattle.flags[e.teamId] = { ...flags, qiankun: true };
      break;
    }
    case "zhencha": {
      const bb = s.bigBattle;
      if (!bb) return { ok: false, refusal: "not_formed" };
      if (e.at >= linesDeadline(s)) return { ok: false, refusal: "too_late" };
      const camp = campOf(bb, e.teamId)!;
      const mine = bb.submitted[camp];
      const line = mine ? mine.lines.indexOf(e.teamId) : -1;
      if (line < 0) return { ok: false, refusal: "no_assignment" };
      const theirs = bb.submitted[other(camp)];
      data = { line, opponent: theirs ? (theirs.lines[line] ?? null) : null };
      broadcast = false;
      break;
    }
    case "diaobing": {
      const bb = s.bigBattle;
      if (!bb) return { ok: false, refusal: "not_formed" };
      if (!bb.final) return { ok: false, refusal: "not_locked" };
      const from = linesPublishedAt(s);
      if (e.at < from) return { ok: false, refusal: "too_early" };
      if (e.at >= from + s.params.items.diaobing.hours * HOUR) return { ok: false, refusal: "too_late" };
      const camp = campOf(bb, e.teamId)!;
      const lines = bb.final[camp];
      const to = e.line;
      const cur = lines.indexOf(e.teamId);
      if (to === undefined || !Number.isInteger(to) || to < 0 || to >= lines.length || to === cur || cur < 0) return { ok: false, refusal: "bad_line" };
      const mate = lines[to]!;
      lines[to] = e.teamId;
      lines[cur] = mate;
      data = { camp, swappedWith: mate, fromLine: cur, toLine: to };
      break;
    }
  }
  takeItem(s, e.teamId, e.itemId, e.uid);
  logUsedItem(s, e.itemId, e.teamId, e.at, false);
  notices.push(notice("item_used", e.at, broadcast, { teamId: e.teamId, itemId: e.itemId, ...data }));
  return { ok: true, state: s, notices };
}

/** Kind of the team's highest-output land by base output (§20.5), or null. */
function bestLandKind(s: SeasonState, teamId: string): LandKind | null {
  const owned = landsOf(s, teamId);
  if (owned.length === 0) return null;
  return [...owned].sort((a, b) => baseOutput(b.kind, s.params) - baseOutput(a.kind, s.params))[0]!.kind;
}

export function settleBigBattle(
  input: SeasonState,
  e: { at: Instant; lineScores: Readonly<Record<string, number | null>>; mainScores: Readonly<Record<Camp, number | null>> },
): Result<BattleRefusal> {
  const bb0 = input.bigBattle;
  if (!bb0) return { ok: false, refusal: "not_formed" };
  if (!bb0.final) return { ok: false, refusal: "not_locked" };
  if (bb0.settled) return { ok: false, refusal: "already_done" };
  if (e.at < battleDeadline(input)) return { ok: false, refusal: "too_early" };
  const s = cloneState(input);
  const p = s.params;
  const bb = s.bigBattle!;
  const final = bb.final!;
  const lines: unknown[] = [];
  bb.lineValues.forEach((value, i) => {
    const side = (teamId: string) => ({
      teamId,
      score: e.lineScores[teamId] ?? null,
      beishui: !!bb.flags[teamId]?.beishui,
      jiancheng: !!bb.flags[teamId]?.jiancheng,
      bestLand: bestLandKind(s, teamId),
    });
    const [x, y] = settleBattleLine(value, side(final.a[i]!), side(final.b[i]!), p);
    for (const r of [x, y]) {
      addPoints(s, r.teamId, r.linePoints, "big_battle_line", e.at, { refId: `line:${i}` });
      addPoints(s, r.teamId, r.seized, "big_battle_seize", e.at, { refId: `line:${i}`, note: r.compensation ? "compensation" : undefined });
    }
    lines.push({ line: i, value, a: x, b: y });
  });
  const winner = mainBattlefieldWinner(e.mainScores.a ?? null, e.mainScores.b ?? null);
  for (const camp of ["a", "b"] as const) {
    for (const teamId of bb.camps[camp]) {
      addPoints(s, teamId, mainBattlefieldPoints(camp, winner, !!bb.flags[teamId]?.qiankun, p), "main_battlefield", e.at, { refId: "main" });
    }
  }
  bb.settled = true;
  return { ok: true, state: s, notices: [notice("big_battle_result", e.at, false, { lines, main: { winner, scores: e.mainScores } })] };
}
