import { describe, expect, it } from "vitest";
import { createPgliteDb, grainLedger, pointsLedger, feed, plannedEvents } from "@zhiyouji/db";
import { and, eq } from "drizzle-orm";
import { balanceOf, beijingInstant, dateOfSeasonDay, pts } from "@zhiyouji/engine";
import { SeasonStore, Scheduler, SimClock } from "../src/index.js";

const OPENING = "2027-01-03";
const at = (d: number, h: number, m = 0) => new Date(beijingInstant(dateOfSeasonDay(OPENING, d), h, m));

async function setup() {
  const { db, close } = await createPgliteDb();
  const store = new SeasonStore(db);
  const teams = Array.from({ length: 8 }, (_, i) => ({
    name: `组${i + 1}`,
    members: Array.from({ length: 8 }, (_, j) => ({ childId: `T${i + 1}-m${j + 1}`, grade: 4 })),
  }));
  const { serverId, teamIds } = await store.createSeason({
    name: "S3", opening: OPENING, seed: 7, createdBy: "admin", teams, at: at(0, 19),
    prompts: Object.fromEntries(["E1", "E2", "E3"].map((l) => [l, ["q1", "q2"]])),
  });
  return { db, close, store, serverId, teamIds, T: (i: number) => teamIds[i - 1]! };
}

describe("season store", () => {
  it("creates a season, writes the opening ledger and the planned events", async () => {
    const { db, close, store, serverId, T } = await setup();
    expect(balanceOf((await store.state(serverId)).ledger, T(1), "grain")).toBe(60);
    expect(await db.select().from(grainLedger).where(eq(grainLedger.serverId, serverId))).toHaveLength(8);
    const plan = await db.select().from(plannedEvents).where(eq(plannedEvents.serverId, serverId));
    expect(plan.length).toBeGreaterThan(40);
    await close();
  });

  it("applies events, stores them, and rebuilds the state from the database alone", async () => {
    const { db, close, store, serverId, T } = await setup();
    const r = await store.apply(serverId, { type: "claim_role", teamId: T(1), role: "leader", childId: "T1-m1", at: +at(0, 19, 5) }, "child:T1-m1");
    expect(r.ok).toBe(true);
    const start = await store.apply(
      serverId,
      { type: "start_contest", contestId: "K1", teamId: T(1), landId: "E2", at: +at(2, 10), by: "T1-m1" },
      "child:T1-m1",
    );
    expect(start.ok).toBe(false); // E2 has no owner yet
    // give T1 an edge land by running the auction via scheduler-free direct event
    await store.apply(serverId, { type: "blind_auction", at: +at(1, 21), bids: [] }, "system");
    const owner = (await store.state(serverId)).lands.E2!.owner;
    const s2 = await store.apply(serverId, { type: "start_contest", contestId: "K1", teamId: owner === T(1) ? T(3) : T(1), landId: "E2", at: +at(2, 10) }, "system");
    expect(s2.ok).toBe(true);
    expect(await db.select().from(feed).where(eq(feed.serverId, serverId)).then((r) => r.length)).toBeGreaterThan(0);
    // evict and rebuild
    store.evict(serverId);
    const rebuilt = await store.state(serverId);
    expect(rebuilt.contests.K1).toBeTruthy();
    expect(rebuilt.lands.E2!.owner).toBeTruthy();
    await close();
  });
});

describe("scheduler", () => {
  it("runs due planned events in order, pulling in submissions", async () => {
    const { db, close, store, serverId, teamIds, T } = await setup();
    const clock = new SimClock(at(1, 21, 1));
    const sched = new Scheduler(db, store, clock);
    // leaders claim, then submit auction bids
    for (let i = 0; i < 8; i++)
      await store.submitAllocation({ serverId, round: "blind_auction", teamId: teamIds[i]!, bid: i * 4, prefs: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"], by: "sys", at: at(1, 10) });
    const rep = await sched.runDue(serverId);
    expect(rep.ran.find((x) => x.key === "blind_auction")!.ok).toBe(true);
    expect(rep.ran.find((x) => x.key === "assign_leaders")!.ok).toBe(true);
    const s = await store.state(serverId);
    expect(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"].every((l) => s.lands[l]!.owner !== null)).toBe(true);
    // running again does nothing new (idempotent)
    const again = await sched.runDue(serverId);
    expect(again.ran).toHaveLength(0);
    await close();
  });

  it("settles a day through the scheduler and records the points", async () => {
    const { db, close, store, serverId, teamIds } = await setup();
    const clock = new SimClock(at(1, 21, 1));
    const sched = new Scheduler(db, store, clock);
    for (let i = 0; i < 8; i++)
      await store.submitAllocation({ serverId, round: "blind_auction", teamId: teamIds[i]!, bid: 0, prefs: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"], by: "sys", at: at(1, 10) });
    await sched.runDue(serverId);
    clock.set(at(2, 0, 1));
    const rep = await sched.runDue(serverId);
    expect(rep.ran.find((x) => x.key === "settle_day:1")!.ok).toBe(true);
    const pointsRows = await db.select().from(pointsLedger).where(and(eq(pointsLedger.serverId, serverId), eq(pointsLedger.source, "territory")));
    expect(pointsRows).toHaveLength(8);
    expect(pointsRows[0]!.amount).toBe(pts(1));
    await close();
  });
});

describe("pause shift (§16)", () => {
  it("resuming pushes later shiftable planned events back by the paused time", async () => {
    const { createPgliteDb: fresh } = await import("@zhiyouji/db");
    const { db, close } = await fresh();
    const { SeasonStore: Store, Scheduler: Sched, SimClock: Clock } = await import("../src/index.js");
    const store = new Store(db);
    const teams = Array.from({ length: 8 }, (_, i) => ({ name: `组${i + 1}`, members: [{ childId: `T${i + 1}`, grade: 4 }] }));
    const { serverId } = await store.createSeason({ name: "S", opening: "2027-01-03", seed: 1, createdBy: "a", teams, at: at(0, 19) });
    const clock = new Clock(at(3, 10));
    const sched = new Sched(db, store, clock);
    await store.apply(serverId, { type: "pause", at: +at(3, 10), reason: "维护" }, "admin");
    const { plannedEvents } = await import("@zhiyouji/db");
    const { eq, and } = await import("drizzle-orm");
    const before = await db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, "war_pairing:1")));
    const DAY = 24 * 3600 * 1000;
    await store.apply(serverId, { type: "resume", at: +at(4, 10) }, "admin");
    await sched.shiftAfter(serverId, at(3, 10), DAY);
    const after = await db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, "war_pairing:1")));
    expect(+after[0]!.runAt - +before[0]!.runAt).toBe(DAY);
    // the daily settlement (not shiftable) did not move
    const day5 = await db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, "settle_day:5")));
    expect(day5[0]!.runAt).toEqual(new Date(at(6, 0)));
    await close();
  });
});
