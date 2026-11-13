/**
 * Region contest events (PRD part 3 §10, §13.4, §20.2).
 */

import { attackCost, meritPoints, resolveContest } from "../contest.js";
import { jianbiTransfers, xiuliRefund } from "../items.js";
import { canStartContest, contestTimes, type Instant } from "../time.js";
import { pts } from "../units.js";
import {
  activeAttackCount,
  activeContestOnLand,
  addGrain,
  addPoints,
  cloneState,
  eventRng,
  grainOf,
  jiuzhuanActive,
  landsOf,
  logUsedItem,
  notice,
  rankingAt,
  takeItem,
  type ContestState,
  type Notice,
  type Result,
  type SeasonState,
} from "./state.js";

export type ContestRefusal =
  | "unknown_team"
  | "unknown_land"
  | "unknown_contest"
  | "not_in_window"
  | "unowned_land"
  | "own_land"
  | "contest_in_progress"
  | "no_prompts"
  | "not_enough_grain"
  | "duplicate_id"
  | "join_closed"
  | "is_defender"
  | "already_in"
  | "not_active"
  | "before_deadline"
  | "owner_changed"
  | "not_leader";

/** Only the leader or deputy acts for the team (§5). `by` is optional so the server may check it itself. */
export function canActForTeam(s: SeasonState, teamId: string, by: string | undefined): boolean {
  if (by === undefined) return true;
  const t = s.teams[teamId];
  return !!t && (t.leader === by || t.deputy === by);
}

/** What starting or joining would cost the team right now. */
export function quoteAttack(s: SeasonState, teamId: string, defender: string, at: Instant) {
  const first = rankingAt(s, at)[0]?.teamId;
  return attackCost(
    { activeAttacks: activeAttackCount(s, teamId), heldLands: landsOf(s, teamId).length, targetOwnerIsFirst: first === defender },
    s.params,
  );
}

export interface StartContest {
  contestId: string;
  teamId: string;
  landId: string;
  at: Instant;
  by?: string;
  /** Grain frozen by the team's open epic-auction bids (§13.3). */
  frozenGrain?: number;
}

export function startContest(input: SeasonState, e: StartContest): Result<ContestRefusal> {
  const p = input.params;
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  const target = input.lands[e.landId];
  if (!target) return { ok: false, refusal: "unknown_land" };
  if (input.contests[e.contestId]) return { ok: false, refusal: "duplicate_id" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  if (!canStartContest(input.opening, e.at, p)) return { ok: false, refusal: "not_in_window" };
  if (target.owner === null) return { ok: false, refusal: "unowned_land" };
  if (target.owner === e.teamId) return { ok: false, refusal: "own_land" };
  if (activeContestOnLand(input, e.landId)) return { ok: false, refusal: "contest_in_progress" };
  const used = input.usedPrompts[e.landId] ?? [];
  const available = (input.prompts[e.landId] ?? []).filter((q) => !used.includes(q));
  if (available.length === 0) return { ok: false, refusal: "no_prompts" };
  const quote = quoteAttack(input, e.teamId, target.owner, e.at);
  if (grainOf(input, e.teamId) - (e.frozenGrain ?? 0) < quote.cost)
    return { ok: false, refusal: "not_enough_grain", detail: `needs ${quote.cost}` };

  const s = cloneState(input);
  const promptId = eventRng(s, `prompt|${e.contestId}`).pick(available);
  (s.usedPrompts[e.landId] ??= []).push(promptId);
  addGrain(s, e.teamId, -quote.cost, "attack", e.at, { refId: e.contestId });
  const times = contestTimes(e.at, p);
  const c: ContestState = {
    id: e.contestId,
    landId: e.landId,
    defender: target.owner,
    promptId,
    startedAt: e.at,
    joinDeadline: times.joinDeadline,
    deadline: times.deadline,
    attackers: [{ teamId: e.teamId, order: 0, paid: quote.cost, joinedAt: e.at }],
    status: "active",
  };
  s.contests[c.id] = c;
  s.contestOrder.push(c.id);
  return {
    ok: true,
    state: s,
    notices: [
      notice("contest_started", e.at, true, {
        contestId: c.id,
        attacker: e.teamId,
        defender: c.defender,
        landId: c.landId,
        promptId,
        cost: quote.cost,
        exile: quote.exile,
        crusade: quote.crusade,
        deadline: c.deadline,
      }),
    ],
  };
}

export interface JoinContest {
  contestId: string;
  teamId: string;
  at: Instant;
  by?: string;
  frozenGrain?: number;
}

/** Join before day 1 21:00, paying the team's own full cost (§10.2). */
export function joinContest(input: SeasonState, e: JoinContest): Result<ContestRefusal> {
  const c0 = input.contests[e.contestId];
  if (!c0) return { ok: false, refusal: "unknown_contest" };
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  if (c0.status !== "active") return { ok: false, refusal: "not_active" };
  if (e.at >= c0.joinDeadline) return { ok: false, refusal: "join_closed" };
  if (c0.defender === e.teamId) return { ok: false, refusal: "is_defender" };
  if (c0.attackers.some((a) => a.teamId === e.teamId)) return { ok: false, refusal: "already_in" };
  const quote = quoteAttack(input, e.teamId, c0.defender, e.at);
  if (grainOf(input, e.teamId) - (e.frozenGrain ?? 0) < quote.cost)
    return { ok: false, refusal: "not_enough_grain", detail: `needs ${quote.cost}` };
  const s = cloneState(input);
  const c = s.contests[e.contestId] as ContestState;
  addGrain(s, e.teamId, -quote.cost, "join", e.at, { refId: c.id });
  c.attackers.push({ teamId: e.teamId, order: c.attackers.length, paid: quote.cost, joinedAt: e.at });
  return {
    ok: true,
    state: s,
    notices: [notice("contest_joined", e.at, true, { contestId: c.id, attacker: e.teamId, defender: c.defender, landId: c.landId, cost: quote.cost })],
  };
}

export interface SettleContest {
  contestId: string;
  at: Instant;
  /** Settlement score per team (human score if reviewed, else AI); null or missing = did not submit. */
  scores: Readonly<Record<string, number | null>>;
}

/**
 * Settle after the deadline (§10.6):
 * - capture: land to the winner, merit +4 (×2 with 九转兵劫印), and the land's
 *   territory income paid to the old owner after the deadline moves to the winner;
 *   any 三昧真火 on the land stops;
 * - hold: merit +3 (×2), and 坚壁清野 (if held) takes 3 from every attacker;
 * - grain is never refunded.
 */
export function settleContest(input: SeasonState, e: SettleContest): Result<ContestRefusal> {
  const c0 = input.contests[e.contestId];
  if (!c0) return { ok: false, refusal: "unknown_contest" };
  if (c0.status !== "active") return { ok: false, refusal: "not_active" };
  if (e.at < c0.deadline) return { ok: false, refusal: "before_deadline" };
  const landNow = input.lands[c0.landId];
  if (!landNow || landNow.owner !== c0.defender) return { ok: false, refusal: "owner_changed" };

  const p = input.params;
  const s = cloneState(input);
  const c = s.contests[e.contestId] as ContestState;
  const score = (t: string) => {
    const v = e.scores[t];
    return v === undefined ? null : v;
  };
  const outcome = resolveContest(
    { attackers: c.attackers.map((a) => ({ teamId: a.teamId, score: score(a.teamId), order: a.order })), defender: { teamId: c.defender, score: score(c.defender) } },
    p,
  );
  const notices: Notice[] = [];
  c.status = "settled";
  c.settledAt = e.at;

  if (outcome.kind === "captured") {
    const winner = outcome.winner;
    const l = s.lands[c.landId]!;
    l.owner = winner;
    l.ownedSince = e.at;
    const merit = meritPoints("capture", jiuzhuanActive(s, winner, e.at), p);
    addPoints(s, winner, pts(merit), "merit_capture", e.at, { refId: c.id });
    s.teams[winner]!.meritCount += 1;
    let moved = 0;
    for (const entry of s.ledger) {
      if (
        entry.currency === "points" &&
        entry.source === "territory" &&
        entry.teamId === c.defender &&
        entry.refId === `land:${c.landId}` &&
        entry.at > c.deadline
      )
        moved += entry.amount;
    }
    if (moved !== 0) {
      addPoints(s, c.defender, -moved, "territory_transfer", e.at, { refId: c.id });
      addPoints(s, winner, moved, "territory_transfer", e.at, { refId: c.id });
    }
    for (const eff of s.effects) if (eff.kind === "sanmei" && eff.landId === c.landId && eff.endedAt === undefined) eff.endedAt = e.at;
    c.outcome = { kind: "captured", winner };
    notices.push(notice("contest_captured", e.at, false, { contestId: c.id, landId: c.landId, winner, loser: c.defender, merit, movedIncome: moved, scores: e.scores }));
  } else if (outcome.kind === "defended") {
    const merit = meritPoints("defend", jiuzhuanActive(s, c.defender, e.at), p);
    addPoints(s, c.defender, pts(merit), "merit_defend", e.at, { refId: c.id });
    s.teams[c.defender]!.meritCount += 1;
    const jianbi = takeItem(s, c.defender, "jianbi");
    if (jianbi) {
      for (const t of jianbiTransfers(c.defender, c.attackers.map((a) => a.teamId), p)) {
        addPoints(s, t.from, -t.amount, "item_effect", e.at, { refId: c.id, note: "jianbi" });
        addPoints(s, t.to, t.amount, "item_effect", e.at, { refId: c.id, note: "jianbi" });
      }
      logUsedItem(s, "jianbi", c.defender, e.at, true);
    }
    c.outcome = { kind: "defended" };
    notices.push(notice("contest_defended", e.at, false, { contestId: c.id, landId: c.landId, defender: c.defender, merit, jianbi: !!jianbi, scores: e.scores }));
  } else {
    c.outcome = { kind: "nothing" };
    notices.push(notice("contest_nothing", e.at, false, { contestId: c.id, landId: c.landId, scores: e.scores }));
  }
  return { ok: true, state: s, notices };
}

export interface CancelContest {
  contestId: string;
  at: Instant;
  /** Admin cancel: refund the grain in full or not at all (§16). */
  refund: boolean;
  reason?: string;
}

export function adminCancelContest(input: SeasonState, e: CancelContest): Result<ContestRefusal> {
  const c0 = input.contests[e.contestId];
  if (!c0) return { ok: false, refusal: "unknown_contest" };
  if (c0.status !== "active") return { ok: false, refusal: "not_active" };
  const s = cloneState(input);
  const c = s.contests[e.contestId] as ContestState;
  cancelInPlace(s, c, "admin", e.at, (paid) => (e.refund ? paid : 0), e.reason);
  return { ok: true, state: s, notices: [notice("contest_cancelled", e.at, true, { contestId: c.id, by: "admin", refund: e.refund })] };
}

/** Shared by the admin cancel and 袖里乾坤 (half back, rounded down). The prompt stays used. */
export function cancelInPlace(
  s: SeasonState,
  c: ContestState,
  by: "xiuli" | "admin",
  at: Instant,
  refundOf: (paid: number) => number,
  note?: string,
): void {
  c.status = "cancelled";
  c.settledAt = at;
  c.outcome = { kind: "cancelled", by };
  for (const a of c.attackers) addGrain(s, a.teamId, refundOf(a.paid), "refund", at, { refId: c.id, note: note ?? by });
}

export function xiuliCancel(s: SeasonState, c: ContestState, at: Instant): void {
  cancelInPlace(s, c, "xiuli", at, (paid) => xiuliRefund(paid, s.params));
}
