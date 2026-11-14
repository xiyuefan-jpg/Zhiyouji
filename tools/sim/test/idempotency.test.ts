/**
 * "同一事件执行两次不重复记账" (PRD part 9 §2, part 3 §16): every planned
 * (scheduled) event and every settlement, applied a second time right after
 * the first, is refused and leaves the state exactly as it was. Uses a whole
 * bot season so every kind runs in a realistic state.
 */
import { describe, expect, it } from "vitest";
import { applyEvent, planSeason, DEFAULT_PARAMS, type SeasonEvent, type SeasonState } from "@zhiyouji/engine";
import { simulateSeason } from "../src/index.js";

/** Events the scheduler (or a settlement job) runs; a worker may retry any of them. */
const ONCE = new Set<SeasonEvent["type"]>([
  "settle_day",
  "assign_leaders",
  "blind_auction",
  "starter_items",
  "center_round",
  "rare_round",
  "open_epic_auctions",
  "close_epic_auction",
  "pair_war",
  "settle_war",
  "participation_award",
  "settle_supply",
  "form_big_battle",
  "lock_lines",
  "settle_big_battle",
  "settle_contest",
  "daily_task_passed",
  "finalize",
] as SeasonEvent["type"][]);

describe("every scheduled event and settlement is idempotent", () => {
  it("covers every engine event of the planned-event table", () => {
    for (const row of planSeason("2027-01-03", DEFAULT_PARAMS)) if (row.engineEvent) expect(ONCE.has(row.engineEvent), row.engineEvent).toBe(true);
  });

  for (const seed of [11, 12]) {
    it(`seed ${seed}: the second run is refused and changes nothing`, () => {
      const r = simulateSeason({ seed });
      let state: SeasonState = r.initial;
      const twice = new Map<string, number>();
      for (const ev of r.events) {
        const first = applyEvent(state, ev);
        if (!first.ok) continue;
        state = first.state;
        if (!ONCE.has(ev.type)) continue;
        const before = JSON.stringify(state);
        const again = applyEvent(state, ev);
        expect(again.ok, `${ev.type} accepted twice`).toBe(false);
        expect(JSON.stringify(state)).toBe(before); // refusals never touch the state
        twice.set(ev.type, (twice.get(ev.type) ?? 0) + 1);
      }
      // the season reached the end and every kind was exercised
      expect(state.final).not.toBeNull();
      const missing = [...ONCE].filter((t) => !twice.has(t));
      expect(missing).toEqual([]);
    }, 60_000);
  }
});
