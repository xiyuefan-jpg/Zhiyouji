import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messages } from "@zhiyouji/db";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("公告, WeChat QR codes, envoys (part 7 §3, §8; part 5 E1, E12)", () => {
  it("announcements reach the chosen scope at the chosen time; withdrawn ones never go out", async () => {
    const t = await contestSetup();
    const outsider = await t.family("13900099999", [{ nickname: "路人", grade: 3 }]);
    await t.call("POST", "/v1/session/child", { childId: outsider.childIds[0] }, outsider.token);
    const boss = await t.adminUser();
    const call = (m: "GET" | "POST", url: string, body?: unknown) => t.call(m, url, body, boss.token);
    const a = (await call("POST", "/v1/admin/announcements", { scope: "server", serverId: t.serverId, title: "周末停服", body: "周六凌晨维护 1 小时", publishAt: bj("2027-02-09", 12).toISOString() })).json().announcement;
    const w = (await call("POST", "/v1/admin/announcements", { scope: "all", title: "撤回的", body: "x", publishAt: bj("2027-02-09", 12).toISOString() })).json().announcement;
    await call("POST", `/v1/admin/announcements/${w.id}/withdraw`);
    expect((await t.a1api("GET", "/v1/announcements")).json().announcements).toEqual([]);
    t.clock.set(bj("2027-02-09", 12, 1));
    expect(await t.services.ops.publishDue()).toBe(1);
    expect((await t.a1api("GET", "/v1/announcements")).json().announcements.map((x: { title: string }) => x.title)).toEqual(["周末停服"]);
    expect((await t.a1api("GET", "/v1/messages")).json().messages[0]).toMatchObject({ type: "announcement", title: "周末停服" });
    expect((await t.call("GET", "/v1/announcements", undefined, outsider.token)).json().announcements).toEqual([]);
    expect(a.scope).toBe("server");
    await t.close();
  });

  it("a team's QR code: only that team sees it; admins are reminded after 6 days", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    const tk = (await t.call("POST", `/v1/admin/teams/${t.myTeam}/qr/ticket`, { contentType: "image/png", size: 3 }, boss.token)).json();
    expect((await t.call("POST", `/v1/admin/teams/${t.myTeam}/qr`, { key: tk.key }, boss.token)).json().error).toBe("upload_missing");
    await t.app.inject({ method: "PUT", url: tk.upload.url, payload: Buffer.from("png"), headers: { "content-type": "image/png" } });
    expect((await t.call("POST", `/v1/admin/teams/${t.myTeam}/qr`, { key: tk.key }, boss.token)).json().ok).toBe(true);
    expect((await t.a1api("GET", "/v1/season/me")).json().team.hasWechatQr).toBe(true);
    const qr = (await t.a1api("GET", "/v1/season/qr")).json();
    expect((await t.app.inject({ method: "GET", url: qr.team.url })).body).toBe("png");
    const a2 = await t.as("13800000001", t.a2);
    expect((await a2("GET", "/v1/season/qr")).json().team).toBeNull();
    t.clock.advance(6 * 24 * 3_600_000 + 60_000);
    expect(await t.services.ops.qrReminders()).toBe(1);
    expect(await t.services.ops.qrReminders()).toBe(0);
    expect((await t.db.select().from(messages).where(eq(messages.type, "qr_expiring")))[0]!.recipientId).toBe(boss.id);
    await t.close();
  });

  it("envoys registered by a leader may hand in the camp's main-field work", async () => {
    const t = await contestSetup();
    t.clock.set(bj("2027-03-08", 12, 1)); // D29 noon: camps formed
    await t.services.scheduler.runDue(t.serverId);
    const b1 = await t.as("13800000002", t.b1);
    const me = (await b1("GET", "/v1/season/me")).json();
    const isLeader = me.role !== "member";
    const env = (await t.a1api("POST", "/v1/season/big-battle/envoys", { childId: t.b1 })).json();
    expect(env.envoys.map((e: { childId: string }) => e.childId)).toEqual([t.b1]);
    expect((await t.a1api("POST", "/v1/season/big-battle/envoys", { childId: t.a2 })).json().error).toBe("not_member");
    t.clock.set(bj("2027-03-09", 7, 1)); // D30 morning: line-ups published
    await t.services.scheduler.runDue(t.serverId);
    const camp = env.camp as string;
    const r = await b1("POST", `/v1/season/works/main:${camp}`, { mediaKind: "text", text: "主战场作品", members: [t.b1] });
    expect(r.json().work.version).toBe(1);
    // without the registration (and not a leader) it is refused
    await t.a1api("DELETE", `/v1/season/big-battle/envoys/${t.b1}`);
    if (!isLeader) expect((await b1("POST", `/v1/season/works/main:${camp}`, { mediaKind: "text", text: "再交", members: [t.b1] })).json().error).toBe("not_leader");
    await t.close();
  });
});
