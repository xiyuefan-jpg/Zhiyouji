import { describe, expect, it } from "vitest";
import { checkLedger, pts } from "../../src/index.js";
import { applyEvent, pointsOf, resettleContest, settleContest, settleDay, startContest } from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

const base = () => withOwners(newSeason(), defaultOwners);

/** T1 attacks T2's E2 on D2; settled on D6 noon with the given scores; days 1–5 paid before, 6–7 after. */
function settled(scores: Record<string, number>) {
  let s = base();
  s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
  for (let d = 1; d <= 5; d++) s = ok(settleDay(s, d));
  s = ok(settleContest(s, { contestId: "K1", at: at(6, 12), scores }));
  for (let d = 6; d <= 7; d++) s = ok(settleDay(s, d));
  return s;
}

const R = { by: "admin:test", reason: "复查" };

describe("改判 recomputes a settled contest (§16, §20.4)", () => {
  it("captured → defended: merits reversed, land and its income back to the defender, defender's merit booked", () => {
    const s0 = settled({ T1: 80, T2: 70 });
    expect(s0.lands.E2!.owner).toBe("T1");
    const t1 = pointsOf(s0, "T1");
    const t2 = pointsOf(s0, "T2");
    const s = ok(resettleContest(s0, { contestId: "K1", scores: { T1: 60, T2: 70 }, at: at(8, 10), ...R }));
    expect(s.lands.E2!.owner).toBe("T2");
    expect(s.contests.K1!.outcome).toEqual({ kind: "defended" });
    expect(s.teams.T1!.meritCount).toBe(0);
    expect(s.teams.T2!.meritCount).toBe(1);
    // T1 loses merit 4, the D5 income it got moved, and E2's D6–D7 income; T2 gets all of that back plus merit 3
    const e2After = s0.ledger.filter((e) => e.source === "territory" && e.teamId === "T1" && e.refId === "land:E2").reduce((n, e) => n + e.amount, 0);
    expect(e2After).toBeGreaterThan(0);
    expect(pointsOf(s, "T1")).toBe(t1 - pts(4) - pts(1) - e2After);
    expect(pointsOf(s, "T2")).toBe(t2 + pts(1) + e2After + pts(3));
    expect(checkLedger(s.ledger)).toEqual([]);
    // only appended: every earlier entry is still there
    expect(s.ledger.slice(0, s0.ledger.length)).toEqual(s0.ledger);
  });

  it("defended → captured, with 坚壁清野 given back", () => {
    let s0 = base();
    s0.teams.T2!.items.push({ uid: "x", itemId: "jianbi", source: "opening", acquiredAt: 0 });
    s0 = ok(startContest(s0, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s0 = ok(settleContest(s0, { contestId: "K1", at: at(5, 21), scores: { T1: 70, T2: 70 } }));
    expect(pointsOf(s0, "T1")).toBe(pts(-3));
    const s = ok(resettleContest(s0, { contestId: "K1", scores: { T1: 80, T2: 70 }, at: at(6, 10), ...R }));
    expect(s.lands.E2!.owner).toBe("T1");
    expect(pointsOf(s, "T1")).toBe(pts(4)); // the 坚壁清野 −3 reversed, merit +4
    expect(pointsOf(s, "T2")).toBe(0);
    expect(s.teams.T2!.items.map((i) => i.itemId)).toEqual(["jianbi"]);
    expect(checkLedger(s.ledger)).toEqual([]);
  });

  it("the same result changes nothing; a later contest on the land, an unsettled contest or no reason is refused", () => {
    const s0 = settled({ T1: 80, T2: 70 });
    const same = resettleContest(s0, { contestId: "K1", scores: { T1: 90, T2: 70 }, at: at(8, 10), ...R });
    expect(same.ok && same.state).toBe(s0);
    expect(resettleContest(s0, { contestId: "K1", scores: {}, at: at(8, 10), by: "a", reason: " " })).toMatchObject({ refusal: "needs_reason" });
    const s1 = ok(startContest(s0, { contestId: "K2", teamId: "T3", landId: "E2", at: at(8, 10) }));
    expect(resettleContest(s1, { contestId: "K2", scores: {}, at: at(8, 11), ...R })).toMatchObject({ refusal: "not_settled" });
    expect(resettleContest(s1, { contestId: "K1", scores: { T2: 90 }, at: at(8, 11), ...R })).toMatchObject({ refusal: "later_contest" });
    // through the event entry point too
    expect(applyEvent(s0, { type: "resettle_contest", contestId: "K1", scores: { T2: 90 }, at: at(8, 11), ...R }).ok).toBe(true);
  });
});
