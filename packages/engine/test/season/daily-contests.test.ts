import { describe, expect, it } from "vitest";
import { checkLedger, pts } from "../../src/index.js";
import {
  endOfSeasonDay,
  grainOf,
  joinContest,
  pointsOf,
  quoteAttack,
  settleContest,
  settleDay,
  startContest,
  adminCancelContest,
} from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

describe("season state", () => {
  it("credits the opening grain to every team", () => {
    const s = newSeason();
    expect(grainOf(s, "T1")).toBe(60);
    expect(s.ledger).toHaveLength(8);
    expect(checkLedger(s.ledger)).toEqual([]);
  });
});

describe("daily settlement (§6)", () => {
  it("pays diminishing income per land and runs once per day", () => {
    const s0 = withOwners(newSeason(), { C1: "T1", E1: "T1", E2: "T1", E3: "T1", E4: "T2" });
    const s1 = ok(settleDay(s0, 1));
    expect(pointsOf(s1, "T1")).toBe(pts(3.96));
    expect(pointsOf(s1, "T2")).toBe(pts(1));
    expect(settleDay(s1, 1)).toEqual({ ok: false, refusal: "already_settled" });
    expect(settleDay(s1, 0)).toEqual({ ok: false, refusal: "out_of_season" });
    expect(settleDay(s1, 34)).toEqual({ ok: false, refusal: "out_of_season" });
    // input untouched
    expect(pointsOf(s0, "T1")).toBe(0);
  });
  it("pays at 24:00 of the season day", () => {
    const s = ok(settleDay(withOwners(newSeason(), defaultOwners), 3));
    const e = s.ledger.find((x) => x.source === "territory")!;
    expect(e.at).toBe(endOfSeasonDay(s, 3));
    expect(e.at).toBe(at(4, 0));
  });
  it("pays nothing while paused", () => {
    const s0 = withOwners(newSeason(), defaultOwners);
    s0.paused = true;
    const r = settleDay(s0, 2);
    expect(r.ok && pointsOf(r.state, "T1")).toBe(0);
  });
});

describe("contests (§10)", () => {
  const base = () => withOwners(newSeason(), defaultOwners);

  it("starts a contest: pays the cost, draws an unused prompt, sets the deadlines", () => {
    const s = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    // (30 + 0 + 10 × 1) = 40; T2 is not first (all at 0 points, but rank 1 is drawn) — check via quote
    const c = s.contests.K1!;
    expect(c.defender).toBe("T2");
    expect(c.attackers[0]!.paid).toBeGreaterThanOrEqual(28);
    expect(grainOf(s, "T1")).toBe(60 - c.attackers[0]!.paid);
    expect(c.promptId).toMatch(/^E2-q/);
    expect(s.usedPrompts.E2).toEqual([c.promptId]);
    expect(c.joinDeadline).toBe(at(3, 21));
    expect(c.deadline).toBe(at(5, 21));
  });

  it("refuses outside the window, own or unowned land, a second contest on the land, no prompts, no grain", () => {
    const s = base();
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(1, 20) })).toMatchObject({ refusal: "not_in_window" });
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(25, 21, 1) })).toMatchObject({ refusal: "not_in_window" });
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "E1", at: at(2, 10) })).toMatchObject({ refusal: "own_land" });
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "C1", at: at(2, 10) })).toMatchObject({ refusal: "unowned_land" });
    const s1 = ok(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(2, 10) }));
    expect(startContest(s1, { contestId: "K2", teamId: "T3", landId: "E2", at: at(2, 11) })).toMatchObject({ refusal: "contest_in_progress" });
    expect(startContest(s1, { contestId: "K", teamId: "T3", landId: "E4", at: at(2, 11) })).toMatchObject({ refusal: "duplicate_id" });
    const empty = withOwners(newSeason(undefined, 0), defaultOwners);
    expect(startContest(empty, { contestId: "K", teamId: "T1", landId: "E2", at: at(2, 10) })).toMatchObject({ refusal: "no_prompts" });
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(2, 10), frozenGrain: 30 })).toMatchObject({
      refusal: "not_enough_grain",
    });
  });

  it("checks the leader/deputy when `by` is given", () => {
    const s = base();
    s.teams.T1!.leader = "T1-m1";
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(2, 10), by: "T1-m2" })).toMatchObject({ refusal: "not_leader" });
    expect(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(2, 10), by: "T1-m1" }).ok).toBe(true);
  });

  it("counts active attacks in the next cost and lets others join before day 1 21:00", () => {
    let s = base();
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    const q = quoteAttack(s, "T1", "T3", at(2, 11));
    expect(q.base).toBe(30 + 15 + 10);
    s = ok(joinContest(s, { contestId: "K1", teamId: "T3", at: at(3, 20) }));
    expect(s.contests.K1!.attackers.map((a) => a.teamId)).toEqual(["T1", "T3"]);
    expect(joinContest(s, { contestId: "K1", teamId: "T4", at: at(3, 21) })).toMatchObject({ refusal: "join_closed" });
    expect(joinContest(s, { contestId: "K1", teamId: "T2", at: at(3, 10) })).toMatchObject({ refusal: "is_defender" });
    expect(joinContest(s, { contestId: "K1", teamId: "T3", at: at(3, 10) })).toMatchObject({ refusal: "already_in" });
  });

  it("capture: land changes hands, merit +4, income paid after the deadline moves to the winner", () => {
    let s = base();
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    for (let d = 1; d <= 5; d++) s = ok(settleDay(s, d));
    expect(settleContest(s, { contestId: "K1", at: at(5, 20), scores: {} })).toMatchObject({ refusal: "before_deadline" });
    const t2Before = pointsOf(s, "T2");
    const t1Before = pointsOf(s, "T1");
    s = ok(settleContest(s, { contestId: "K1", at: at(6, 12), scores: { T1: 80, T2: 70 } }));
    expect(s.lands.E2!.owner).toBe("T1");
    // D5 24:00 income (1 point) was after the 21:00 deadline → moved; merit +4
    expect(pointsOf(s, "T2")).toBe(t2Before - pts(1));
    expect(pointsOf(s, "T1")).toBe(t1Before + pts(1) + pts(4));
    expect(s.teams.T1!.meritCount).toBe(1);
    expect(s.contests.K1!.status).toBe("settled");
    expect(checkLedger(s.ledger)).toEqual([]);
    // T1 now holds 2 lands
    s = ok(settleDay(s, 6));
    expect(s.ledger.filter((e) => e.teamId === "T1" && e.source === "territory" && e.note === "D6")).toHaveLength(2);
  });

  it("hold: defender wins ties, merit +3, 坚壁清野 takes 3 from each attacker", () => {
    let s = base();
    s.teams.T2!.items.push({ uid: "x", itemId: "jianbi", source: "opening", acquiredAt: 0 });
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s = ok(joinContest(s, { contestId: "K1", teamId: "T3", at: at(2, 11) }));
    s = ok(settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 70, T3: 60, T2: 70 } }));
    expect(s.lands.E2!.owner).toBe("T2");
    expect(pointsOf(s, "T2")).toBe(pts(3 + 6));
    expect(pointsOf(s, "T1")).toBe(pts(-3));
    expect(pointsOf(s, "T3")).toBe(pts(-3));
    expect(s.teams.T2!.items).toHaveLength(0);
    expect(s.usedItems.at(-1)).toMatchObject({ itemId: "jianbi", teamId: "T2", triggered: true });
  });

  it("undefended: needs the quality line, otherwise nothing happens", () => {
    let s = base();
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    const r = ok(settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 49 } }));
    expect(r.lands.E2!.owner).toBe("T2");
    expect(r.contests.K1!.outcome).toEqual({ kind: "nothing" });
    const r2 = ok(settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 50 } }));
    expect(r2.lands.E2!.owner).toBe("T1");
  });

  it("九转兵劫印 doubles merit", () => {
    let s = base();
    s.effects.push({ kind: "jiuzhuan", teamId: "T1", from: at(2, 0), until: at(7, 0) });
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s = ok(settleContest(s, { contestId: "K1", at: at(5, 21), scores: { T1: 90 } }));
    expect(pointsOf(s, "T1")).toBe(pts(8));
  });

  it("an active attack still counts after the deadline until it is settled (§20.2)", () => {
    let s = base();
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    expect(quoteAttack(s, "T1", "T3", at(6, 9)).base).toBe(55);
    s = ok(settleContest(s, { contestId: "K1", at: at(6, 10), scores: {} }));
    expect(quoteAttack(s, "T1", "T3", at(6, 11)).base).toBe(40);
  });

  it("admin cancel refunds in full or not at all", () => {
    let s = base();
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    const paid = s.contests.K1!.attackers[0]!.paid;
    const a = ok(adminCancelContest(s, { contestId: "K1", at: at(3, 10), refund: true }));
    expect(grainOf(a, "T1")).toBe(60);
    expect(a.contests.K1!.status).toBe("cancelled");
    const b = ok(adminCancelContest(s, { contestId: "K1", at: at(3, 10), refund: false }));
    expect(grainOf(b, "T1")).toBe(60 - paid);
    // the land can be attacked again, with another prompt
    const c = ok(startContest(a, { contestId: "K2", teamId: "T3", landId: "E2", at: at(3, 11) }));
    expect(c.usedPrompts.E2).toHaveLength(2);
  });
});
