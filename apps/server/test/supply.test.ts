import { describe, expect, it } from "vitest";
import { smsOutbox } from "@zhiyouji/db";
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
});
