/**
 * "Submit, then allocate at the deadline" rounds and land purchases
 * (PRD part 3 §8, §9).
 *
 * The server stores what teams submit before the deadline (bids, preference
 * lists) and passes them in when the deadline event runs.
 */

import { resolveBlindAuction, resolveStarterItems, completePrefs, type AuctionBid } from "../allocation.js";
import { centerLandPrice } from "../centerLand.js";
import { isItemEnabled, REGULAR_COMMON_ITEMS } from "../items.js";
import { openingStockPerKind } from "../params.js";
import { dateOfSeasonDay, deadlineOn, seasonDayOf, type Instant } from "../time.js";
import { canActForTeam } from "./contests.js";
import {
  addGrain,
  cloneState,
  eventRng,
  giveItem,
  grainOf,
  notice,
  rankingAt,
  type Notice,
  type Result,
  type SeasonState,
} from "./state.js";

export type RoundRefusal =
  | "already_done"
  | "before_deadline"
  | "auction_pending"
  | "round_pending"
  | "unknown_team"
  | "unknown_land"
  | "not_center"
  | "sold"
  | "out_of_season"
  | "not_enough_grain"
  | "not_leader";

function deadlineOfDay(s: SeasonState, day: number): Instant {
  return deadlineOn(dateOfSeasonDay(s.opening, day), s.params);
}

function edgeLands(s: SeasonState): string[] {
  return s.landOrder.filter((id) => s.lands[id]!.kind === "edge");
}

function centerLands(s: SeasonState): string[] {
  return s.landOrder.filter((id) => s.lands[id]!.kind === "center");
}

/** D1 21:00 blind auction (§8): highest bid first, one edge land each, bids paid and published. */
export function runBlindAuction(input: SeasonState, e: { at: Instant; bids: readonly AuctionBid[] }): Result<RoundRefusal> {
  if (input.done.includes("auction")) return { ok: false, refusal: "already_done" };
  if (e.at < deadlineOfDay(input, 1)) return { ok: false, refusal: "before_deadline" };
  const s = cloneState(input);
  const bids = e.bids.filter((b) => s.teams[b.teamId]);
  const res = resolveBlindAuction({
    teams: s.teamOrder,
    lands: edgeLands(s),
    bids,
    grain: Object.fromEntries(s.teamOrder.map((t) => [t, grainOf(s, t)])),
    rng: eventRng(s, "auction"),
  });
  for (const a of res.assignments) {
    const l = s.lands[a.landId]!;
    l.owner = a.teamId;
    l.ownedSince = e.at;
    addGrain(s, a.teamId, -a.paid, "auction_bid", e.at, { refId: "auction", note: a.landId });
  }
  s.auctionOrder = res.order;
  s.done.push("auction");
  return { ok: true, state: s, notices: [notice("auction_result", e.at, true, { order: res.order, assignments: res.assignments })] };
}

/**
 * D2 21:00 starter items (§8): reverse auction order, `freeItems` rounds,
 * no duplicate kinds, limited stock per kind; missing preferences are random.
 */
export function runStarterItems(input: SeasonState, e: { at: Instant; prefs: Readonly<Record<string, readonly string[]>> }): Result<RoundRefusal> {
  if (input.done.includes("starter")) return { ok: false, refusal: "already_done" };
  if (!input.auctionOrder) return { ok: false, refusal: "auction_pending" };
  if (e.at < deadlineOfDay(input, 2)) return { ok: false, refusal: "before_deadline" };
  const s = cloneState(input);
  const p = s.params;
  const kinds = REGULAR_COMMON_ITEMS.filter((k) => isItemEnabled(k, p));
  const allocs = resolveStarterItems({
    auctionOrder: s.auctionOrder!,
    prefs: e.prefs,
    kinds,
    stockPerKind: openingStockPerKind(s.teamOrder.length, p),
    freeItems: p.opening.freeItems,
    rng: eventRng(s, "starter"),
  });
  for (const a of allocs) giveItem(s, a.teamId, a.item, "opening", e.at);
  s.done.push("starter");
  return { ok: true, state: s, notices: [notice("starter_items", e.at, false, { allocations: allocs })] };
}

/**
 * D8 21:00 center land round (§9.1): teams that asked to buy are processed
 * from last place to first; each buys its highest unsold preference for 75
 * grain, at most one, skipped if it cannot pay.
 */
export function runCenterRound(
  input: SeasonState,
  e: { at: Instant; requests: readonly { teamId: string; prefs: readonly string[] }[]; frozenGrain?: Readonly<Record<string, number>> },
): Result<RoundRefusal> {
  if (input.done.includes("center_round")) return { ok: false, refusal: "already_done" };
  if (e.at < deadlineOfDay(input, input.params.centerLand.openDay)) return { ok: false, refusal: "before_deadline" };
  const s = cloneState(input);
  const price = s.params.centerLand.price;
  const reqs = new Map(e.requests.filter((r) => s.teams[r.teamId]).map((r) => [r.teamId, r]));
  const order = rankingAt(s, e.at)
    .map((r) => r.teamId)
    .reverse()
    .filter((t) => reqs.has(t));
  const rng = eventRng(s, "center_round");
  const bought: { teamId: string; landId: string; paid: number }[] = [];
  const skipped: string[] = [];
  for (const teamId of order) {
    const unsold = centerLands(s).filter((id) => s.lands[id]!.owner === null);
    if (unsold.length === 0) break;
    if (grainOf(s, teamId) - (e.frozenGrain?.[teamId] ?? 0) < price) {
      skipped.push(teamId);
      continue;
    }
    const landId = completePrefs(reqs.get(teamId)!.prefs, unsold, rng)[0]!;
    const l = s.lands[landId]!;
    l.owner = teamId;
    l.ownedSince = e.at;
    addGrain(s, teamId, -price, "center_land", e.at, { refId: "center_round", note: landId });
    bought.push({ teamId, landId, paid: price });
  }
  s.done.push("center_round");
  return { ok: true, state: s, notices: [notice("center_round", e.at, true, { order, bought, skipped })] };
}

/** After the D8 round any team may buy an unsold center land at the falling price, first come first served (§9.2). */
export function buyCenterLand(
  input: SeasonState,
  e: { teamId: string; landId: string; at: Instant; by?: string; frozenGrain?: number },
): Result<RoundRefusal> {
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  const l0 = input.lands[e.landId];
  if (!l0) return { ok: false, refusal: "unknown_land" };
  if (l0.kind !== "center") return { ok: false, refusal: "not_center" };
  if (!input.done.includes("center_round")) return { ok: false, refusal: "round_pending" };
  const day = seasonDayOf(input.opening, e.at);
  if (day > input.params.time.seasonDays) return { ok: false, refusal: "out_of_season" };
  if (l0.owner !== null) return { ok: false, refusal: "sold" };
  const price = centerLandPrice(day, input.params);
  if (grainOf(input, e.teamId) - (e.frozenGrain ?? 0) < price) return { ok: false, refusal: "not_enough_grain", detail: `needs ${price}` };
  const s = cloneState(input);
  const l = s.lands[e.landId]!;
  l.owner = e.teamId;
  l.ownedSince = e.at;
  addGrain(s, e.teamId, -price, "center_land", e.at, { refId: e.landId });
  const notices: Notice[] = [notice("center_bought", e.at, true, { teamId: e.teamId, landId: e.landId, price, day })];
  return { ok: true, state: s, notices };
}
