import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { calendarDays, children, families, grainLedger, opLog, plannedEvents, seasonPlayers, teamMembers } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";

const ADMIN = "admin:test";

async function controlSetup() {
  const t = await setup(bj("2027-02-01", 10));
  const kids: string[] = [];
  for (let i = 0; i < 16; i++) {
    const [f] = await t.db.insert(families).values({ phone: `1390000${String(2000 + i)}`, consentVersion: t.cfg.policyVersion, consentAt: new Date() }).returning();
    const [c] = await t.db.insert(children).values({ familyId: f!.id, nickname: `孩子${i}`, grade: 1 + (i % 9) }).returning();
    kids.push(c!.id);
  }
  const season = await t.services.seasons.create({ name: "S3", opening: "2027-02-07", seed: 5 }, ADMIN);
  await t.services.seasons.openEnrollment(season.id, ADMIN);
  await t.services.seasons.enroll(season.id, kids.map((childId) => ({ childId })), ADMIN);
  await t.services.seasons.generateGrouping(season.id, ADMIN);
  const lands = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "C1", "C2", "C3", "C4"];
  const conf = await t.services.seasons.confirmGrouping(season.id, { prompts: Object.fromEntries(lands.map((l) => [l, ["q1", "q2"]])) }, ADMIN);
  const serverId = conf.servers[0]!.serverId;
  const teamIds = conf.servers[0]!.teamIds;
  let n = 0;
  /** A fresh admin login (sessions end after 30 idle minutes, and the clock jumps in these tests). */
  const login = async () => (await t.adminUser(`boss${n++}@example.com`)).token;
  let token = await login();
  const call = (m: "GET" | "POST", url: string, body?: unknown) => t.call(m, url, body, token);
  const relogin = async () => {
    token = await login();
  };
  return { ...t, seasonId: season.id, serverId, teamIds, kids, call, relogin, raw: t.call };
}

describe("running a season from the admin console (part 7 §2, §7, §9)", () => {
  it("interventions: ledger adjust and reversal, items, land owner, roles, withdraw — each with a reason and in the operation log", async () => {
    const t = await controlSetup();
    const [T1, T2] = t.teamIds as [string, string];
    const url = `/v1/admin/servers/${t.serverId}/interventions`;
    expect((await t.call("POST", url, { action: "adjust_ledger", teamId: T1, currency: "grain", amount: 15, reason: "" })).statusCode).toBe(400);
    const adj = await t.call("POST", url, { action: "adjust_ledger", teamId: T1, currency: "grain", amount: 15, reason: "补发军需" });
    expect(adj.statusCode).toBe(200);
    let ov = (await t.call("GET", `/v1/admin/servers/${t.serverId}`)).json();
    expect(ov.teams.find((x: { id: string }) => x.id === T1).grain).toBe(75);
    const ledger = (await t.call("GET", `/v1/admin/servers/${t.serverId}/ledger?teamId=${T1}&currency=grain`)).json().entries;
    expect(ledger[0]).toMatchObject({ amount: 15, source: "admin" });
    expect((await t.call("POST", url, { action: "reverse_entry", entryId: ledger[0].id, reason: "发错了" })).statusCode).toBe(200);
    expect((await t.call("POST", url, { action: "reverse_entry", entryId: ledger[0].id, reason: "再冲一次" })).json()).toMatchObject({ error: "already_reversed", message: "这条账目已经冲正过了" });

    // items are visible to admins (secret between children)
    await t.call("POST", url, { action: "give_item", teamId: T2, itemId: "bihuo", reason: "补偿" });
    ov = (await t.call("GET", `/v1/admin/servers/${t.serverId}`)).json();
    const item = ov.teams.find((x: { id: string }) => x.id === T2).items[0];
    expect(item).toMatchObject({ itemId: "bihuo", name: "辟火罩", source: "admin" });
    expect((await t.call("POST", url, { action: "remove_item", teamId: T2, uid: item.uid, reason: "收回" })).statusCode).toBe(200);

    expect((await t.call("POST", url, { action: "set_land_owner", landId: "E3", teamId: T1, reason: "系统故障补地" })).statusCode).toBe(200);
    expect((await t.call("GET", `/v1/admin/servers/${t.serverId}`)).json().lands.find((l: { id: string }) => l.id === "E3").owner).toBe(T1);

    const member = ov.teams.find((x: { id: string }) => x.id === T1).members[0].childId;
    expect((await t.call("POST", url, { action: "set_role", teamId: T1, role: "leader", childId: member, reason: "家长要求" })).statusCode).toBe(200);
    expect((await t.call("POST", url, { action: "withdraw", childId: member, reason: "退赛" })).statusCode).toBe(200);
    ov = (await t.call("GET", `/v1/admin/servers/${t.serverId}`)).json();
    expect(ov.teams.find((x: { id: string }) => x.id === T1).members.find((m: { childId: string }) => m.childId === member).active).toBe(false);
    expect((await t.db.select().from(seasonPlayers).where(eq(seasonPlayers.childId, member)))[0]!.status).toBe("withdrawn");
    expect((await t.db.select().from(teamMembers).where(eq(teamMembers.childId, member)))[0]!.active).toBe(false);

    const log = (await t.call("GET", `/v1/admin/op-log?object=server:${t.serverId}`)).json().entries as { action: string; reason: string }[];
    expect(log.map((e) => e.action)).toEqual(
      expect.arrayContaining(["intervene_adjust_ledger", "intervene_reverse_entry", "intervene_give_item", "intervene_remove_item", "intervene_set_land_owner", "intervene_set_role", "intervene_withdraw"]),
    );
    expect(log.find((e) => e.action === "intervene_adjust_ledger")!.reason).toBe("补发军需");
    // reviewers cannot intervene
    const r = await t.adminUser("rev@example.com", "reviewer");
    expect((await t.raw("POST", url, { action: "adjust_ledger", teamId: T1, currency: "grain", amount: 1, reason: "x" }, r.token)).json().error).toBe("forbidden");
    await t.close();
  });

  it("parameters: a new version with the changes, applied to later events and recorded on the ledger", async () => {
    const t = await controlSetup();
    const res = await t.call("POST", `/v1/admin/seasons/${t.seasonId}/params`, { patch: { dailyTask: { grainPerTask: 5 } }, note: "试运行调整" });
    expect(res.json()).toMatchObject({ version: 2, changes: { "dailyTask.grainPerTask": [3, 5] } });
    const v = (await t.call("GET", `/v1/admin/seasons/${t.seasonId}/params`)).json();
    expect(v.current.version).toBe(2);
    expect(v.versions[0]).toMatchObject({ version: 2, note: "试运行调整", changes: { "dailyTask.grainPerTask": [3, 5] } });
    expect((await t.services.store.state(t.serverId)).params.dailyTask.grainPerTask).toBe(5);
    // an unchanged patch makes no new version
    expect((await t.call("POST", `/v1/admin/seasons/${t.seasonId}/params`, { patch: { dailyTask: { grainPerTask: 5 } }, note: "x" })).json().version).toBe(2);
    await t.call("POST", `/v1/admin/servers/${t.serverId}/interventions`, { action: "adjust_ledger", teamId: t.teamIds[0], currency: "grain", amount: 1, reason: "x" });
    const rows = await t.db.select().from(grainLedger).where(eq(grainLedger.serverId, t.serverId));
    expect(rows.find((r) => r.source === "opening")!.paramVersion).toBe(1);
    expect(rows.find((r) => r.source === "admin")!.paramVersion).toBe(2);
    // the store rebuilt from the database keeps version 2
    t.services.store.evict(t.serverId);
    expect((await t.services.store.state(t.serverId)).params.dailyTask.grainPerTask).toBe(5);
    await t.close();
  });

  it("planned events: list, move a pending one, re-run only failed ones; pause and resume shift later events", async () => {
    const t = await controlSetup();
    const list = (await t.call("GET", `/v1/admin/servers/${t.serverId}/planned`)).json().events as { key: string; runAt: string; status: string }[];
    expect(list.length).toBeGreaterThan(40);
    const w1 = list.find((e) => e.key === "war_pairing:1")!;
    const moved = await t.call("POST", `/v1/admin/servers/${t.serverId}/planned/war_pairing:1/reschedule`, { runAt: bj("2027-02-11", 20).toISOString(), reason: "晚一小时" });
    expect(moved.json().runAt).toBe(bj("2027-02-11", 20).toISOString());
    expect(+new Date(moved.json().runAt) - +new Date(w1.runAt)).toBe(3_600_000);
    expect((await t.call("POST", `/v1/admin/servers/${t.serverId}/planned/war_pairing:1/rerun`)).json().error).toBe("not_failed");

    // run D0–D1, then a done event cannot be moved
    t.clock.set(bj("2027-02-08", 21, 1));
    await t.services.scheduler.runDue(t.serverId);
    await t.relogin();
    expect((await t.call("POST", `/v1/admin/servers/${t.serverId}/planned/blind_auction/reschedule`, { runAt: bj("2027-02-09", 21).toISOString(), reason: "x" })).json().error).toBe("not_pending");

    // pause for a day: later shiftable events move one day; the 24:00 settlements stay
    const before = await t.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, t.serverId), eq(plannedEvents.key, "supply_publish:1a")));
    const settle5 = await t.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, t.serverId), eq(plannedEvents.key, "settle_day:5")));
    expect((await t.call("POST", `/v1/admin/servers/${t.serverId}/pause`, { reason: "服务器维护" })).json().paused).toBe(true);
    expect((await t.services.store.state(t.serverId)).paused).toBe(true);
    t.clock.advance(24 * 3_600_000);
    await t.relogin();
    const pausedMs = (await t.call("POST", `/v1/admin/servers/${t.serverId}/resume`)).json().pausedMs as number;
    expect(pausedMs).toBeGreaterThanOrEqual(24 * 3_600_000);
    const after = await t.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, t.serverId), eq(plannedEvents.key, "supply_publish:1a")));
    expect(+after[0]!.runAt - +before[0]!.runAt).toBe(pausedMs);
    const settle5b = await t.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, t.serverId), eq(plannedEvents.key, "settle_day:5")));
    expect(settle5b[0]!.runAt).toEqual(settle5[0]!.runAt);
    expect((await t.db.select().from(opLog)).map((r) => r.action)).toEqual(expect.arrayContaining(["planned_move", "season_pause", "season_resume"]));
    await t.close();
  });

  it("calendar, report preview with a hidden line, and the final settlement waits for the big battle", async () => {
    const t = await controlSetup();
    expect((await t.call("POST", "/v1/admin/calendar/2027-02-11", { kind: "rest", note: "元宵节" })).json()).toEqual({ day: "2027-02-11", kind: "rest" });
    expect((await t.db.select().from(calendarDays))[0]).toMatchObject({ day: "2027-02-11", kind: "rest", note: "元宵节" });
    expect((await t.call("GET", "/v1/admin/calendar?from=2027-02-01&to=2027-02-28")).json().days).toHaveLength(1);

    await t.call("POST", `/v1/admin/servers/${t.serverId}/interventions`, { action: "set_land_owner", landId: "E1", teamId: t.teamIds[0], reason: "测试" });
    const lines = (await t.call("GET", `/v1/admin/servers/${t.serverId}/feed?since=${bj("2027-02-01", 0).toISOString()}`)).json().lines;
    const line = lines.find((l: { kind: string }) => l.kind === "land_owner_set");
    expect((await t.call("POST", `/v1/admin/feed/${line.id}/hide`, { reason: "测试数据" })).json().ok).toBe(true);
    expect((await t.call("GET", `/v1/admin/servers/${t.serverId}/feed?since=${bj("2027-02-01", 0).toISOString()}`)).json().lines.find((l: { id: string }) => l.id === line.id).hidden).toBe(true);
    // the first report (D0 evening) leaves the hidden line out
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.reports.runDue(t.serverId);
    const [rep] = (await t.services.reports.list({ childId: t.kids[0]!, season: await t.services.seasons.season(t.seasonId), serverId: t.serverId, serverName: "一服", teamId: t.teamIds[0]! })).reports;
    const got = await t.services.reports.get({ childId: t.kids[0]!, season: await t.services.seasons.season(t.seasonId), serverId: t.serverId, serverName: "一服", teamId: t.teamIds[0]! }, rep!.id);
    expect(got.lines.some((l) => l.kind === "land_owner_set")).toBe(false);

    await t.relogin();
    const fin = await t.call("POST", `/v1/admin/servers/${t.serverId}/finalize`, { poolYuan: 10000 });
    expect(fin.json()).toMatchObject({ error: "battle_not_settled", message: "大团战还没结算" });
    expect((await t.call("GET", `/v1/admin/servers/${t.serverId}/scholarship.csv`)).json().error).toBe("not_final");
    await t.close();
  });
});
