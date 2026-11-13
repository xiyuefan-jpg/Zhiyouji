/**
 * Mid-season shop in the season state (PRD part 3 §13.2, §13.3).
 *
 * - Open from the D15 morning publication to D17 21:00.
 * - At most 3 items per team, at most 1 epic. A leading epic bid reserves one
 *   of the 3 slots, so a team can never end up with more than 3.
 * - Common: 50, one per kind per team, unlimited stock, any time the shop is open.
 * - Rare: 80, 2 per kind; D15 21:00 allocation in reverse rank order; what is
 *   left is first come, first served until the shop closes.
 * - Epic: three 24-hour auctions from the D15 evening publication.
 */

import { allocateRareItems, minimumBid, placeBid, shopCheck, shopPrice, type BidRefusal, type ShopRefusal } from "../shop.js";
import { ITEMS, itemDef, isItemEnabled } from "../items.js";
import { dateOfSeasonDay, deadlineOn, publicationTime, type Instant } from "../time.js";
import { canActForTeam } from "./contests.js";
import {
  addGrain,
  cloneState,
  giveItem,
  grainOf,
  notice,
  rankingAt,
  spendableGrain,
  type EpicAuctionState,
  type Notice,
  type Result,
  type SeasonState,
} from "./state.js";

export type SeasonShopRefusal =
  | ShopRefusal
  | BidRefusal
  | "unknown_team"
  | "not_leader"
  | "shop_closed"
  | "rare_round_pending"
  | "already_done"
  | "before_deadline"
  | "unknown_auction"
  | "not_ended"
  | "epic_use_auction";

export function shopOpensAt(s: SeasonState): Instant {
  return publicationTime(dateOfSeasonDay(s.opening, s.params.time.shopOpenDay), "morning", s.params, s.calendar);
}

export function shopClosesAt(s: SeasonState): Instant {
  return deadlineOn(dateOfSeasonDay(s.opening, s.params.time.shopCloseDay), s.params);
}

/** D15 21:00: rare preferences are due and allocated. */
export function rareRoundAt(s: SeasonState): Instant {
  return deadlineOn(dateOfSeasonDay(s.opening, s.params.time.shopOpenDay), s.params);
}

/** D15 evening publication: the epic auctions start. */
export function epicAuctionsStartAt(s: SeasonState): Instant {
  return publicationTime(dateOfSeasonDay(s.opening, s.params.time.shopOpenDay), "evening", s.params, s.calendar);
}

function leadingOn(a: EpicAuctionState): string | null {
  return a.closed ? null : (a.bids[a.bids.length - 1]?.teamId ?? null);
}

/** Purchases plus open auctions the team is leading (each reserves a slot). */
function reservedItems(s: SeasonState, teamId: string): string[] {
  const out = [...(s.shop.bought[teamId] ?? [])];
  for (const a of s.shop.auctions) if (leadingOn(a) === teamId) out.push(a.itemId);
  return out;
}

/** Buy a common item, or a rare item after the D15 21:00 allocation, at the list price. */
export function buyShopItem(input: SeasonState, e: { teamId: string; itemId: string; at: Instant; by?: string }): Result<SeasonShopRefusal> {
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  if (e.at < shopOpensAt(input) || e.at > shopClosesAt(input)) return { ok: false, refusal: "shop_closed" };
  const tier = itemDef(e.itemId).tier;
  if (tier === "epic") return { ok: false, refusal: "epic_use_auction" };
  if (tier === "rare" && !input.done.includes("rare_round")) return { ok: false, refusal: "rare_round_pending" };
  const price = shopPrice(e.itemId, input.params);
  const stock = tier === "rare" ? (input.shop.rareStock[e.itemId] ?? 0) : Number.POSITIVE_INFINITY;
  const refusal = shopCheck(e.itemId, { items: reservedItems(input, e.teamId) }, spendableGrain(input, e.teamId), price, input.params, stock);
  if (refusal) return { ok: false, refusal };
  const s = cloneState(input);
  addGrain(s, e.teamId, -price, "shop", e.at, { refId: e.itemId });
  if (tier === "rare") s.shop.rareStock[e.itemId] = (s.shop.rareStock[e.itemId] ?? 0) - 1;
  (s.shop.bought[e.teamId] ??= []).push(e.itemId);
  giveItem(s, e.teamId, e.itemId, "shop", e.at);
  return { ok: true, state: s, notices: [notice("shop_bought", e.at, false, { teamId: e.teamId, itemId: e.itemId, price })] };
}

/** D15 21:00: rare items to the teams that asked, last place first, one per round, 80 each. */
export function runRareRound(input: SeasonState, e: { at: Instant; prefs: Readonly<Record<string, readonly string[]>> }): Result<SeasonShopRefusal> {
  if (input.done.includes("rare_round")) return { ok: false, refusal: "already_done" };
  if (e.at < rareRoundAt(input)) return { ok: false, refusal: "before_deadline" };
  const s = cloneState(input);
  const p = s.params;
  const order = rankingAt(s, e.at).map((r) => r.teamId).reverse();
  const stock = Object.fromEntries(Object.entries(s.shop.rareStock).filter(([id]) => isItemEnabled(id, p)));
  const allocs = allocateRareItems({
    reverseRankOrder: order,
    prefs: e.prefs,
    stock,
    spendableGrain: Object.fromEntries(order.map((t) => [t, spendableGrain(s, t)])),
    bought: Object.fromEntries(order.map((t) => [t, reservedItems(s, t)])),
    p,
  });
  for (const a of allocs) {
    addGrain(s, a.teamId, -p.items.rarePrice, "shop", e.at, { refId: a.item, note: "rare_round" });
    s.shop.rareStock[a.item] = (s.shop.rareStock[a.item] ?? 0) - 1;
    (s.shop.bought[a.teamId] ??= []).push(a.item);
    giveItem(s, a.teamId, a.item, "shop", e.at);
  }
  s.done.push("rare_round");
  return { ok: true, state: s, notices: [notice("rare_round", e.at, true, { order, allocations: allocs })] };
}

/** D15 evening: every enabled epic item goes up for a 24-hour auction. */
export function openEpicAuctions(input: SeasonState, e: { at: Instant }): Result<SeasonShopRefusal> {
  if (input.done.includes("epic_open")) return { ok: false, refusal: "already_done" };
  if (e.at < epicAuctionsStartAt(input)) return { ok: false, refusal: "before_deadline" };
  const s = cloneState(input);
  const p = s.params;
  for (const it of ITEMS) {
    if (it.tier !== "epic" || !isItemEnabled(it.id, p)) continue;
    s.shop.auctions.push({ itemId: it.id, startAt: e.at, endAt: e.at + p.items.epicAuctionHours * 3_600_000, bids: [], closed: false, winner: null });
  }
  s.done.push("epic_open");
  return {
    ok: true,
    state: s,
    notices: [notice("epic_auctions_open", e.at, true, { items: s.shop.auctions.map((a) => a.itemId), minimum: p.items.epicStartPrice })],
  };
}

/** Bid on an epic auction: grain is frozen while leading; one lead at a time; last-10-minute bids extend by 10 minutes. */
export function bidEpic(input: SeasonState, e: { teamId: string; itemId: string; amount: number; at: Instant; by?: string }): Result<SeasonShopRefusal> {
  if (!input.teams[e.teamId]) return { ok: false, refusal: "unknown_team" };
  if (!canActForTeam(input, e.teamId, e.by)) return { ok: false, refusal: "not_leader" };
  const idx = input.shop.auctions.findIndex((a) => a.itemId === e.itemId && !a.closed);
  if (idx < 0) return { ok: false, refusal: "unknown_auction" };
  const a0 = input.shop.auctions[idx]!;
  const others = input.shop.auctions.filter((_, i) => i !== idx);
  const bought = input.shop.bought[e.teamId] ?? [];
  // A team leading elsewhere is already refused; otherwise the bid needs a free slot.
  const leadingElsewhere = others.some((a) => leadingOn(a) === e.teamId);
  if (!leadingElsewhere && leadingOn(a0) !== e.teamId && bought.length >= input.params.items.shopMaxItems)
    return { ok: false, refusal: "shop_limit" };
  const r = placeBid(
    a0,
    { teamId: e.teamId, amount: e.amount, at: e.at },
    {
      spendableGrain: spendableGrain(input, e.teamId),
      leadingElsewhere,
      hasEpic: bought.some((i) => itemDef(i).tier === "epic"),
    },
    input.params,
  );
  if (!r.ok) return { ok: false, refusal: r.refusal, detail: r.refusal === "too_low" ? `minimum ${minimumBid(a0, input.params)}` : undefined };
  const s = cloneState(input);
  const a = s.shop.auctions[idx]!;
  a.bids.push({ teamId: e.teamId, amount: e.amount, at: e.at });
  a.endAt = r.auction.endAt;
  const notices: Notice[] = [
    notice("epic_bid", e.at, true, { itemId: e.itemId, teamId: e.teamId, amount: e.amount, endAt: a.endAt, outbid: r.releasedFor?.teamId ?? null }),
  ];
  return { ok: true, state: s, notices };
}

/** After an auction ends: the leader pays its bid and gets the item; no bids → unsold. */
export function closeEpicAuction(input: SeasonState, e: { itemId: string; at: Instant }): Result<SeasonShopRefusal> {
  const idx = input.shop.auctions.findIndex((a) => a.itemId === e.itemId && !a.closed);
  if (idx < 0) return { ok: false, refusal: "unknown_auction" };
  if (e.at < input.shop.auctions[idx]!.endAt) return { ok: false, refusal: "not_ended" };
  const s = cloneState(input);
  const a = s.shop.auctions[idx]!;
  const lead = a.bids[a.bids.length - 1] ?? null;
  a.closed = true;
  if (lead) {
    // Frozen grain could not be spent, so the balance always covers the bid.
    if (grainOf(s, lead.teamId) < lead.amount) throw new Error(`team ${lead.teamId} cannot pay its frozen bid`);
    a.winner = lead.teamId;
    addGrain(s, lead.teamId, -lead.amount, "epic_auction", e.at, { refId: a.itemId });
    (s.shop.bought[lead.teamId] ??= []).push(a.itemId);
    giveItem(s, lead.teamId, a.itemId, "auction", e.at);
  }
  return { ok: true, state: s, notices: [notice("epic_auction_closed", e.at, true, { itemId: a.itemId, winner: a.winner, amount: lead?.amount ?? null })] };
}
