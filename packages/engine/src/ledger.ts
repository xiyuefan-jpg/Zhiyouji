/**
 * Append-only ledgers for grain (粮草) and team points (团队分)
 * (PRD part 2 §4.3, part 3 §1, part 4 §7).
 *
 * Every change is one entry; corrections are reversal entries that point at
 * the entry they cancel. Balances are always the sum of entries.
 */

import type { Instant } from "./time.js";
import { assertInt, type Pts } from "./units.js";

export type Currency = "grain" | "points";

export type GrainSource =
  | "opening"
  | "daily_task"
  | "supply"
  | "attack"
  | "join"
  | "auction_bid"
  | "center_land"
  | "shop"
  | "epic_auction"
  | "refund"
  | "item_effect"
  | "reversal"
  | "admin";

export type PointsSource =
  | "territory"
  | "territory_transfer"
  | "merit_capture"
  | "merit_defend"
  | "war"
  | "bye"
  | "participation"
  | "big_battle_line"
  | "big_battle_seize"
  | "main_battlefield"
  | "item_effect"
  | "grain_conversion"
  | "reversal"
  | "admin";

interface EntryBase {
  id: string;
  teamId: string;
  at: Instant;
  /** What caused it, e.g. a contest id or a daily task submission id. */
  refId?: string;
  note?: string;
  /** For reversals: the id of the entry this one cancels. */
  reverses?: string;
}

export interface GrainEntry extends EntryBase {
  currency: "grain";
  /** Whole grain, positive or negative. */
  amount: number;
  source: GrainSource;
}

export interface PointsEntry extends EntryBase {
  currency: "points";
  /** Hundredths of a point (`Pts`), positive or negative. */
  amount: Pts;
  source: PointsSource;
}

export type LedgerEntry = GrainEntry | PointsEntry;

export function grainEntry(e: Omit<GrainEntry, "currency">): GrainEntry {
  assertInt("grain amount", e.amount);
  return { ...e, currency: "grain" };
}

export function pointsEntry(e: Omit<PointsEntry, "currency">): PointsEntry {
  assertInt("points amount (hundredths)", e.amount);
  return { ...e, currency: "points" };
}

export function balanceOf(entries: readonly LedgerEntry[], teamId: string, currency: Currency): number {
  let sum = 0;
  for (const e of entries) if (e.teamId === teamId && e.currency === currency) sum += e.amount;
  return sum;
}

/** All team balances for one currency. */
export function balances(entries: readonly LedgerEntry[], currency: Currency): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) if (e.currency === currency) out.set(e.teamId, (out.get(e.teamId) ?? 0) + e.amount);
  return out;
}

/** A reversal cancels an entry exactly (PRD part 3 §16: corrections are reversals, never edits). */
export function reversalOf(entry: LedgerEntry, id: string, at: Instant, note?: string): LedgerEntry {
  const base = { id, teamId: entry.teamId, at, refId: entry.refId, reverses: entry.id, note } as const;
  return entry.currency === "grain"
    ? { ...base, currency: "grain", amount: -entry.amount, source: "reversal" }
    : { ...base, currency: "points", amount: -entry.amount, source: "reversal" };
}

/**
 * Grain may never go negative (PRD part 4 §7). `frozen` is grain held by open
 * epic-auction bids, which cannot be spent either.
 */
export function canSpendGrain(
  entries: readonly LedgerEntry[],
  teamId: string,
  cost: number,
  frozen = 0,
): boolean {
  return balanceOf(entries, teamId, "grain") - frozen >= cost;
}

/**
 * Check the whole ledger: every amount is an integer, reversals point at an
 * existing entry of the same team and currency and cancel it exactly, no
 * entry is reversed twice, and no team's grain ever dips below zero when the
 * entries are replayed in time order.
 */
export function checkLedger(entries: readonly LedgerEntry[]): string[] {
  const problems: string[] = [];
  const byId = new Map<string, LedgerEntry>();
  const reversed = new Set<string>();
  for (const e of entries) {
    if (byId.has(e.id)) problems.push(`duplicate entry id ${e.id}`);
    byId.set(e.id, e);
    if (!Number.isInteger(e.amount)) problems.push(`entry ${e.id} has a non-integer amount ${e.amount}`);
  }
  for (const e of entries) {
    if (!e.reverses) continue;
    const orig = byId.get(e.reverses);
    if (!orig) problems.push(`reversal ${e.id} points at missing entry ${e.reverses}`);
    else if (orig.teamId !== e.teamId || orig.currency !== e.currency || orig.amount !== -e.amount)
      problems.push(`reversal ${e.id} does not cancel ${orig.id} exactly`);
    if (reversed.has(e.reverses)) problems.push(`entry ${e.reverses} reversed twice`);
    reversed.add(e.reverses);
  }
  const grain = new Map<string, number>();
  const sorted = [...entries].filter((e) => e.currency === "grain").sort((a, b) => a.at - b.at);
  for (const e of sorted) {
    const next = (grain.get(e.teamId) ?? 0) + e.amount;
    grain.set(e.teamId, next);
    if (next < 0) problems.push(`team ${e.teamId} grain went negative (${next}) at entry ${e.id}`);
  }
  return problems;
}
