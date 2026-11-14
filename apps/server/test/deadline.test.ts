import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { messages, plannedEvents } from "@zhiyouji/db";
import { warDeadline } from "@zhiyouji/engine";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("改截止时间 (part 3 §16; part 7 §7)", () => {
  it("an admin moves one contest's deadline and a weekly war's; the children involved are told; the war's planned row follows", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    const url = `/v1/admin/servers/${t.serverId}/interventions`;
    const st0 = await t.services.store.state(t.serverId);
    const later = st0.contests[t.contestId]!.deadline + 24 * 3_600_000;
    expect((await t.call("POST", url, { action: "set_deadline", target: `contest:${t.contestId}`, deadline: new Date(later).toISOString(), reason: "" }, boss.token)).statusCode).toBe(400);
    expect((await t.call("POST", url, { action: "set_deadline", target: `contest:${t.contestId}`, deadline: new Date(+t.clock.now() - 1).toISOString(), reason: "x" }, boss.token)).json().error).toBe("bad_deadline");
    expect((await t.call("POST", url, { action: "set_deadline", target: `contest:${t.contestId}`, deadline: new Date(later).toISOString(), reason: "停电一天" }, boss.token)).statusCode).toBe(200);
    expect((await t.services.store.state(t.serverId)).contests[t.contestId]!.deadline).toBe(later);
    const told = await t.db.select().from(messages).where(eq(messages.title, "截止时间改了"));
    expect(told.length).toBeGreaterThan(0);
    expect(told[0]!.body).toContain("区域争夺的作品");

    // W1 paired on Thursday evening; moving its planned deadline row moves the real deadline
    t.clock.set(bj("2027-02-11", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const token = await boss.relogin();
    const st1 = await t.services.store.state(t.serverId);
    const w1 = warDeadline(st1, 1) + 2 * 3_600_000;
    const r = await t.call("POST", `/v1/admin/servers/${t.serverId}/planned/war_deadline:1/reschedule`, { runAt: new Date(w1).toISOString(), reason: "主题出错，延两小时" }, token);
    expect(r.statusCode).toBe(200);
    expect(warDeadline(await t.services.store.state(t.serverId), 1)).toBe(w1);
    const [row] = await t.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, t.serverId), eq(plannedEvents.key, "war_deadline:1")));
    expect(+row!.runAt).toBe(w1);
    // the slot stays open until the new deadline
    t.clock.set(new Date(w1 - 60_000));
    const slots = (await t.a1api("GET", "/v1/season/works")).json().slots as { slot: string; open: boolean }[];
    expect(slots.find((x) => x.slot === "war:1")?.open).toBe(true);
    await t.close();
  });
});
