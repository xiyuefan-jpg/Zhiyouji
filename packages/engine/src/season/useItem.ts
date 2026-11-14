/**
 * Using an item (PRD part 3 §13, §20.3, §20.4).
 *
 * - Items belong to the team; the leader or deputy uses them; each copy is used once.
 * - Negative items (三昧真火, 紫金红葫芦, 七宝紫金钵) are multiplied by the punch-down
 *   factor on lower-ranked targets (rank at the moment of use); 照妖镜 triggers
 *   before 辟火罩; a blocked item still counts as used.
 * - 太虚幻镜 copies the most recently used non-epic item (including passive
 *   items that triggered); the copier picks a new target and must meet that
 *   item's conditions. Copying a passive or big-battle item gives the copier a
 *   held copy of it.
 * - Passive items (坚壁清野, 辟火罩, 照妖镜) cannot be used by hand.
 * - Big-battle items (侦察令, 背水阵, 坚城令, 乾坤圈, 调兵符) are handled by the
 *   big-battle events.
 */

import { fatianPoints, itemDef, isItemEnabled, taixuCopyTarget, useQibao, useSanmei, useZijin, type NegativeTarget, type StealResult } from "../items.js";
import { baseOutput } from "../territory.js";
import { dateOfSeasonDay, publicationTime, seasonDayOf, DAY, type Instant } from "../time.js";
import { pts } from "../units.js";
import { canActForTeam, xiuliCancel } from "./contests.js";
import {
  addPoints,
  cloneState,
  giveItem,
  hasItem,
  landsOf,
  landZeroed,
  logUsedItem,
  notice,
  rankingAt,
  rankOf,
  takeItem,
  transferPoints,
  type ContestState,
  type Notice,
  type Result,
  type SeasonState,
  afterPauses,
} from "./state.js";
import type { Ranked } from "../ranking.js";

export type ItemRefusal =
  | "unknown_team"
  | "not_leader"
  | "not_held"
  | "disabled"
  | "passive_item"
  | "big_battle_item"
  | "out_of_season"
  | "needs_target"
  | "invalid_target"
  | "target_has_no_land"
  | "not_own_land"
  | "too_few_lands"
  | "no_war_week"
  | "war_started"
  | "already_active"
  | "unknown_contest"
  | "not_defender"
  | "contest_closed"
  | "nothing_to_copy"
  | "too_late";

export interface UseItem {
  teamId: string;
  itemId: string;
  at: Instant;
  by?: string;
  /** A specific copy; otherwise the oldest copy is used. */
  uid?: string;
  targetTeamId?: string;
  landId?: string;
  contestId?: string;
  /** 玉净瓶 / 大闹天宫: which war week (default: the next war that has not started). */
  week?: number;
}

/** "The war starts" = Friday morning publication of that week (§20.3). Week w runs D(7w−6) … D(7w). */
export function warStartAt(s: SeasonState, week: number): Instant {
  return afterPauses(s, publicationTime(dateOfSeasonDay(s.opening, 7 * week - 2), "morning", s.params, s.calendar));
}

/** The team's best land right now: highest base output, preferring lands not zeroed by 生死簿; ties by land order. */
export function bestLandId(s: SeasonState, teamId: string, at: Instant): string | null {
  const owned = landsOf(s, teamId);
  if (owned.length === 0) return null;
  const sorted = [...owned].sort(
    (a, b) =>
      Number(landZeroed(s, a.id, at)) - Number(landZeroed(s, b.id, at)) ||
      baseOutput(b.kind, s.params) - baseOutput(a.kind, s.params) ||
      s.landOrder.indexOf(a.id) - s.landOrder.indexOf(b.id),
  );
  return sorted[0]!.id;
}

export function useItem(input: SeasonState, e: UseItem): Result<ItemRefusal> {
  const p = input.params;
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  const day = seasonDayOf(input.opening, e.at);
  if (day < 1 || day > p.time.seasonDays) return { ok: false, refusal: "out_of_season" };
  const def = itemDef(e.itemId);
  if (!isItemEnabled(e.itemId, p)) return { ok: false, refusal: "disabled" };
  if (def.passive) return { ok: false, refusal: "passive_item" };
  if (def.bigBattle) return { ok: false, refusal: "big_battle_item" };
  if (!input.teams[e.teamId]!.items.some((i) => i.itemId === e.itemId && (e.uid === undefined || i.uid === e.uid)))
    return { ok: false, refusal: "not_held" };

  const s = cloneState(input);
  const notices: Notice[] = [];
  const ranking = rankingAt(s, e.at);
  takeItem(s, e.teamId, e.itemId, e.uid);
  let copied: string | null = null;
  if (e.itemId === "taixu") {
    copied = taixuCopyTarget([...s.usedItems].reverse().map((u) => u.itemId));
    if (copied === null) return { ok: false, refusal: "nothing_to_copy" };
    const cdef = itemDef(copied);
    if (cdef.passive || cdef.bigBattle) {
      giveItem(s, e.teamId, copied, "copy", e.at);
    } else {
      const refusal = applyItem(s, copied, e, day, ranking, notices);
      if (refusal) return { ok: false, refusal };
    }
  } else {
    const refusal = applyItem(s, e.itemId, e, day, ranking, notices);
    if (refusal) return { ok: false, refusal };
  }
  logUsedItem(s, e.itemId, e.teamId, e.at, false);
  notices.unshift(
    notice("item_used", e.at, true, {
      teamId: e.teamId,
      itemId: e.itemId,
      copied,
      targetTeamId: e.targetTeamId ?? null,
      landId: e.landId ?? null,
      contestId: e.contestId ?? null,
    }),
  );
  return { ok: true, state: s, notices };
}

function negativeTarget(s: SeasonState, teamId: string, ranking: readonly Ranked[]): NegativeTarget {
  return { teamId, rank: rankOf(ranking, teamId), defenses: { zhaoyao: hasItem(s, teamId, "zhaoyao"), bihuo: hasItem(s, teamId, "bihuo") } };
}

/** Consume the defence that triggered and log it (it can then be copied by 太虚幻镜). */
function consumeDefense(s: SeasonState, r: StealResult | { teamId: string; outcome: StealResult["outcome"] }, at: Instant): void {
  if (r.outcome.kind === "hit") return;
  takeItem(s, r.teamId, r.outcome.consumed);
  logUsedItem(s, r.outcome.consumed, r.teamId, at, true);
}

/** Apply one item's effect for `e.teamId`; returns a refusal (the caller then drops the clone). */
function applyItem(s: SeasonState, itemId: string, e: UseItem, day: number, ranking: readonly Ranked[], notices: Notice[]): ItemRefusal | null {
  const p = s.params;
  const me = e.teamId;
  switch (itemId) {
    case "huanhun":
      s.effects.push({ kind: "huanhun", teamId: me, from: e.at, until: e.at + p.items.huanhun.days * DAY });
      return null;
    case "yujing":
    case "danao": {
      const weeks = p.participation.weeks;
      let week = e.week;
      if (week === undefined) {
        week = Array.from({ length: weeks }, (_, i) => i + 1).find((w) => e.at < warStartAt(s, w));
        if (week === undefined) return "no_war_week";
      }
      if (!Number.isInteger(week) || week < 1 || week > weeks) return "no_war_week";
      if (e.at >= warStartAt(s, week)) return "war_started";
      if (s.effects.some((x) => x.kind === itemId && x.teamId === me && x.week === week)) return "already_active";
      s.effects.push({ kind: itemId, teamId: me, week, at: e.at });
      return null;
    }
    case "dianhua":
      s.effects.push({ kind: "dianhua", teamId: me, bonusPerLand: p.items.dianhua.bonusPerLand, from: e.at, until: e.at + p.items.dianhua.days * DAY });
      return null;
    case "shengsi": {
      if (!e.landId) return "needs_target";
      if (s.lands[e.landId]?.owner !== me) return "not_own_land";
      s.effects.push({ kind: "shengsi", teamId: me, landId: e.landId, from: e.at, until: e.at + p.items.shengsi.days * DAY });
      addPoints(s, me, pts(p.items.shengsi.pts), "item_effect", e.at, { refId: "shengsi", note: e.landId });
      return null;
    }
    case "fatian": {
      const v = fatianPoints(landsOf(s, me).length, p);
      if (v === null) return "too_few_lands";
      addPoints(s, me, v, "item_effect", e.at, { refId: "fatian" });
      return null;
    }
    case "jiuzhuan":
      s.effects.push({ kind: "jiuzhuan", teamId: me, from: e.at, until: e.at + p.items.jiuzhuan.days * DAY });
      return null;
    case "xiuli": {
      if (!e.contestId) return "needs_target";
      const c = s.contests[e.contestId] as ContestState | undefined;
      if (!c) return "unknown_contest";
      if (c.defender !== me) return "not_defender";
      if (c.status !== "active" || e.at >= c.deadline) return "contest_closed";
      xiuliCancel(s, c, e.at);
      notices.push(notice("contest_cancelled", e.at, true, { contestId: c.id, by: "xiuli", teamId: me }));
      return null;
    }
    case "sanmei": {
      if (!e.targetTeamId) return "needs_target";
      if (e.targetTeamId === me || !s.teams[e.targetTeamId]) return "invalid_target";
      if (landsOf(s, e.targetTeamId).length === 0) return "target_has_no_land";
      const target = { ...negativeTarget(s, e.targetTeamId, ranking), bestLandId: bestLandId(s, e.targetTeamId, e.at) };
      const r = useSanmei({ teamId: me, rank: rankOf(ranking, me), bestLandId: bestLandId(s, me, e.at) }, target, e.at, p);
      consumeDefense(s, { teamId: e.targetTeamId, outcome: r.outcome }, e.at);
      if (r.effect) s.effects.push(r.effect);
      notices.push(notice("item_outcome", e.at, true, { itemId: "sanmei", targetTeamId: e.targetTeamId, outcome: r.outcome.kind, landId: r.effect?.landId ?? null }));
      return null;
    }
    case "zijin": {
      if (!e.targetTeamId) return "needs_target";
      if (e.targetTeamId === me || !s.teams[e.targetTeamId]) return "invalid_target";
      const r = useZijin({ teamId: me, rank: rankOf(ranking, me) }, negativeTarget(s, e.targetTeamId, ranking), p);
      consumeDefense(s, r, e.at);
      if (r.transfer) transferPoints(s, r.transfer.from, r.transfer.to, r.transfer.amount, "item_effect", e.at, { refId: "zijin" });
      notices.push(notice("item_outcome", e.at, true, { itemId: "zijin", targetTeamId: e.targetTeamId, outcome: r.outcome.kind, transfer: r.transfer }));
      return null;
    }
    case "qibao": {
      const others = s.teamOrder.filter((t) => t !== me).map((t) => negativeTarget(s, t, ranking));
      const results = useQibao({ teamId: me, rank: rankOf(ranking, me) }, others, p);
      for (const r of results) {
        consumeDefense(s, r, e.at);
        if (r.transfer) transferPoints(s, r.transfer.from, r.transfer.to, r.transfer.amount, "item_effect", e.at, { refId: "qibao" });
      }
      notices.push(notice("item_outcome", e.at, true, { itemId: "qibao", results: results.map((r) => ({ teamId: r.teamId, outcome: r.outcome.kind, transfer: r.transfer })) }));
      return null;
    }
    case "bagua": {
      if (day >= p.time.bigBattleStartDay) return "too_late";
      if (!e.landId) return "needs_target";
      if (s.lands[e.landId]?.owner !== me) return "not_own_land";
      s.effects.push({ kind: "bagua", teamId: me, landId: e.landId, from: e.at });
      return null;
    }
    default:
      return "invalid_target";
  }
}
