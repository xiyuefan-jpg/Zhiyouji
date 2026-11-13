import { describe, expect, it } from "vitest";
import { pts } from "../../src/index.js";
import {
  addPoints,
  buyCenterLand,
  dailyTaskPassed,
  grainOf,
  pointsOf,
  runBlindAuction,
  runCenterRound,
  runParticipationAward,
  runStarterItems,
  settleSupply,
  useItem,
  weekEnd,
  type SeasonState,
} from "../../src/season/index.js";
import { at, CENTER, EDGE, newSeason, ok, TEAMS } from "./fixture.js";

const bidsAll = () =>
  TEAMS.slice(0, 6).map((teamId, i) => ({ teamId, bid: 10 + i * 5, prefs: [...EDGE], submittedAt: at(1, 10, i) }));

describe("D1 blind auction (§8)", () => {
  it("allocates one edge land each, highest bid first, pays the bid, runs once", () => {
    const s0 = newSeason();
    expect(runBlindAuction(s0, { at: at(1, 20), bids: [] })).toMatchObject({ refusal: "before_deadline" });
    const s = ok(runBlindAuction(s0, { at: at(1, 21), bids: bidsAll() }));
    expect(s.lands.E1!.owner).toBe("T6");
    expect(s.lands.E2!.owner).toBe("T5");
    expect(grainOf(s, "T6")).toBe(60 - 35);
    expect(EDGE.every((l) => s.lands[l]!.owner !== null)).toBe(true);
    expect(new Set(EDGE.map((l) => s.lands[l]!.owner)).size).toBe(8);
    expect(s.auctionOrder!.slice(0, 6)).toEqual(["T6", "T5", "T4", "T3", "T2", "T1"]);
    expect(runBlindAuction(s, { at: at(1, 21), bids: [] })).toMatchObject({ refusal: "already_done" });
  });
  it("starter items: reverse order, 2 each, stock 4 per kind, no duplicates", () => {
    let s = ok(runBlindAuction(newSeason(), { at: at(1, 21), bids: bidsAll() }));
    expect(runStarterItems(newSeason(), { at: at(2, 21), prefs: {} })).toMatchObject({ refusal: "auction_pending" });
    const prefs = Object.fromEntries(TEAMS.map((t) => [t, ["yujing", "taixu", "huanhun"]]));
    s = ok(runStarterItems(s, { at: at(2, 21), prefs }));
    const held = (t: string) => s.teams[t]!.items.map((i) => i.itemId).sort();
    // the last in the auction order picks first
    const last = s.auctionOrder!.at(-1)!;
    expect(held(last)).toEqual(["huanhun", "yujing"]);
    // yujing (4) and taixu (4) run out in round 1, huanhun in round 2
    expect(held("T6")).toContain("taixu");
    for (const t of TEAMS) {
      expect(s.teams[t]!.items).toHaveLength(2);
      expect(new Set(held(t)).size).toBe(2);
    }
    const all = TEAMS.flatMap(held);
    expect(all.filter((x) => x === "yujing")).toHaveLength(4);
  });
});

describe("center land (§9)", () => {
  function owned(): SeasonState {
    const s = ok(runBlindAuction(newSeason(), { at: at(1, 21), bids: [] }));
    s.teamOrder.forEach((t, i) => addPoints(s, t, pts(100 - i), "admin", at(2, 0)));
    s.ledger.push({ id: "g", teamId: "T7", currency: "grain", amount: 100, source: "admin", at: at(2, 0) });
    return s;
  }
  it("D8 round: last place first, 75 each, at most one, skips teams that cannot pay", () => {
    const s0 = owned();
    const requests = ["T1", "T2", "T7", "T8"].map((teamId) => ({ teamId, prefs: ["C1", "C2"] }));
    const s = ok(runCenterRound(s0, { at: at(8, 21), requests }));
    // T8 has 60 grain → skipped; T7 (160) takes C1
    expect(s.lands.C1!.owner).toBe("T7");
    expect(grainOf(s, "T7")).toBe(85);
    expect(s.lands.C2!.owner).toBeNull();
    expect(CENTER.filter((c) => s.lands[c]!.owner).length).toBe(1);
  });
  it("after D8: falling price, first come first served", () => {
    const s0 = owned();
    expect(buyCenterLand(s0, { teamId: "T7", landId: "C1", at: at(9, 10) })).toMatchObject({ refusal: "round_pending" });
    const s1 = ok(runCenterRound(s0, { at: at(8, 21), requests: [] }));
    // D23: 75 × 10/25 = 30
    const s2 = ok(buyCenterLand(s1, { teamId: "T1", landId: "C2", at: at(23, 10) }));
    expect(grainOf(s2, "T1")).toBe(30);
    expect(buyCenterLand(s2, { teamId: "T3", landId: "C2", at: at(23, 11) })).toMatchObject({ refusal: "sold" });
    expect(buyCenterLand(s2, { teamId: "T3", landId: "E1", at: at(23, 11) })).toMatchObject({ refusal: "not_center" });
    expect(buyCenterLand(s1, { teamId: "T1", landId: "C2", at: at(10, 10) })).toMatchObject({ refusal: "not_enough_grain" });
  });
});

describe("daily tasks (§7)", () => {
  const pass = (s: SeasonState, id: string, child: string, d: number, h: number) =>
    dailyTaskPassed(s, { taskId: id, childId: child, submittedAt: at(d, h), at: at(d, h + 1) });

  it("3 grain each, 2 a day, 4 a week, from D1, counted by submission day", () => {
    let s = newSeason();
    s = ok(pass(s, "a", "T1-m1", 0, 20));
    expect(grainOf(s, "T1")).toBe(60);
    s = ok(pass(s, "b", "T1-m1", 1, 8));
    s = ok(pass(s, "c", "T1-m1", 1, 9));
    s = ok(pass(s, "d", "T1-m1", 1, 10));
    expect(grainOf(s, "T1")).toBe(66);
    s = ok(pass(s, "e", "T1-m1", 2, 8));
    s = ok(pass(s, "f", "T1-m1", 3, 8));
    s = ok(pass(s, "g", "T1-m1", 4, 8));
    expect(grainOf(s, "T1")).toBe(72);
    s = ok(pass(s, "h", "T1-m1", 8, 8));
    expect(grainOf(s, "T1")).toBe(75);
    expect(pass(s, "h", "T1-m1", 8, 9)).toMatchObject({ refusal: "duplicate" });
    expect(pass(s, "z", "nobody", 8, 9)).toMatchObject({ refusal: "unknown_child" });
    expect(s.taskPasses.filter((t) => !t.counted).map((t) => t.id)).toEqual(["a", "d", "g"]);
  });
  it("还魂金丹: 5 grain per task for 7 days", () => {
    let s = newSeason();
    s.teams.T1!.items.push({ uid: "h", itemId: "huanhun", source: "opening", acquiredAt: 0 });
    s = ok(useItem(s, { teamId: "T1", itemId: "huanhun", at: at(2, 12) }));
    s = ok(pass(s, "a", "T1-m1", 2, 13));
    s = ok(pass(s, "b", "T1-m2", 9, 11));
    s = ok(pass(s, "c", "T1-m2", 9, 13));
    expect(grainOf(s, "T1")).toBe(60 + 5 + 5 + 3);
  });
  it("participation award: ≥75% of active members with ≥2 counted tasks → +3", () => {
    let s = newSeason();
    for (let m = 1; m <= 6; m++) {
      s = ok(pass(s, `x${m}a`, `T1-m${m}`, 2, 8));
      s = ok(pass(s, `x${m}b`, `T1-m${m}`, 3, 8));
    }
    expect(runParticipationAward(s, { week: 1, at: at(7, 23) })).toMatchObject({ refusal: "too_early" });
    const r = ok(runParticipationAward(s, { week: 1, at: weekEnd(s, 1) }));
    expect(pointsOf(r, "T1")).toBe(pts(3));
    expect(pointsOf(r, "T2")).toBe(0);
    expect(runParticipationAward(r, { week: 1, at: weekEnd(s, 1) })).toMatchObject({ refusal: "already_done" });
    expect(runParticipationAward(r, { week: 5, at: at(35, 0) })).toMatchObject({ refusal: "bad_week" });
    // 5 of 8 is not enough … unless 2 members have left
    let t = newSeason();
    for (let m = 1; m <= 5; m++) {
      t = ok(pass(t, `y${m}a`, `T2-m${m}`, 2, 8));
      t = ok(pass(t, `y${m}b`, `T2-m${m}`, 3, 8));
    }
    expect(pointsOf(ok(runParticipationAward(t, { week: 1, at: weekEnd(t, 1) })), "T2")).toBe(0);
    t.teams.T2!.members[6]!.active = false;
    t.teams.T2!.members[7]!.active = false;
    t.teams.T2!.members[5]!.active = false;
    expect(pointsOf(ok(runParticipationAward(t, { week: 1, at: weekEnd(t, 1) })), "T2")).toBe(pts(3));
  });
});

describe("supply tasks (§12)", () => {
  it("scores participation + quality + summary into grain tiers", () => {
    const s = ok(
      settleSupply(newSeason(), {
        supplyId: "W1-tue",
        at: at(3, 22),
        results: [
          { teamId: "T1", submittedMembers: 8, quality: 30, summary: 15 }, // 85 → 30
          { teamId: "T2", submittedMembers: 4, quality: 20, summary: 10 }, // 50 → 20
          { teamId: "T3", submittedMembers: 2, quality: 10, summary: 0 }, // 20 → 10
          { teamId: "T4", submittedMembers: 0, quality: 0, summary: 0 }, // nobody → 0
        ],
      }),
    );
    expect([grainOf(s, "T1"), grainOf(s, "T2"), grainOf(s, "T3"), grainOf(s, "T4")]).toEqual([90, 80, 70, 60]);
    expect(settleSupply(s, { supplyId: "W1-tue", at: at(3, 22), results: [] })).toMatchObject({ refusal: "already_done" });
  });
});
