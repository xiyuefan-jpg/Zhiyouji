import { describe, expect, it } from "vitest";
import { messages, opLog, smsOutbox, viewLog } from "@zhiyouji/db";
import type { FakeAiSupply } from "../src/index.js";
import { balanceOf } from "@zhiyouji/engine";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("军需任务 (part 3 §12; part 5 E9)", () => {
  it("published at its time, each member hands in, the leader writes the summary, reminder 3 h before, AI scores at the deadline and the engine pays grain", async () => {
    const t = await contestSetup(); // D2 (Tue) 10:00
    const a1 = t.a1api;
    const b1 = await t.as("13800000002", t.b1);
    expect((await a1("GET", "/v1/season/supply")).json().tasks).toEqual([]);
    expect((await a1("POST", "/v1/season/supply/1a/entry", { text: "为什么天是蓝的" })).json().error).toBe("too_early");

    t.clock.set(bj("2027-02-09", 19, 1)); // Tuesday evening: published
    let task = (await a1("GET", "/v1/season/supply")).json().tasks[0];
    expect(task).toMatchObject({ supplyId: "1a", title: "好奇心接力", summaryTask: "最值得继续探索的问题，以及理由", open: true, mine: null, summary: null });
    expect(task.deadline).toBe(bj("2027-02-10", 21).toISOString());
    const size = task.progress.members as number;
    await a1("POST", "/v1/season/supply/1a/entry", { text: "为什么天是蓝的？查了资料：瑞利散射。" });
    await b1("POST", "/v1/season/supply/1a/entry", { text: "猫为什么怕水？问了 AI 又问了兽医。" });
    await a1("POST", "/v1/season/supply/1a/entry", { text: "改一下：为什么天是蓝的？答案是瑞利散射。" });
    expect((await b1("POST", "/v1/season/supply/1a/summary", { text: "总结" })).json().error).toBe("not_leader");
    task = (await a1("POST", "/v1/season/supply/1a/summary", { text: "最值得继续探索：天为什么是蓝的" })).json().tasks[0];
    expect(task.progress).toEqual({ submitted: 2, members: size });
    expect(task.mine.text).toBe("改一下：为什么天是蓝的？答案是瑞利散射。");

    // Wednesday 18:00: everyone who has not handed in is reminded (SMS to the parents too)
    t.clock.set(bj("2027-02-10", 18, 1));
    const r1 = await t.services.supply.runDue(t.serverId);
    const st = await t.services.store.state(t.serverId);
    const everyone = st.teamOrder.reduce((n, id) => n + st.teams[id]!.members.length, 0);
    expect(r1.reminded).toBe(everyone - 2);
    expect((await t.db.select().from(smsOutbox)).some((s) => s.kind === "supply_due")).toBe(true);
    const a2 = await t.as("13800000001", t.a2);
    expect((await a2("GET", "/v1/messages")).json().messages.some((m: { type: string }) => m.type === "supply_due")).toBe(true);
    expect((await a1("GET", "/v1/messages")).json().messages.some((m: { type: string }) => m.type === "supply_due")).toBe(false);

    // Wednesday 21:00: scored and paid
    expect((await a1("POST", "/v1/season/supply/1a/entry", { text: "迟到了" })).json().error).toBeUndefined();
    t.clock.set(bj("2027-02-10", 21, 1));
    expect((await a1("POST", "/v1/season/supply/1a/entry", { text: "迟到了" })).json().error).toBe("too_late");
    const grainBefore = balanceOf((await t.services.store.state(t.serverId)).ledger, t.myTeam, "grain");
    expect((await t.services.supply.runDue(t.serverId)).settled).toBe(1);
    expect((await t.services.supply.runDue(t.serverId)).settled).toBe(0);
    const after = await t.services.store.state(t.serverId);
    const paid = balanceOf(after.ledger, t.myTeam, "grain") - grainBefore;
    // participation 40 × 2/size + quality 16 + summary 15
    const score = (40 * 2) / size + 16 + 15;
    expect(paid).toBe(score >= 65 ? 30 : score >= 50 ? 20 : 10);
    const res = (await a1("GET", "/v1/season/supply")).json().tasks.find((x: { supplyId: string }) => x.supplyId === "1a").result;
    expect(res).toMatchObject({ submittedMembers: 2, quality: 16, summary: 15, grain: paid });
    // a team where nobody handed in gets nothing
    const quiet = after.teamOrder.find((id) => id !== t.myTeam)!;
    expect(after.ledger.filter((e) => e.teamId === quiet && e.source === "supply").reduce((s, e) => s + e.amount, 0)).toBe(0);
    await t.close();
  });

  it("the AI fails at the deadline: no pay-out yet, retried a minute later, paid with the AI's tiers once it answers (part 6 §5)", async () => {
    const t = await contestSetup();
    const a1 = t.a1api;
    t.clock.set(bj("2027-02-09", 19, 1));
    await a1("POST", "/v1/season/supply/1a/entry", { text: "为什么天是蓝的？查了资料：瑞利散射。" });
    await a1("POST", "/v1/season/supply/1a/summary", { text: "最值得继续探索：天为什么是蓝的" });
    const ai = t.services.aiSupply as FakeAiSupply;
    ai.fail = true;
    t.clock.set(bj("2027-02-10", 21, 1));
    expect((await t.services.supply.runDue(t.serverId)).settled).toBe(0);
    expect((await t.services.store.state(t.serverId)).done).not.toContain("supply:1a");
    // within the wait: not even tried
    t.clock.advance(30_000);
    expect((await t.services.supply.runDue(t.serverId)).settled).toBe(0);
    ai.fail = false;
    t.clock.advance(60_000);
    expect((await t.services.supply.runDue(t.serverId)).settled).toBe(1);
    const res = (await a1("GET", "/v1/season/supply")).json().tasks.find((x: { supplyId: string }) => x.supplyId === "1a").result;
    expect(res).toMatchObject({ submittedMembers: 1, quality: 8, summary: 15 });
    expect((await t.db.select().from(messages)).some((m) => m.type === "ai_failed")).toBe(false);
    await t.close();
  });

  it("the AI keeps failing for 2 hours: settled on participation alone and the admins are told", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    void boss;
    t.clock.set(bj("2027-02-09", 19, 1));
    await t.a1api("POST", "/v1/season/supply/1a/entry", { text: "为什么天是蓝的？" });
    (t.services.aiSupply as FakeAiSupply).fail = true;
    let settled = 0;
    for (let m = 1; m <= 125; m++) {
      t.clock.set(new Date(+bj("2027-02-10", 21) + m * 60_000));
      settled += (await t.services.supply.runDue(t.serverId)).settled;
      if (settled) break;
    }
    expect(settled).toBe(1);
    expect(+t.clock.now() - +bj("2027-02-10", 21)).toBeGreaterThanOrEqual(120 * 60_000);
    const res = (await t.a1api("GET", "/v1/season/supply")).json().tasks.find((x: { supplyId: string }) => x.supplyId === "1a").result;
    expect(res).toMatchObject({ submittedMembers: 1, quality: 0, summary: 0 });
    const msg = (await t.db.select().from(messages)).find((m) => m.type === "ai_failed")!;
    expect(msg.body).toContain("改档");
    await t.close();
  });

  it("抽查改档 (part 7 §7): the admin sees every team's score and tier, opens one team's hand-ins and moves it to another tier", async () => {
    const t = await contestSetup();
    const a1 = t.a1api;
    t.clock.set(bj("2027-02-09", 19, 1));
    await a1("POST", "/v1/season/supply/1a/entry", { text: "为什么天是蓝的？查了资料：瑞利散射。" });
    t.clock.set(bj("2027-02-10", 21, 1));
    await t.services.supply.runDue(t.serverId);
    const boss = await t.adminUser();
    const list = (await t.call("GET", `/v1/admin/servers/${t.serverId}/supply`, undefined, boss.token)).json();
    expect(list.tiers).toEqual([10, 20, 30]);
    const task = list.tasks.find((x: { supplyId: string }) => x.supplyId === "1a");
    expect(task.status).toBe("settled");
    const mine = task.teams.find((x: { teamId: string }) => x.teamId === t.myTeam);
    expect(mine).toMatchObject({ submittedMembers: 1, quality: 8, summary: 0, grain: 10, aiGrain: 10, regrade: null });
    expect(task.teams.find((x: { teamId: string }) => x.teamId !== t.myTeam).grain).toBe(0);
    // later tasks are listed as planned
    expect(list.tasks.some((x: { status: string }) => x.status === "planned")).toBe(true);

    // the spot check shows the hand-ins with nicknames; the view is recorded per child
    const detail = (await t.call("GET", `/v1/admin/servers/${t.serverId}/supply/1a/teams/${t.myTeam}`, undefined, boss.token)).json();
    expect(detail.entries).toEqual([expect.objectContaining({ kind: "member", childId: t.a1, text: "为什么天是蓝的？查了资料：瑞利散射。" })]);
    expect((await t.db.select().from(viewLog)).map((v) => [v.childId, v.contentKind])).toContainEqual([t.a1, "supply"]);

    const grain = () => t.services.store.state(t.serverId).then((st) => balanceOf(st.ledger, t.myTeam, "grain"));
    const before = await grain();
    const up = (b: unknown) => t.call("POST", `/v1/admin/servers/${t.serverId}/supply/1a/teams/${t.myTeam}/regrade`, b, boss.token);
    expect((await up({ grain: 25, reason: "x" })).statusCode).toBe(400); // only the tiers
    expect((await up({ grain: 30, reason: "内容很扎实，AI 低估了" })).json()).toEqual({ grain: 30, change: 20 });
    expect(await grain()).toBe(before + 20);
    // back down to 20: 10 is taken back
    expect((await up({ grain: 20, reason: "再看一次，中间那档更合适" })).json()).toEqual({ grain: 20, change: -10 });
    expect(await grain()).toBe(before + 10);
    const st = await t.services.store.state(t.serverId);
    expect(st.ledger.filter((e) => e.teamId === t.myTeam && e.source === "admin").map((e) => [e.amount, e.note])).toEqual([
      [20, "军需改档（好奇心接力）：10 → 30 粮草。内容很扎实，AI 低估了"],
      [-10, "军需改档（好奇心接力）：30 → 20 粮草。再看一次，中间那档更合适"],
    ]);
    // the team sees the new tier and gets a message; the op log has both
    const res = (await a1("GET", "/v1/season/supply")).json().tasks.find((x: { supplyId: string }) => x.supplyId === "1a").result;
    expect(res).toMatchObject({ grain: 20, regraded: true });
    expect((await a1("GET", "/v1/messages")).json().messages.filter((m: { title: string }) => m.title === "军需任务的结果调整了")).toHaveLength(2);
    expect((await t.db.select().from(opLog)).filter((o) => o.action === "supply_regrade")).toHaveLength(2);
    const after = (await t.call("GET", `/v1/admin/servers/${t.serverId}/supply`, undefined, boss.token)).json().tasks[0].teams.find((x: { teamId: string }) => x.teamId === t.myTeam);
    expect(after).toMatchObject({ grain: 20, aiGrain: 10, regrade: { grain: 20, note: "再看一次，中间那档更合适" } });
    // a team that has not been settled for this task cannot be re-tiered
    expect((await t.call("POST", `/v1/admin/servers/${t.serverId}/supply/1b/teams/${t.myTeam}/regrade`, { grain: 30, reason: "x" }, boss.token)).json().error).toBe("supply_not_settled");
    await t.close();
  });
});
