import { describe, expect, it } from "vitest";
import { replay } from "@zhiyouji/engine";
import { simulateSeason, summary } from "../src/index.js";

/** Refusals that bots are allowed to run into (they try things without checking first). */
const EXPECTED = new Set([
  "not_enough_grain",
  "shop_limit",
  "epic_limit",
  "leading_elsewhere",
  "already_leading",
  "too_low",
  "already_have_kind",
  "out_of_stock",
  "no_assignment",
  "bad_line",
  "too_few_lands",
  "nothing_to_copy",
  "target_has_no_land",
  "contest_closed",
  "not_held",
  "already_active",
  "no_prompts",
  "sold",
  "taken",
  "closed",
  "not_own_land",
  "invalid_target",
  "war_started",
  "no_war_week",
]);

describe("bot seasons (PRD part 9 §2)", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: runs to the end with a clean ledger`, () => {
      const r = simulateSeason({ seed });
      expect(r.ledgerProblems).toEqual([]);
      expect(r.state.final).not.toBeNull();
      expect(r.state.final!.scholarship.reduce((a, b) => a + b.yuan, 0)).toBe(10000);
      expect(r.state.settledDays).toHaveLength(33);
      expect(Object.keys(r.state.wars)).toHaveLength(4);
      expect(r.state.bigBattle?.settled).toBe(true);
      expect(r.stats.contests).toBeGreaterThan(5);
      expect(r.stats.itemsUsed).toBeGreaterThan(5);
      const unexpected = r.refusals.filter((x) => !EXPECTED.has(x.refusal));
      expect(unexpected).toEqual([]);
      // every contest is closed by the end
      expect(Object.values(r.state.contests).every((c) => c.status !== "active")).toBe(true);
      // the shown table is consistent with the ranking
      const table = summary(r);
      for (let i = 1; i < table.length; i++) expect(table[i]!.points).toBeLessThanOrEqual(table[i - 1]!.points);
    });
  }

  it("is reproducible: same seed, same season; replaying the events gives the same state", () => {
    const a = simulateSeason({ seed: 7 });
    const b = simulateSeason({ seed: 7 });
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(JSON.stringify(replay(a.initial, a.events).state)).toBe(JSON.stringify(a.state));
    const c = simulateSeason({ seed: 8 });
    expect(JSON.stringify(c.state.ledger)).not.toBe(JSON.stringify(a.state.ledger));
  }, 60_000);
});
