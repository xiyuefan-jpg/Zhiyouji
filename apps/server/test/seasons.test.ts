import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { children, families, grainLedger, opLog, plannedEvents, seasonPlayers, servers, teamMembers } from "@zhiyouji/db";
import { balanceOf } from "@zhiyouji/engine";
import { bj, setup } from "./helpers.js";

/** Families with children straight in the database (faster than logging in 60 times). */
async function seedChildren(db: Awaited<ReturnType<typeof setup>>["db"], n: number, siblingsEvery = 0) {
  const ids: string[] = [];
  let fam: string | null = null;
  for (let i = 0; i < n; i++) {
    if (!fam || !siblingsEvery || i % siblingsEvery === 0) {
      const [f] = await db
        .insert(families)
        .values({ phone: `139${String(10_000_000 + i).slice(-8)}`, consentVersion: "2027-01", consentAt: new Date() })
        .returning();
      fam = f!.id;
    }
    const [c] = await db
      .insert(children)
      .values({ familyId: fam, nickname: `孩子${i + 1}`, grade: 1 + (i % 9) })
      .returning();
    ids.push(c!.id);
  }
  return ids;
}

async function seasonSetup() {
  const t = await setup(bj("2027-02-01", 10));
  const a = await t.adminUser();
  const call = (m: "GET" | "POST" | "PATCH", url: string, body?: unknown) => t.call(m, url, body, a.token);
  return { ...t, a, call, raw: t.call };
}

describe("seasons, enrollment and grouping (part 3 §2, §4; part 7 §2–§3)", () => {
  it("draft → enrolling → enable children → generate grouping → move → confirm creates the servers", async () => {
    const t = await seasonSetup();
    // only Sundays
    expect((await t.call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-08" })).json().error).toBe("not_sunday");
    const created = await t.call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-07", seed: 42 });
    expect(created.statusCode).toBe(200);
    const season = created.json().season;
    expect(season).toMatchObject({ status: "draft", statusLabel: "草稿", opening: "2027-02-07" });
    const id = season.id as string;

    const kids = await seedChildren(t.db, 50, 5); // every 5 children share a family (siblings)
    // enabling needs 报名中
    expect((await t.call("POST", `/v1/admin/seasons/${id}/players`, { players: [{ childId: kids[0] }] })).json().error).toBe("wrong_season_status");
    expect((await t.call("POST", `/v1/admin/seasons/${id}/open-enrollment`)).json().season.status).toBe("enrolling");

    const en = await t.call("POST", `/v1/admin/seasons/${id}/players`, {
      players: [...kids.map((c, i) => ({ childId: c, paymentNote: `订单${i + 1}` })), { childId: "00000000-0000-4000-8000-000000000000" }],
    });
    expect(en.json().enrolled).toHaveLength(50);
    expect(en.json().notFound).toHaveLength(1);
    const again = await t.call("POST", `/v1/admin/seasons/${id}/players`, { players: [{ childId: kids[0] }] });
    expect(again.json()).toMatchObject({ enrolled: [], already: [kids[0]] });

    // revoke one and re-enable another time
    expect((await t.call("POST", `/v1/admin/seasons/${id}/players/${kids[49]}/revoke`, { reason: "退费" })).statusCode).toBe(200);
    const roster = (await t.call("GET", `/v1/admin/seasons/${id}/players`)).json().players;
    expect(roster).toHaveLength(50);
    expect(roster.filter((p: { status: string }) => p.status === "enrolled")).toHaveLength(49);
    expect(roster[0]).toMatchObject({ paymentNote: "订单1", gradeLabel: "一年级" });

    const csv = await t.call("GET", `/v1/admin/seasons/${id}/players.csv`);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")).toHaveLength(51);
    expect(csv.body).toContain("订单1");

    // generate: 49 players → 8 teams of 6–7, siblings apart
    const gen = await t.call("POST", `/v1/admin/seasons/${id}/grouping/generate`);
    expect(gen.statusCode).toBe(200);
    const g = gen.json().grouping;
    expect(g.servers).toHaveLength(1);
    expect(g.servers[0].teams).toHaveLength(8);
    const sizes = g.servers[0].teams.map((x: { size: number }) => x.size);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(49);
    expect(g.siblingConflicts).toEqual([]);
    expect(g.servers[0].teams[0].name).toBe("花果山");
    expect((await t.call("GET", `/v1/admin/seasons/${id}`)).json().season.status).toBe("grouped");

    // move a child next to a sibling: the view flags it
    const team0 = g.servers[0].teams[0].members as { childId: string; familyId: string }[];
    const sib = roster.find((p: { familyId: string; childId: string; status: string }) => p.familyId === team0[0]!.familyId && p.childId !== team0[0]!.childId && p.status === "enrolled");
    const moved = await t.call("POST", `/v1/admin/seasons/${id}/grouping/move`, { childId: sib.childId, server: 0, team: 0 });
    expect(moved.json().grouping.siblingConflicts).toHaveLength(1);
    expect((await t.call("POST", `/v1/admin/seasons/${id}/grouping/move`, { childId: sib.childId, server: 0, team: 9 })).json().error).toBe("bad_position");
    const renamed = await t.call("POST", `/v1/admin/seasons/${id}/grouping/rename`, { server: 0, team: 1, name: "水帘洞" });
    expect(renamed.json().grouping.servers[0].teams[1].name).toBe("水帘洞");

    // confirm: servers, teams, members, lands, opening grain, planned events
    const conf = await t.call("POST", `/v1/admin/seasons/${id}/grouping/confirm`, { landNames: { E1: "火焰山" }, prompts: { E1: ["q1"] } });
    expect(conf.statusCode).toBe(200);
    const [sv] = conf.json().servers;
    expect(sv.teamIds).toHaveLength(8);
    const state = await t.services.store.state(sv.serverId);
    expect(Object.keys(state.teams)).toHaveLength(8);
    expect(state.teams[sv.teamIds[1]]!.name).toBe("水帘洞");
    expect(balanceOf(state.ledger, sv.teamIds[0], "grain")).toBe(state.params.opening.grain);
    expect(state.prompts.E1).toEqual(["q1"]);
    expect(await t.db.select().from(teamMembers)).toHaveLength(49);
    expect((await t.db.select().from(grainLedger).where(eq(grainLedger.serverId, sv.serverId))).length).toBe(8);
    expect((await t.db.select().from(plannedEvents).where(eq(plannedEvents.serverId, sv.serverId))).length).toBeGreaterThan(40);
    expect(await t.db.select().from(servers)).toHaveLength(1);

    // locked: no more moves, revokes or a second confirmation
    expect((await t.call("POST", `/v1/admin/seasons/${id}/grouping/move`, { childId: sib.childId, server: 0, team: 2 })).json().error).toBe("grouping_locked");
    expect((await t.call("POST", `/v1/admin/seasons/${id}/players/${kids[0]}/revoke`, { reason: "x" })).json().error).toBe("grouping_locked");
    expect((await t.call("POST", `/v1/admin/seasons/${id}/grouping/confirm`, {})).json().error).toBe("grouping_locked");
    const roster2 = (await t.call("GET", `/v1/admin/seasons/${id}/players`)).json().players;
    expect(roster2.find((p: { childId: string }) => p.childId === sib.childId).team).toBe("花果山");

    // D0 evening: the worker publishes the groups and the season is 进行中
    t.clock.set(bj("2027-02-07", 20, 1));
    await t.services.scheduler.runDue(sv.serverId);
    expect((await t.services.seasons.season(id)).status).toBe("running");

    const actions = (await t.db.select().from(opLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["season_create", "season_status", "season_enroll", "season_revoke", "grouping_generate", "grouping_move", "team_rename", "grouping_confirm"]));
    await t.close();
  });

  it("splits into two servers above 88 players, and reviewers cannot set up seasons", async () => {
    const t = await seasonSetup();
    const id = (await t.call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-07" })).json().season.id;
    await t.call("POST", `/v1/admin/seasons/${id}/open-enrollment`);
    const kids = await seedChildren(t.db, 90);
    await t.call("POST", `/v1/admin/seasons/${id}/players`, { players: kids.map((childId) => ({ childId })) });
    const g = (await t.call("POST", `/v1/admin/seasons/${id}/grouping/generate`)).json().grouping;
    expect(g.servers.map((s: { name: string }) => s.name)).toEqual(["一服", "二服"]);
    expect(g.servers.flatMap((s: { teams: unknown[] }) => s.teams)).toHaveLength(16);
    // unique team names across both servers
    const names = g.servers.flatMap((s: { teams: { name: string }[] }) => s.teams.map((x) => x.name));
    expect(new Set(names).size).toBe(16);
    const conf = (await t.call("POST", `/v1/admin/seasons/${id}/grouping/confirm`, {})).json();
    expect(conf.servers).toHaveLength(2);
    expect(await t.db.select().from(teamMembers)).toHaveLength(90);

    // §18 双服: two independent servers — map, teams, ledger, used prompts, pauses
    const [s1, s2] = conf.servers.map((x: { serverId: string }) => x.serverId) as [string, string];
    const before2 = structuredClone(await t.services.store.state(s2));
    const st1 = await t.services.store.state(s1);
    expect(Object.keys(st1.teams).some((tm) => tm in before2.teams)).toBe(false);
    const team1 = st1.teamOrder[0]!;
    const at = +t.clock.now();
    await t.services.store.apply(s1, { type: "adjust_ledger", teamId: team1, currency: "grain", amount: 50, at, by: "admin:test", reason: "测试" }, "admin:test");
    await t.services.store.apply(s1, { type: "set_land_owner", landId: "E1", teamId: team1, at, by: "admin:test", reason: "测试" }, "admin:test");
    await t.services.store.apply(s1, { type: "pause", at, reason: "只停一服" }, "admin:test");
    const after1 = await t.services.store.state(s1);
    const after2 = await t.services.store.state(s2);
    expect(after1.paused).toBe(true);
    expect(after1.lands.E1!.owner).toBe(team1);
    expect(after2).toEqual(before2);

    const r = await t.adminUser("helper@example.com", "reviewer");
    expect((await t.raw("POST", "/v1/admin/seasons", { name: "X", opening: "2027-02-07" }, r.token)).json().error).toBe("forbidden");
    expect((await t.raw("GET", "/v1/admin/seasons", undefined, r.token)).statusCode).toBe(200);
    await t.close();
  });

  it("too few players, reopen enrollment drops the draft, child search by phone or nickname", async () => {
    const t = await seasonSetup();
    const id = (await t.call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-07" })).json().season.id;
    await t.call("POST", `/v1/admin/seasons/${id}/open-enrollment`);
    const kids = await seedChildren(t.db, 9);
    await t.call("POST", `/v1/admin/seasons/${id}/players`, { players: kids.slice(0, 5).map((childId) => ({ childId })) });
    expect((await t.call("POST", `/v1/admin/seasons/${id}/grouping/generate`)).json()).toMatchObject({ error: "too_few_players", need: 8, have: 5 });
    await t.call("POST", `/v1/admin/seasons/${id}/players`, { players: kids.map((childId) => ({ childId })) });
    expect((await t.call("POST", `/v1/admin/seasons/${id}/grouping/generate`)).statusCode).toBe(200);
    const re = await t.call("POST", `/v1/admin/seasons/${id}/reopen-enrollment`);
    expect(re.json().season.status).toBe("enrolling");
    expect((await t.call("GET", `/v1/admin/seasons/${id}/grouping`)).json().error).toBe("no_grouping");

    const byPhone = (await t.call("GET", `/v1/admin/children?q=13910000003`)).json().children;
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0]).toMatchObject({ nickname: "孩子4", phoneMasked: "139****0003" });
    expect((await t.call("GET", `/v1/admin/children?q=${encodeURIComponent("孩子")}`)).json().children).toHaveLength(9);
    expect(await t.db.select().from(seasonPlayers)).toHaveLength(9);
    await t.close();
  });

  it("表格批量开通 (part 7 §3): each row is matched by the parent's phone (and the nickname when there are siblings), then the matched ones are enabled", async () => {
    const t = await seasonSetup();
    const id = (await t.call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-07" })).json().season.id;
    await t.call("POST", `/v1/admin/seasons/${id}/open-enrollment`);
    // 6 children, siblings in pairs: 13910000000 has 孩子1 and 孩子2, 13910000002 has 孩子3 and 孩子4 …
    const kids = await seedChildren(t.db, 6, 2);
    await t.call("POST", `/v1/admin/seasons/${id}/players`, { players: [{ childId: kids[4]! }] });
    const rows = [
      { phone: "13910000000", nickname: "孩子2", paymentNote: "订单 A1" },
      { phone: "13910000002" }, // two children, no nickname
      { phone: "13910000002", nickname: "孩子9" }, // no such child
      { phone: "13999999999" }, // no such family
      { phone: "13910000004", nickname: "孩子5" }, // already enabled
    ];
    const m = (await t.call("POST", `/v1/admin/seasons/${id}/players/match`, { rows })).json().rows;
    expect(m.map((r: { status: string }) => r.status)).toEqual(["ok", "ambiguous", "no_child", "no_family", "already"]);
    expect(m[0]).toMatchObject({ line: 1, childId: kids[1], childNickname: "孩子2", paymentNote: "订单 A1", phoneMasked: "139****0000" });
    expect(m[1].candidates.map((c: { nickname: string }) => c.nickname).sort()).toEqual(["孩子3", "孩子4"]);
    expect((await t.call("POST", `/v1/admin/seasons/${id}/players/match`, { rows: [{ phone: "123" }] })).statusCode).toBe(400);
    // step 2: enable the matched ones (the console sends the "ok" rows)
    await t.call("POST", `/v1/admin/seasons/${id}/players`, { players: [{ childId: m[0].childId, paymentNote: m[0].paymentNote }] });
    const enrolled = await t.db.select().from(seasonPlayers).where(eq(seasonPlayers.seasonId, id));
    expect(enrolled.map((p) => [p.childId, p.paymentNote]).sort()).toEqual([[kids[1], "订单 A1"], [kids[4], null]].sort());
    await t.close();
  });
});
