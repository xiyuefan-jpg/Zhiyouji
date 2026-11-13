/**
 * Mid-season shop (PRD part 3 §13.2, §13.3).
 * - Open D15 morning publication to D17 21:00; at most 3 items per team, at most 1 epic.
 * - Common: 50 grain, one of each kind per team, unlimited stock.
 * - Rare: 80 grain, 2 of each kind per server; preferences by D15 21:00 are
 *   allocated in reverse rank order, one per team per round, until stock or
 *   wishes run out; what is left is first come, first served.
 * - Epic: three 24-hour auctions from D15 evening (see EpicAuction).
 */

import { allocateByPreference, type Allocation, type PreferenceRequest } from "./allocation.js";
import { itemDef } from "./items.js";
import type { SeasonParams } from "./params.js";
import type { Instant } from "./time.js";

export interface ShopPurchases {
  /** Item ids bought in this shop by the team (any tier). */
  items: readonly string[];
}

export type ShopRefusal = "shop_limit" | "epic_limit" | "already_have_kind" | "not_enough_grain" | "out_of_stock" | "disabled";

/** Can a team buy one more item of this tier/kind? */
export function shopCheck(
  itemId: string,
  bought: ShopPurchases,
  spendableGrain: number,
  price: number,
  p: SeasonParams,
  stockLeft = Number.POSITIVE_INFINITY,
): ShopRefusal | null {
  if (p.items.disabled.includes(itemId)) return "disabled";
  if (bought.items.length >= p.items.shopMaxItems) return "shop_limit";
  const tier = itemDef(itemId).tier;
  if (tier === "epic" && bought.items.filter((i) => itemDef(i).tier === "epic").length >= p.items.shopMaxEpic) return "epic_limit";
  if (tier === "common" && bought.items.includes(itemId)) return "already_have_kind";
  if (stockLeft <= 0) return "out_of_stock";
  if (spendableGrain < price) return "not_enough_grain";
  return null;
}

export function shopPrice(itemId: string, p: SeasonParams): number {
  const tier = itemDef(itemId).tier;
  if (tier === "common") return p.items.commonPrice;
  if (tier === "rare") return p.items.rarePrice;
  throw new Error("epic items are auctioned");
}

/**
 * D15 21:00 rare-item allocation: reverse rank order (last place first), one
 * per team per round, each paying 80, until stock or wishes run out.
 */
export function allocateRareItems(input: {
  /** Teams from last place to first place. */
  reverseRankOrder: readonly string[];
  prefs: Readonly<Record<string, readonly string[]>>;
  stock: Readonly<Record<string, number>>;
  spendableGrain: Readonly<Record<string, number>>;
  bought: Readonly<Record<string, readonly string[]>>;
  p: SeasonParams;
}): Allocation[] {
  const grain: Record<string, number> = { ...input.spendableGrain };
  const bought: Record<string, string[]> = Object.fromEntries(
    input.reverseRankOrder.map((t) => [t, [...(input.bought[t] ?? [])]]),
  );
  const order: PreferenceRequest[] = input.reverseRankOrder.map((teamId) => ({
    teamId,
    prefs: (input.prefs[teamId] ?? []).filter((id) => itemDef(id).tier === "rare"),
  }));
  return allocateByPreference({
    order,
    stock: input.stock,
    rounds: "untilExhausted",
    canTake: (teamId, item) =>
      shopCheck(item, { items: bought[teamId] ?? [] }, grain[teamId] ?? 0, input.p.items.rarePrice, input.p) === null,
    onTake: (teamId, item) => {
      grain[teamId] = (grain[teamId] ?? 0) - input.p.items.rarePrice;
      (bought[teamId] ??= []).push(item);
    },
  });
}

export interface Bid {
  teamId: string;
  amount: number;
  at: Instant;
}

export interface EpicAuction {
  itemId: string;
  startAt: Instant;
  endAt: Instant;
  bids: readonly Bid[];
}

export function openEpicAuction(itemId: string, startAt: Instant, p: SeasonParams): EpicAuction {
  return { itemId, startAt, endAt: startAt + p.items.epicAuctionHours * 3_600_000, bids: [] };
}

export function leadingBid(a: EpicAuction): Bid | null {
  return a.bids.length ? (a.bids[a.bids.length - 1] as Bid) : null;
}

export function minimumBid(a: EpicAuction, p: SeasonParams): number {
  const lead = leadingBid(a);
  return lead ? lead.amount + p.items.epicIncrement : p.items.epicStartPrice;
}

export type BidRefusal = "not_open" | "closed" | "too_low" | "already_leading" | "leading_elsewhere" | "not_enough_grain" | "epic_limit";

export interface BidContext {
  /** Grain the team can still spend: balance minus grain frozen by its leading bids on other auctions. */
  spendableGrain: number;
  /** The team is already the leading bidder on another epic auction. */
  leadingElsewhere: boolean;
  /** The team already owns an epic item from this shop. */
  hasEpic: boolean;
}

/**
 * Place a bid (§13.3, §20): at least 150, then +10 over the leader; grain is
 * frozen while leading and released when outbid; a bid in the last 10 minutes
 * pushes the end back by 10 minutes. Because a team may win at most one epic,
 * it may lead on at most one auction at a time.
 */
export function placeBid(
  a: EpicAuction,
  bid: Bid,
  ctx: BidContext,
  p: SeasonParams,
): { ok: true; auction: EpicAuction; releasedFor: Bid | null } | { ok: false; refusal: BidRefusal } {
  if (bid.at < a.startAt) return { ok: false, refusal: "not_open" };
  if (bid.at >= a.endAt) return { ok: false, refusal: "closed" };
  if (ctx.hasEpic) return { ok: false, refusal: "epic_limit" };
  const lead = leadingBid(a);
  if (lead?.teamId === bid.teamId) return { ok: false, refusal: "already_leading" };
  if (ctx.leadingElsewhere) return { ok: false, refusal: "leading_elsewhere" };
  if (!Number.isInteger(bid.amount) || bid.amount < minimumBid(a, p)) return { ok: false, refusal: "too_low" };
  if (ctx.spendableGrain < bid.amount) return { ok: false, refusal: "not_enough_grain" };
  const snipeWindow = p.items.antiSnipeMinutes * 60_000;
  const endAt = bid.at >= a.endAt - snipeWindow ? a.endAt + snipeWindow : a.endAt;
  return { ok: true, auction: { ...a, endAt, bids: [...a.bids, bid] }, releasedFor: lead };
}

/** After the end: the leader wins and pays its own bid; with no bids the item stays unsold. */
export function settleEpicAuction(a: EpicAuction, now: Instant): { done: false } | { done: true; winner: Bid | null } {
  if (now < a.endAt) return { done: false };
  return { done: true, winner: leadingBid(a) };
}
