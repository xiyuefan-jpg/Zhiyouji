/**
 * Team roles, members, admin interventions and the end of the season
 * (PRD part 3 §5, §15, §16).
 */

import { adminSetRole, claimRole, systemAssignLeader, takeOver, transferRole, type Role, type RoleRefusal, type TeamRoles } from "../leaders.js";
import { itemDef } from "../items.js";
import { reversalOf, type Currency } from "../ledger.js";
import { grainConversion } from "../final.js";
import { computeScholarship } from "../scholarship.js";
import { dateOfSeasonDay, publicationTime, type Instant } from "../time.js";
import {
  addGrain,
  addPoints,
  cloneState,
  eventRng,
  giveItem,
  grainOf,
  nextId,
  notice,
  pointsOf,
  rankingAt,
  takeItem,
  type HeldItem,
  type Result,
  type SeasonState,
  type TeamState,
} from "./state.js";

export type AdminRefusal =
  | RoleRefusal
  | "unknown_team"
  | "unknown_child"
  | "unknown_land"
  | "unknown_entry"
  | "unknown_item"
  | "not_held"
  | "already_reversed"
  | "is_reversal"
  | "needs_reason"
  | "not_integer"
  | "already_paused"
  | "not_paused"
  | "too_early"
  | "already_done"
  | "battle_not_settled"
  | "contest_active";

// ---- roles (§5) ---------------------------------------------------------

function roles(t: TeamState): TeamRoles {
  return { leader: t.leader, deputy: t.deputy };
}

function activeIds(t: TeamState): string[] {
  return t.members.filter((m) => m.active).map((m) => m.childId);
}

function setRoles(input: SeasonState, teamId: string, next: TeamRoles | RoleRefusal, at: Instant, kind: string): Result<AdminRefusal> {
  if (typeof next === "string") return { ok: false, refusal: next };
  const s = cloneState(input);
  const t = s.teams[teamId]!;
  t.leader = next.leader;
  t.deputy = next.deputy;
  return { ok: true, state: s, notices: [notice(kind, at, false, { teamId, leader: t.leader, deputy: t.deputy })] };
}

/** Claim leader or deputy: first come, first served, effective at once (team feed). */
export function claimTeamRole(input: SeasonState, e: { teamId: string; role: Role; childId: string; at: Instant }): Result<AdminRefusal> {
  const t = input.teams[e.teamId];
  if (!t) return { ok: false, refusal: "unknown_team" };
  return setRoles(input, e.teamId, claimRole(roles(t), e.role, e.childId, activeIds(t)), e.at, "role_claimed");
}

/** A confirmed hand-over (the server keeps the pending request until the receiver confirms). */
export function transferTeamRole(input: SeasonState, e: { teamId: string; role: Role; from: string; to: string; at: Instant }): Result<AdminRefusal> {
  const t = input.teams[e.teamId];
  if (!t) return { ok: false, refusal: "unknown_team" };
  return setRoles(input, e.teamId, transferRole(roles(t), e.role, e.from, e.to, activeIds(t)), e.at, "role_transferred");
}

/** The deputy takes over a leader who has not logged in for 3 days. */
export function takeOverLeader(input: SeasonState, e: { teamId: string; deputyId: string; leaderLastLoginAt: Instant; at: Instant }): Result<AdminRefusal> {
  const t = input.teams[e.teamId];
  if (!t) return { ok: false, refusal: "unknown_team" };
  return setRoles(input, e.teamId, takeOver(roles(t), e.deputyId, e.leaderLastLoginAt, e.at, input.params), e.at, "role_takeover");
}

/** D1 noon publication: teams still without a leader get their highest-grade member (§5). */
export function systemAssignLeaders(input: SeasonState, e: { at: Instant }): Result<AdminRefusal> {
  if (input.done.includes("assign_leaders")) return { ok: false, refusal: "already_done" };
  if (e.at < publicationTime(dateOfSeasonDay(input.opening, 1), "noon", input.params, input.calendar)) return { ok: false, refusal: "too_early" };
  const s = cloneState(input);
  const assigned: { teamId: string; leader: string }[] = [];
  for (const id of s.teamOrder) {
    const t = s.teams[id]!;
    if (t.leader !== null) continue;
    const next = systemAssignLeader(roles(t), t.members.filter((m) => m.active), eventRng(s, `leader|${id}`));
    t.leader = next.leader;
    t.deputy = next.deputy;
    if (next.leader) assigned.push({ teamId: id, leader: next.leader });
  }
  s.done.push("assign_leaders");
  return { ok: true, state: s, notices: [notice("leaders_assigned", e.at, false, { assigned })] };
}

export function adminSetTeamRole(input: SeasonState, e: { teamId: string; role: Role; childId: string | null; at: Instant; by: string; reason: string }): Result<AdminRefusal> {
  const t = input.teams[e.teamId];
  if (!t) return { ok: false, refusal: "unknown_team" };
  if (!e.reason.trim()) return { ok: false, refusal: "needs_reason" };
  if (e.childId !== null && !activeIds(t).includes(e.childId)) return { ok: false, refusal: "not_member" };
  return setRoles(input, e.teamId, adminSetRole(roles(t), e.role, e.childId), e.at, "role_admin_set");
}

/** A member leaves the season: out of the participation denominator; loses any role; earnings stay (§5). */
export function memberLeaves(input: SeasonState, e: { childId: string; at: Instant }): Result<AdminRefusal> {
  const teamId = input.teamOrder.find((id) => input.teams[id]!.members.some((m) => m.childId === e.childId && m.active));
  if (!teamId) return { ok: false, refusal: "unknown_child" };
  const s = cloneState(input);
  const t = s.teams[teamId]!;
  t.members.find((m) => m.childId === e.childId)!.active = false;
  if (t.leader === e.childId) t.leader = null;
  if (t.deputy === e.childId) t.deputy = null;
  return { ok: true, state: s, notices: [notice("member_left", e.at, false, { teamId, childId: e.childId })] };
}

// ---- admin interventions (§16) -----------------------------------------

export function pauseSeason(input: SeasonState, e: { at: Instant; reason: string }): Result<AdminRefusal> {
  if (input.paused) return { ok: false, refusal: "already_paused" };
  if (!e.reason.trim()) return { ok: false, refusal: "needs_reason" };
  const s = cloneState(input);
  s.paused = true;
  s.pauses.push({ from: e.at, until: null, reason: e.reason });
  return { ok: true, state: s, notices: [notice("season_paused", e.at, true, { reason: e.reason })] };
}

export function resumeSeason(input: SeasonState, e: { at: Instant }): Result<AdminRefusal> {
  if (!input.paused) return { ok: false, refusal: "not_paused" };
  const s = cloneState(input);
  s.paused = false;
  const open = s.pauses[s.pauses.length - 1]!;
  open.until = e.at;
  return { ok: true, state: s, notices: [notice("season_resumed", e.at, true, { pausedFor: e.at - open.from })] };
}

/** Total paused time before `t`: scheduled times after a pause shift by this much (§16, §18). */
export function pausedBefore(s: SeasonState, t: Instant, now: Instant = t): number {
  let sum = 0;
  for (const p of s.pauses) {
    if (p.from >= t) continue;
    sum += (p.until ?? now) - p.from;
  }
  return sum;
}

export function adjustLedger(
  input: SeasonState,
  e: { teamId: string; currency: Currency; amount: number; at: Instant; by: string; reason: string },
): Result<AdminRefusal> {
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!e.reason.trim()) return { ok: false, refusal: "needs_reason" };
  if (!Number.isInteger(e.amount)) return { ok: false, refusal: "not_integer" };
  const s = cloneState(input);
  const extra = { refId: `admin:${e.by}`, note: e.reason };
  if (e.currency === "grain") addGrain(s, e.teamId, e.amount, "admin", e.at, extra);
  else addPoints(s, e.teamId, e.amount, "admin", e.at, extra);
  return { ok: true, state: s, notices: [notice("ledger_adjusted", e.at, false, { ...e })] };
}

/** Cancel one entry with a reversal (never edit or delete, §16). */
export function reverseEntry(input: SeasonState, e: { entryId: string; at: Instant; by: string; reason: string }): Result<AdminRefusal> {
  const entry = input.ledger.find((x) => x.id === e.entryId);
  if (!entry) return { ok: false, refusal: "unknown_entry" };
  if (!e.reason.trim()) return { ok: false, refusal: "needs_reason" };
  if (entry.reverses) return { ok: false, refusal: "is_reversal" };
  if (input.ledger.some((x) => x.reverses === e.entryId)) return { ok: false, refusal: "already_reversed" };
  const s = cloneState(input);
  s.ledger.push(reversalOf(entry, nextId(s, "L"), e.at, `${e.reason} (${e.by})`));
  return { ok: true, state: s, notices: [notice("entry_reversed", e.at, false, { entryId: e.entryId, reason: e.reason })] };
}

/** Change a land's owner by hand (e.g. after a re-judged contest that cannot be recomputed, §20.4). */
export function adminSetLandOwner(input: SeasonState, e: { landId: string; teamId: string | null; at: Instant; by: string; reason: string }): Result<AdminRefusal> {
  const l = input.lands[e.landId];
  if (!l) return { ok: false, refusal: "unknown_land" };
  if (e.teamId !== null && !input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!e.reason.trim()) return { ok: false, refusal: "needs_reason" };
  if (input.contestOrder.some((id) => input.contests[id]!.status === "active" && input.contests[id]!.landId === e.landId))
    return { ok: false, refusal: "contest_active" };
  const s = cloneState(input);
  const land = s.lands[e.landId]!;
  const from = land.owner;
  land.owner = e.teamId;
  land.ownedSince = e.teamId === null ? null : e.at;
  for (const eff of s.effects) if ((eff.kind === "sanmei" || eff.kind === "bagua") && eff.landId === e.landId && eff.endedAt === undefined) eff.endedAt = e.at;
  return { ok: true, state: s, notices: [notice("land_owner_set", e.at, true, { landId: e.landId, from, to: e.teamId, reason: e.reason })] };
}

export function adminGiveItem(input: SeasonState, e: { teamId: string; itemId: string; at: Instant; by: string; reason: string }): Result<AdminRefusal> {
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!e.reason.trim()) return { ok: false, refusal: "needs_reason" };
  try {
    itemDef(e.itemId);
  } catch {
    return { ok: false, refusal: "unknown_item" };
  }
  const s = cloneState(input);
  const it = giveItem(s, e.teamId, e.itemId, "admin", e.at);
  return { ok: true, state: s, notices: [notice("item_given", e.at, false, { teamId: e.teamId, itemId: e.itemId, uid: it.uid, reason: e.reason })] };
}

export function adminRemoveItem(input: SeasonState, e: { teamId: string; uid: string; at: Instant; by: string; reason: string }): Result<AdminRefusal> {
  const t = input.teams[e.teamId];
  if (!t) return { ok: false, refusal: "unknown_team" };
  if (!e.reason.trim()) return { ok: false, refusal: "needs_reason" };
  const held = t.items.find((i) => i.uid === e.uid) as HeldItem | undefined;
  if (!held) return { ok: false, refusal: "not_held" };
  const s = cloneState(input);
  takeItem(s, e.teamId, held.itemId, e.uid);
  return { ok: true, state: s, notices: [notice("item_removed", e.at, false, { teamId: e.teamId, itemId: held.itemId, reason: e.reason })] };
}

// ---- end of season (§15) ------------------------------------------------

/**
 * After the big battle is settled: leftover grain → points at 30:1 (one
 * decimal, rounded down), then the final ranking and the scholarship split.
 */
export function finalizeSeason(input: SeasonState, e: { at: Instant; poolYuan: number }): Result<AdminRefusal> {
  if (input.final) return { ok: false, refusal: "already_done" };
  if (!input.bigBattle?.settled) return { ok: false, refusal: "battle_not_settled" };
  if (!Number.isInteger(e.poolYuan) || e.poolYuan < 0) return { ok: false, refusal: "not_integer" };
  const s = cloneState(input);
  for (const id of s.teamOrder) addPoints(s, id, grainConversion(grainOf(s, id), s.params), "grain_conversion", e.at, { note: `${grainOf(s, id)} grain` });
  const ranking = rankingAt(s, e.at).map((r) => ({ teamId: r.teamId, rank: r.rank, points: r.points }));
  const scholarship = computeScholarship(ranking, e.poolYuan, s.params).map((l) => ({ teamId: l.teamId, yuan: l.yuan }));
  s.final = { at: e.at, ranking, scholarship, poolYuan: e.poolYuan };
  return { ok: true, state: s, notices: [notice("season_final", e.at, false, { ranking, scholarship, points: Object.fromEntries(s.teamOrder.map((t) => [t, pointsOf(s, t)])) })] };
}
