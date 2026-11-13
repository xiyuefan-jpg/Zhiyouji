/**
 * Weekly war in the season state (PRD part 3 §11, §13.4, §20.3).
 *
 * Week w runs D(7w−6) … D(7w):
 * - Thursday D(7w−3) evening publication: pairing by current rank, avoiding repeats;
 * - Friday D(7w−2) morning publication: the war starts (玉净瓶 / 大闹天宫 deadline);
 * - Sunday D(7w) 21:00: submissions close; settlement after review.
 */

import { isItemEnabled, REGULAR_COMMON_ITEMS } from "../items.js";
import { byeAward, openLoserChest, pairKey, pairWeeklyWar, settleWarMatch } from "../war.js";
import { dateOfSeasonDay, deadlineOn, publicationTime, type Instant } from "../time.js";
import {
  addPoints,
  cloneState,
  eventRng,
  giveItem,
  notice,
  rankingAt,
  type Result,
  type SeasonState,
  type WarState,
} from "./state.js";

export type WarRefusal = "bad_week" | "already_done" | "too_early" | "not_paired" | "unknown_team";

/** Number of regular-season war weeks: the full weeks before the big battle (4). */
export function warWeeks(s: SeasonState): number {
  return Math.floor((s.params.time.bigBattleStartDay - 1) / 7);
}

export function warPairingAt(s: SeasonState, week: number): Instant {
  return publicationTime(dateOfSeasonDay(s.opening, 7 * week - 3), "evening", s.params, s.calendar);
}

export function warDeadline(s: SeasonState, week: number): Instant {
  return deadlineOn(dateOfSeasonDay(s.opening, 7 * week), s.params);
}

function validWeek(s: SeasonState, week: number): boolean {
  return Number.isInteger(week) && week >= 1 && week <= warWeeks(s);
}

/** Pair teams by rank at `at`, avoiding opponents already met this season. */
export function pairWar(input: SeasonState, e: { week: number; at: Instant }): Result<WarRefusal> {
  if (!validWeek(input, e.week)) return { ok: false, refusal: "bad_week" };
  if (input.wars[e.week]) return { ok: false, refusal: "already_done" };
  if (e.at < warPairingAt(input, e.week)) return { ok: false, refusal: "too_early" };
  const s = cloneState(input);
  const met = new Set<string>();
  for (const w of Object.values(s.wars)) for (const [a, b] of w.pairs) met.add(pairKey(a, b));
  const ranked = rankingAt(s, e.at).map((r) => r.teamId);
  const pairing = pairWeeklyWar(ranked, met);
  s.wars[e.week] = { week: e.week, pairs: pairing.pairs, bye: pairing.bye, pairedAt: e.at, settled: false };
  return { ok: true, state: s, notices: [notice("war_paired", e.at, false, { week: e.week, pairs: pairing.pairs, bye: pairing.bye, repeats: pairing.repeats })] };
}

/**
 * Settle a week's war: win +15 / loss −5, tie +5 each, missing side loses;
 * 玉净瓶 and 大闹天宫 activated for the week rewrite the points; the loser of a
 * match where both submitted opens a loser chest; the bye gets +5.
 */
export function settleWar(
  input: SeasonState,
  e: { week: number; at: Instant; scores: Readonly<Record<string, number | null>> },
): Result<WarRefusal> {
  const w0 = input.wars[e.week];
  if (!w0) return { ok: false, refusal: "not_paired" };
  if (w0.settled) return { ok: false, refusal: "already_done" };
  if (e.at < warDeadline(input, e.week)) return { ok: false, refusal: "too_early" };
  const s = cloneState(input);
  const p = s.params;
  const w = s.wars[e.week] as WarState;
  const active = (kind: "yujing" | "danao", teamId: string) =>
    s.effects.some((x) => x.kind === kind && x.teamId === teamId && x.week === e.week);
  const side = (teamId: string) => ({
    teamId,
    score: e.scores[teamId] ?? null,
    yujing: active("yujing", teamId),
    danao: active("danao", teamId),
  });
  const chestKinds = REGULAR_COMMON_ITEMS.filter((k) => isItemEnabled(k, p));
  const results: NonNullable<WarState["results"]> = [];
  for (const [a, b] of w.pairs) {
    for (const r of settleWarMatch(side(a), side(b), p)) {
      addPoints(s, r.teamId, r.points, "war", e.at, { refId: `war:${e.week}` });
      if (r.outcome === "win") s.teams[r.teamId]!.warWins += 1;
      let chestItem: string | null = null;
      if (r.chest && chestKinds.length > 0) {
        chestItem = openLoserChest(eventRng(s, `chest|${e.week}|${r.teamId}`), chestKinds);
        giveItem(s, r.teamId, chestItem, "chest", e.at);
      }
      results.push({ teamId: r.teamId, outcome: r.outcome, points: r.points, chestItem });
    }
  }
  if (w.bye) {
    const v = byeAward(p);
    addPoints(s, w.bye, v, "bye", e.at, { refId: `war:${e.week}` });
    results.push({ teamId: w.bye, outcome: "bye", points: v, chestItem: null });
  }
  w.settled = true;
  w.results = results;
  return { ok: true, state: s, notices: [notice("war_result", e.at, false, { week: e.week, results })] };
}
