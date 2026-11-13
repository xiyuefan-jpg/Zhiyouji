/**
 * "Submit preferences, allocate at the deadline" rounds (PRD part 3 §8, §9.1, §13.3):
 * D1 blind auction, starter items, D8 center land, D15 rare items.
 */

import type { Rng } from "./rng.js";
import type { Instant } from "./time.js";

export interface PreferenceRequest {
  teamId: string;
  /** Item / land ids, most wanted first. */
  prefs: readonly string[];
}

export interface Allocation {
  teamId: string;
  item: string;
  round: number;
}

export interface AllocateOptions {
  /** Teams in processing order. */
  order: readonly PreferenceRequest[];
  /** Remaining stock per item id. */
  stock: Readonly<Record<string, number>>;
  /** Number of rounds, or "untilExhausted" to repeat until a round assigns nothing. */
  rounds: number | "untilExhausted";
  /** A team may not take the same item twice (default true). */
  noDuplicates?: boolean;
  /** Extra check, e.g. enough grain or under the shop cap. */
  canTake?: (teamId: string, item: string, takenSoFar: readonly string[]) => boolean;
  /** Called after each assignment, e.g. to deduct grain. */
  onTake?: (teamId: string, item: string) => void;
}

/** Each round, every team in order takes its highest preference that is still in stock. */
export function allocateByPreference(o: AllocateOptions): Allocation[] {
  const stock: Record<string, number> = { ...o.stock };
  const taken = new Map<string, string[]>(o.order.map((r) => [r.teamId, []]));
  const out: Allocation[] = [];
  const maxRounds = o.rounds === "untilExhausted" ? Number.POSITIVE_INFINITY : o.rounds;
  for (let round = 1; round <= maxRounds; round++) {
    let assigned = 0;
    for (const req of o.order) {
      const mine = taken.get(req.teamId) ?? [];
      const item = req.prefs.find(
        (it) =>
          (stock[it] ?? 0) > 0 &&
          !((o.noDuplicates ?? true) && mine.includes(it)) &&
          (o.canTake ? o.canTake(req.teamId, it, mine) : true),
      );
      if (item === undefined) continue;
      stock[item] = (stock[item] ?? 0) - 1;
      mine.push(item);
      taken.set(req.teamId, mine);
      out.push({ teamId: req.teamId, item, round });
      o.onTake?.(req.teamId, item);
      assigned++;
    }
    if (assigned === 0) break;
  }
  return out;
}

export interface AuctionBid {
  teamId: string;
  bid: number;
  prefs: readonly string[];
  submittedAt: Instant;
}

export interface BlindAuctionResult {
  /** Processing order (highest bid first); starter items are picked in the reverse order. */
  order: string[];
  assignments: { teamId: string; landId: string; paid: number }[];
}

/**
 * D1 blind auction (§8): highest bid first, ties to the earlier submission;
 * teams that did not submit bid 0, get random preferences and go last.
 * Each team gets exactly one edge land and pays its own bid.
 */
export function resolveBlindAuction(input: {
  teams: readonly string[];
  lands: readonly string[];
  bids: readonly AuctionBid[];
  grain: Readonly<Record<string, number>>;
  rng: Rng;
}): BlindAuctionResult {
  if (input.lands.length < input.teams.length) throw new Error("fewer edge lands than teams");
  const byTeam = new Map(input.bids.map((b) => [b.teamId, b]));
  const submitted = input.teams
    .map((t) => byTeam.get(t))
    .filter((b): b is AuctionBid => b !== undefined)
    .map((b) => ({ ...b, bid: Math.max(0, Math.min(b.bid, input.grain[b.teamId] ?? 0)) }))
    .sort((a, b) => b.bid - a.bid || a.submittedAt - b.submittedAt);
  const missing = input.rng.shuffle(input.teams.filter((t) => !byTeam.has(t)));
  const order: PreferenceRequest[] = [
    ...submitted.map((b) => ({ teamId: b.teamId, prefs: completePrefs(b.prefs, input.lands, input.rng) })),
    ...missing.map((t) => ({ teamId: t, prefs: input.rng.shuffle(input.lands) })),
  ];
  const stock = Object.fromEntries(input.lands.map((l) => [l, 1]));
  const allocs = allocateByPreference({ order, stock, rounds: 1 });
  const bidOf = new Map(submitted.map((b) => [b.teamId, b.bid]));
  return {
    order: order.map((r) => r.teamId),
    assignments: allocs.map((a) => ({ teamId: a.teamId, landId: a.item, paid: bidOf.get(a.teamId) ?? 0 })),
  };
}

/** Append any options a team did not rank, in random order, so everyone always gets something. */
export function completePrefs(prefs: readonly string[], all: readonly string[], rng: Rng): string[] {
  const known = prefs.filter((x) => all.includes(x));
  const rest = rng.shuffle(all.filter((x) => !known.includes(x)));
  return [...new Set(known), ...rest];
}

/**
 * Starter items (§8): picked in the reverse of the auction order, `freeItems`
 * rounds, one per round, no two of the same kind, limited stock per kind.
 */
export function resolveStarterItems(input: {
  auctionOrder: readonly string[];
  prefs: Readonly<Record<string, readonly string[]>>;
  kinds: readonly string[];
  stockPerKind: number;
  freeItems: number;
  rng: Rng;
}): Allocation[] {
  const order = [...input.auctionOrder].reverse().map((teamId) => ({
    teamId,
    prefs: completePrefs(input.prefs[teamId] ?? [], input.kinds, input.rng),
  }));
  const stock = Object.fromEntries(input.kinds.map((k) => [k, input.stockPerKind]));
  return allocateByPreference({ order, stock, rounds: input.freeItems });
}
