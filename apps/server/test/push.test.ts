import { describe, expect, it } from "vitest";
import { messages, opLog } from "@zhiyouji/db";
import { eq } from "drizzle-orm";
import { MANUAL_PUSH_PER_CHILD_PER_DAY } from "../src/season/operations.js";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("手动推送, 关于与 AI 公示 (part 7 §8; part 5 §8)", () => {
  it("a message to one team, then the whole server; at most 2 a day per child, the rest are skipped", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    const push = (b: unknown) => t.call("POST", "/v1/admin/push", b, boss.token);
    const st = await t.services.store.state(t.serverId);
    const mine = st.teams[t.myTeam]!.members.filter((m) => m.active).length;
    const all = st.teamOrder.reduce((n, id) => n + st.teams[id]!.members.filter((m) => m.active).length, 0);
    expect((await push({ scope: "team", teamId: t.myTeam, title: "今晚 8 点线上答疑", body: "有问题的组长可以来。" })).json()).toMatchObject({ sent: mine, skipped: 0 });
    expect((await push({ scope: "team", teamId: t.myTeam, title: "再提醒一次", body: "答疑 8 点开始。" })).json()).toMatchObject({ sent: mine, skipped: 0 });
    // the third today: my team is at the cap, the others still get it
    expect((await push({ scope: "server", serverId: t.serverId, title: "全服通知", body: "明天的军需任务提前一小时截止。" })).json()).toMatchObject({ sent: all - mine, skipped: mine });
    expect(MANUAL_PUSH_PER_CHILD_PER_DAY).toBe(2);
    const a1 = t.a1api;
    const got = (await a1("GET", "/v1/messages")).json().messages.filter((m: { type: string }) => m.type === "push");
    expect(got.map((m: { title: string }) => m.title).sort()).toEqual(["今晚 8 点线上答疑", "再提醒一次"].sort());
    // the next day the count starts again
    t.clock.set(bj("2027-02-10", 9));
    const token = await boss.relogin();
    expect((await t.call("POST", "/v1/admin/push", { scope: "team", teamId: t.myTeam, title: "早上好", body: "今天有军需任务。" }, token)).json()).toMatchObject({ sent: mine });
    expect((await t.db.select().from(opLog)).filter((o) => o.action === "manual_push")).toHaveLength(4);
    expect((await t.call("POST", "/v1/admin/push", { scope: "team", title: "x", body: "y" }, token)).statusCode).toBe(400);
    expect((await t.db.select().from(messages).where(eq(messages.type, "push"))).length).toBe(mine * 3 + all - mine);
    await t.close();
  });

  it("the admins keep the AI list; the website shows it", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    expect((await t.a1api("GET", "/v1/about")).json().ai).toEqual([]);
    const list = [
      { purpose: "作品初评、每日任务审核", model: "通义千问 VL", provider: "阿里云", filingNo: "网信算备 0000000000000000000000号" },
      { purpose: "语音转写", model: "Paraformer", provider: "阿里云" },
    ];
    expect((await t.call("PUT", "/v1/admin/about", { ai: list }, boss.token)).json().ai).toHaveLength(2);
    const shown = (await t.a1api("GET", "/v1/about")).json().ai;
    expect(shown.map((x: { purpose: string; filingNo: string | null }) => [x.purpose, x.filingNo])).toEqual([
      ["作品初评、每日任务审核", "网信算备 0000000000000000000000号"],
      ["语音转写", null],
    ]);
    // saving again replaces the list
    await t.call("PUT", "/v1/admin/about", { ai: list.slice(1) }, boss.token);
    expect((await t.a1api("GET", "/v1/about")).json().ai).toHaveLength(1);
    // reviewers can read, not change
    const rev = await t.adminUser("rev@example.com", "reviewer");
    expect((await t.call("GET", "/v1/admin/about", undefined, rev.token)).statusCode).toBe(200);
    expect((await t.call("PUT", "/v1/admin/about", { ai: [] }, rev.token)).statusCode).toBe(403);
    await t.close();
  });
});
