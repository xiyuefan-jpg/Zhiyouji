import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messages } from "@zhiyouji/db";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("观战, 作品展 and content safety (part 5 F5; part 6 §7; part 7 §8)", () => {
  it("settled works pass content safety into the showcase that free users see; blocked ones go to the queue", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser("boss@example.com", "admin");
    const rev = await t.adminUser("r@example.com", "reviewer");
    // a second attack with a work the safety service blocks
    await t.services.store.apply(t.serverId, { type: "adjust_ledger", teamId: t.myTeam, currency: "grain", amount: 100, at: +t.clock.now(), by: "admin", reason: "测试" }, "admin");
    const st0 = await t.services.store.state(t.serverId);
    const target2 = st0.landOrder.find((l) => st0.lands[l]!.kind === "edge" && st0.lands[l]!.owner && ![t.myTeam, t.defender].includes(st0.lands[l]!.owner!))!;
    const k2 = (await t.a1api("POST", "/v1/season/contests", { landId: target2 })).json().contest.id;
    await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "火山为什么会喷发", members: [t.a1] });
    const bad = (await t.a1api("POST", `/v1/season/works/contest:${k2}`, { mediaKind: "text", text: "这里有违规内容", members: [t.a1] })).json().work;

    // a free user (not in any season) watches
    const free = await t.family("13300000001", [{ nickname: "观众", grade: 4 }]);
    const watch = (url: string) => t.call("GET", url, undefined, free.token);
    expect((await watch("/v1/watch/servers")).json().servers.map((s: { id: string }) => s.id)).toEqual([t.serverId]);
    const map = (await watch(`/v1/watch/${t.serverId}/map`)).json();
    expect(map.lands).toHaveLength(12);
    expect(map.lands.every((l: { mine: boolean }) => !l.mine)).toBe(true);
    expect((await watch(`/v1/watch/${t.serverId}/ranking`)).json().ranking).toHaveLength(8);
    expect((await watch(`/v1/watch/${t.serverId}/broadcasts`)).json().lines[0].text).toContain("发起了进攻");
    expect((await watch(`/v1/watch/${t.serverId}/showcase`)).json().works).toEqual([]);

    // deadline, then the time limit with nobody reviewing → settled on AI scores → safety checks
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    t.clock.set(bj("2027-02-13", 21, 2));
    await t.services.scoring.runDue(t.serverId);
    expect(await t.services.showcase.runDue(t.serverId)).toBe(2);
    expect(await t.services.showcase.runDue(t.serverId)).toBe(0);
    const show = (await watch(`/v1/watch/${t.serverId}/showcase`)).json().works;
    expect(show).toHaveLength(1);
    expect(show[0]).toMatchObject({ kind: "contest", team: expect.any(String) });
    expect(show[0].score).toEqual(expect.any(Number));
    const one = (await watch(`/v1/watch/${t.serverId}/showcase/${show[0].id}`)).json();
    expect(one.text).toBe("火山为什么会喷发");
    expect(JSON.stringify(one)).not.toContain(t.a1); // no member names or ids
    expect((await watch(`/v1/watch/${t.serverId}/showcase/${bad.id}`)).statusCode).toBe(404);

    // the blocked one: admins told; a reviewer forwards it; the admin passes it
    expect((await t.db.select().from(messages).where(eq(messages.type, "safety_block"))).length).toBeGreaterThan(0);
    const rt = await rev.relogin();
    const q = (await t.call("GET", "/v1/admin/safety", undefined, rt)).json().items;
    expect(q).toHaveLength(1);
    expect((await t.call("POST", `/v1/admin/safety/${q[0].id}/pass`, undefined, rt)).json().error).toBe("forbidden");
    await t.call("POST", `/v1/admin/safety/${q[0].id}/forward`, { note: "看起来只是误判" }, rt);
    expect((await t.db.select().from(messages).where(eq(messages.type, "safety_forward")))[0]!.body).toBe("看起来只是误判");
    const bt = await boss.relogin();
    await t.call("POST", `/v1/admin/safety/${q[0].id}/pass`, undefined, bt);
    expect((await watch(`/v1/watch/${t.serverId}/showcase`)).json().works).toHaveLength(2);
    await t.close();
  });
});
