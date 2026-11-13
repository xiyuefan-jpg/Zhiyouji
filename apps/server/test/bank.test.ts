import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { children, families, lands, messages } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";

const ADMIN = "admin:test";

describe("题库 (part 7 §4; content library §12)", () => {
  it("templates and prompts feed the lands at confirmation; draws only enabled ones; changes reach running servers; low stock alerts", async () => {
    const t = await setup(bj("2027-02-01", 10));
    const boss = await t.adminUser();
    let token = boss.token;
    const call = (m: "GET" | "POST" | "PATCH", url: string, body?: unknown) => t.call(m, url, body, token);
    const tpl = (await call("POST", "/v1/admin/land-templates/seed-defaults")).json().templates as { id: string; name: string; kind: string }[];
    expect(tpl).toHaveLength(12);
    expect((await call("POST", "/v1/admin/land-templates/seed-defaults")).json().templates).toHaveLength(12); // idempotent
    const fire = tpl.find((x) => x.name === "火焰山")!;
    const mk = async (title: string, status = "enabled") => (await call("POST", "/v1/admin/prompts", { category: "land", landTemplateId: fire.id, title, body: `${title}的题目正文`, status })).json().prompt;
    const p1 = await mk("为什么铁锅会生锈");
    const p2 = await mk("热气球为什么能飞");
    const p3 = await mk("找出 AI 视频里的物理错误");
    await mk("草稿题", "draft");
    expect(p1.audience).toBe("一个没学过这个知识的初中生或普通成年人");
    const imp = await call("POST", "/v1/admin/prompts/import", { prompts: [{ category: "war_theme", title: "W1", body: "家里的一个小麻烦" }, { category: "supply", title: "Q1", body: "好奇心接力" }] });
    expect(imp.json().imported).toBe(2);
    expect((await call("GET", `/v1/admin/prompts?landTemplateId=${fire.id}&status=enabled`)).json().prompts).toHaveLength(3);
    expect((await call("GET", "/v1/admin/land-templates")).json().templates.find((x: { name: string }) => x.name === "火焰山").prompts).toEqual({ enabled: 3, total: 4 });

    // a season confirmed without hand-passed lands takes the bank's
    for (let i = 0; i < 8; i++) {
      const [f] = await t.db.insert(families).values({ phone: `1390000${3000 + i}`, consentVersion: t.cfg.policyVersion, consentAt: new Date() }).returning();
      await t.db.insert(children).values({ familyId: f!.id, nickname: `孩子${i}`, grade: 3 + i });
    }
    const kids = (await t.db.select().from(children)).map((c) => c.id);
    const season = await t.services.seasons.create({ name: "S3", opening: "2027-02-07", seed: 3 }, ADMIN);
    await t.services.seasons.openEnrollment(season.id, ADMIN);
    await t.services.seasons.enroll(season.id, kids.map((childId) => ({ childId })), ADMIN);
    await t.services.seasons.generateGrouping(season.id, ADMIN);
    const conf = await t.services.seasons.confirmGrouping(season.id, {}, ADMIN);
    const serverId = conf.servers[0]!.serverId;
    const landRows = await t.db.select().from(lands).where(eq(lands.serverId, serverId));
    expect(landRows.find((l) => l.code === "E1")!.name).toBe("大唐长安城");
    const fireLand = landRows.find((l) => l.name === "火焰山")!;
    expect(fireLand.code).toBe("E3");
    expect(landRows.find((l) => l.code === "C1")!.name).toBe("谛听台");
    let st = await t.services.store.state(serverId);
    expect([...st.prompts.E3!].sort()).toEqual([p1.id, p2.id, p3.id].sort());
    expect(st.prompts.E1).toEqual([]);

    // run the season to D2 and attack E3 twice (two draws); then the land is low on prompts
    t.clock.set(bj("2027-02-08", 21, 1));
    await t.services.scheduler.runDue(serverId);
    t.clock.set(bj("2027-02-09", 10));
    st = await t.services.store.state(serverId);
    const owner = st.lands.E3!.owner!;
    const [a, b] = st.teamOrder.filter((x) => x !== owner) as [string, string];
    const r1 = await t.services.store.apply(serverId, { type: "start_contest", contestId: "K1", teamId: a, landId: "E3", at: +t.clock.now() }, "system");
    expect(r1.ok).toBe(true);
    st = await t.services.store.state(serverId);
    expect([p1.id, p2.id, p3.id]).toContain(st.contests.K1!.promptId);
    expect((await t.db.select().from(messages).where(eq(messages.type, "prompts_low"))).length).toBe(0);
    // the admin cancels it to free the land, then a second draw leaves 1
    await t.services.store.apply(serverId, { type: "cancel_contest", contestId: "K1", refund: true, at: +t.clock.now() }, "admin");
    await t.services.store.apply(serverId, { type: "start_contest", contestId: "K2", teamId: b, landId: "E3", at: +t.clock.now() }, "system");
    const low = await t.db.select().from(messages).where(eq(messages.type, "prompts_low"));
    expect(low[0]!.body).toContain("火焰山只剩 1 条");
    token = await boss.relogin();
    const stock = (await call("GET", "/v1/admin/prompts/low-stock")).json().lands as { land: string; available: number }[];
    expect(stock.find((x) => x.land === "火焰山")!.available).toBe(1);
    expect(stock.find((x) => x.land === "大唐长安城")!.available).toBe(0);

    // a new prompt enabled now reaches the running server; disabling removes it from later draws
    const p5 = await mk("为什么夏天的柏油路会冒热气");
    st = await t.services.store.state(serverId);
    expect(st.prompts.E3).toContain(p5.id);
    await call("PATCH", `/v1/admin/prompts/${p5.id}`, { status: "disabled" });
    st = await t.services.store.state(serverId);
    expect(st.prompts.E3).not.toContain(p5.id);
    expect(st.usedPrompts.E3).toHaveLength(2);

    // the child sees the drawn prompt's text on the contest page
    const k2 = st.contests.K2!;
    const view = await t.services.play.contest({ childId: "x", season: await t.services.seasons.season(season.id), serverId, serverName: "一服", teamId: b }, "K2");
    expect(view.prompt!.title).toBe([p1, p2, p3].find((p) => p.id === k2.promptId)!.title);
    await t.close();
  });
});
