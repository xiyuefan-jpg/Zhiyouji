/**
 * Season calendar → planned events (PRD part 3 §3, §1.2; part 2 §4.2).
 *
 * Every row is one line of the planned-event table. The server runs the rows
 * whose `at` has passed, in order; rows with `engineEvent` call the engine,
 * the others only open or close something in the app (and appear in the
 * report). Each row can be moved by hand in the admin console; pauses shift
 * every later row by the paused time (§16).
 */

import type { SeasonParams } from "../params.js";
import { addDays, beijingInstant, dateOfSeasonDay, deadlineOn, publicationTime, type DayKindOverrides, type Instant } from "../time.js";
import type { SeasonEventType } from "./events.js";

export type PlannedKind =
  | "publish_groups"
  | "auction_open"
  | "assign_leaders"
  | "blind_auction"
  | "starter_items_open"
  | "starter_items"
  | "contests_open"
  | "supply_publish"
  | "supply_deadline"
  | "war_pairing"
  | "war_start"
  | "gift_deadline"
  | "war_deadline"
  | "participation_award"
  | "center_open"
  | "center_round"
  | "shop_open"
  | "rare_round"
  | "epic_open"
  | "epic_close"
  | "shop_close"
  | "contests_close"
  | "form_big_battle"
  | "lines_deadline"
  | "lines_publish"
  | "diaobing_close"
  | "battle_deadline"
  | "settle_day";

export interface PlannedEvent {
  /** Stable key, unique within a season, e.g. "settle_day:3" or "war_pairing:2". */
  key: string;
  kind: PlannedKind;
  at: Instant;
  /** Season day it belongs to. */
  day: number;
  /** The engine event this row triggers (needs submissions from the server), if any. */
  engineEvent: SeasonEventType | null;
  /** Moves with pauses. Daily 24:00 settlements stay put: a day that ends inside a pause pays nothing. */
  shiftable: boolean;
  data: Record<string, unknown>;
}

export function planSeason(opening: string, p: SeasonParams, calendar: DayKindOverrides = {}): PlannedEvent[] {
  const out: PlannedEvent[] = [];
  const date = (d: number) => dateOfSeasonDay(opening, d);
  const pub = (d: number, slot: "morning" | "noon" | "evening") => publicationTime(date(d), slot, p, calendar);
  const dl = (d: number) => deadlineOn(date(d), p);
  const add = (key: string, kind: PlannedKind, day: number, at: Instant, engineEvent: SeasonEventType | null = null, data: Record<string, unknown> = {}) =>
    out.push({ key, kind, at, day, engineEvent, shiftable: kind !== "settle_day", data });

  add("publish_groups", "publish_groups", 0, pub(0, "evening"));
  add("auction_open", "auction_open", 0, pub(0, "evening"));
  add("assign_leaders", "assign_leaders", 1, pub(1, "noon"), "assign_leaders");
  add("blind_auction", "blind_auction", 1, dl(1), "blind_auction");
  add("starter_items_open", "starter_items_open", 1, dl(1));
  add("contests_open", "contests_open", 1, dl(1));
  add("starter_items", "starter_items", 2, dl(2), "starter_items");

  const weeks = Math.floor((p.time.bigBattleStartDay - 1) / 7);
  for (let w = 1; w <= weeks; w++) {
    const mon = 7 * w - 6;
    add(`supply_publish:${w}a`, "supply_publish", mon + 1, pub(mon + 1, "evening"), null, { week: w, supplyId: `${w}a` });
    add(`supply_deadline:${w}a`, "supply_deadline", mon + 2, dl(mon + 2), null, { week: w, supplyId: `${w}a` });
    add(`war_pairing:${w}`, "war_pairing", mon + 3, pub(mon + 3, "evening"), "pair_war", { week: w });
    add(`war_start:${w}`, "war_start", mon + 4, pub(mon + 4, "morning"), null, { week: w });
    if (p.war.giftWeeks.includes(w)) add(`gift_deadline:${w}`, "gift_deadline", mon + 4, pub(mon + 4, "morning"), null, { week: w });
    add(`supply_publish:${w}b`, "supply_publish", mon + 5, pub(mon + 5, "morning"), null, { week: w, supplyId: `${w}b` });
    add(`supply_deadline:${w}b`, "supply_deadline", mon + 6, dl(mon + 6), null, { week: w, supplyId: `${w}b` });
    add(`war_deadline:${w}`, "war_deadline", mon + 6, dl(mon + 6), null, { week: w });
    if (w <= p.participation.weeks)
      add(`participation_award:${w}`, "participation_award", mon + 7, beijingInstant(addDays(date(mon + 6), 1), 0), "participation_award", { week: w });
  }

  const c = p.centerLand.openDay;
  add("center_open", "center_open", c, pub(c, "morning"));
  add("center_round", "center_round", c, dl(c), "center_round");

  const so = p.time.shopOpenDay;
  add("shop_open", "shop_open", so, pub(so, "morning"));
  add("rare_round", "rare_round", so, dl(so), "rare_round");
  add("epic_open", "epic_open", so, pub(so, "evening"), "open_epic_auctions");
  add("epic_close", "epic_close", so + 1, pub(so, "evening") + p.items.epicAuctionHours * 3_600_000, "close_epic_auction");
  add("shop_close", "shop_close", p.time.shopCloseDay, dl(p.time.shopCloseDay));

  add("contests_close", "contests_close", p.contest.lastInitiationDay, dl(p.contest.lastInitiationDay));

  const bb = p.time.bigBattleStartDay;
  add("form_big_battle", "form_big_battle", bb, pub(bb, p.review.w4DeadlineSlot), "form_big_battle");
  add("lines_deadline", "lines_deadline", bb, dl(bb), "lock_lines");
  add("lines_publish", "lines_publish", bb + 1, pub(bb + 1, "morning"));
  add("diaobing_close", "diaobing_close", bb + 1, pub(bb + 1, "morning") + 12 * 3_600_000);
  add("battle_deadline", "battle_deadline", p.time.seasonDays, dl(p.time.seasonDays));

  for (let d = 1; d <= p.time.seasonDays; d++)
    add(`settle_day:${d}`, "settle_day", d, beijingInstant(addDays(date(d), 1), 0), "settle_day", { day: d });

  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** Shift a planned time by the pauses that started before it (§16, §18). */
export function shiftForPauses(at: Instant, pauses: readonly { from: Instant; until: Instant | null }[], now: Instant): Instant {
  let shift = 0;
  for (const p of pauses) if (p.from < at) shift += (p.until ?? now) - p.from;
  return at + shift;
}
