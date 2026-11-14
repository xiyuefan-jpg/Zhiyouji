/**
 * PRD part 3 §18 edge cases and §20 rules that had no test of their own
 * (found when checking the acceptance list, PRD part 9 §2).
 */

import { describe, expect, it } from "vitest";
import { checkLedger, computeScholarship, DEFAULT_PARAMS as P, pts, settleWarMatch } from "../../src/index.js";
import { memberLeaves, pointsOf, settleContest, settleDay, startContest, systemAssignLeaders, useItem } from "../../src/season/index.js";
import type { SeasonState } from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

const base = () => withOwners(newSeason(), defaultOwners);

describe("§18 edge cases", () => {
  it("the defender lost every member during the contest: settles as not defended", () => {
    let s = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    for (const m of s.teams.T2!.members) s = ok(memberLeaves(s, { childId: m.childId, at: at(3, 10) }));
    s = ok(settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 70 } }));
    expect(s.contests.K1!.outcome).toEqual({ kind: "captured", winner: "T1" });
    expect(s.lands.E2!.owner).toBe("T1");
    expect(checkLedger(s.ledger)).toEqual([]);
  });

  it("a team defends one land and attacks another at the same time; each settles on its own", () => {
    let s = ok(startContest(base(), { contestId: "KA", teamId: "T1", landId: "E2", at: at(2, 10) })); // T2 defends E2
    s = ok(startContest(s, { contestId: "KB", teamId: "T2", landId: "E3", at: at(2, 11) })); // T2 attacks E3
    s = ok(settleContest(s, { contestId: "KA", at: at(5, 21), scores: { T1: 60, T2: 75 } }));
    s = ok(settleContest(s, { contestId: "KB", at: at(5, 21), scores: { T2: 80, T3: 60 } }));
    expect(s.contests.KA!.outcome).toEqual({ kind: "defended" });
    expect(s.contests.KB!.outcome).toEqual({ kind: "captured", winner: "T2" });
    expect([s.lands.E2!.owner, s.lands.E3!.owner]).toEqual(["T2", "T2"]);
    expect(checkLedger(s.ledger)).toEqual([]);
  });

  it("the land no longer belongs to the defender at settlement: refused, nothing changes (the server tells an admin)", () => {
    let s = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s.lands.E2!.owner = "T5"; // cannot happen through the rules; simulates a broken state
    const r = settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 80, T2: 50 } });
    expect(r).toMatchObject({ ok: false, refusal: "owner_changed" });
    expect(s.contests.K1!.status).toBe("active");
  });

  it("settling twice, assigning leaders twice: the second run changes nothing", () => {
    let s = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s = ok(settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 80, T2: 50 } }));
    const n = s.ledger.length;
    expect(settleContest(s, { contestId: "K1", at: at(5, 22), scores: { T1: 80, T2: 50 } }).ok).toBe(false);
    s = ok(systemAssignLeaders(s, { at: at(1, 12) }));
    expect(systemAssignLeaders(s, { at: at(1, 13) })).toMatchObject({ refusal: "already_done" });
    expect(s.ledger.length).toBe(n);
  });
});

describe("§20 rules", () => {
  it("20.4 三昧真火 stops when the land changes hands", () => {
    let s: SeasonState = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s.teams.T4!.items.push({ uid: "T4-sanmei", itemId: "sanmei", source: "admin", acquiredAt: 0 });
    s = ok(useItem(s, { teamId: "T4", itemId: "sanmei", at: at(3, 10), targetTeamId: "T2" }));
    expect(s.effects.at(-1)).toMatchObject({ kind: "sanmei", victim: "T2", beneficiary: "T4", landId: "E2" });
    s = ok(settleDay(s, 3));
    s = ok(settleDay(s, 4));
    // T1 captures E2 at D5 21:00, before the third day of fire
    s = ok(settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 80, T2: 50 } }));
    const t4 = pointsOf(s, "T4");
    s = ok(settleDay(s, 5));
    expect(pointsOf(s, "T4") - t4).toBe(pts(1)); // only T4's own E4, nothing from E2 any more
    expect(checkLedger(s.ledger)).toEqual([]);
  });

  it("20.3 the side with no work and 玉净瓶 loses no points but opens no chest", () => {
    const [a] = settleWarMatch({ teamId: "A", score: null, yujing: true }, { teamId: "B", score: 70 }, P);
    expect(a).toMatchObject({ points: 0, chest: false });
  });

  it("20.7 the rounding difference of the scholarships goes to rank 1", () => {
    const ranked = [3, 2.5, 2, 1.7, 1.3, 1.1, 0.9, 0.6].map((p, i) => ({ teamId: `T${i + 1}`, points: pts(p * 10) }));
    for (const pool of [10000, 9999, 7777, 3001]) {
      const lines = computeScholarship(ranked, pool, P);
      expect(lines.reduce((a, l) => a + l.yuan, 0)).toBe(pool);
      // every line but the first is its own exact share rounded to the yuan; the first takes what is left
      const exact = (l: (typeof lines)[number]) => pool * (P.scholarship.rankShare * l.rankShare + (1 - P.scholarship.rankShare) * l.scoreShare);
      for (const l of lines.slice(1)) expect(Math.abs(l.yuan - exact(l))).toBeLessThanOrEqual(0.5);
      expect(Number.isInteger(lines[0]!.yuan)).toBe(true);
    }
  });
});
