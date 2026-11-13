import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { children, families, files, smsOutbox, works } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

const DAY = 24 * 3_600_000;

describe("parents' data rights (part 5 G4; part 8 §4)", () => {
  it("export: one JSON file with the child's data, downloaded through a short-lived link", async () => {
    const t = await setup();
    const f = await t.family("13700000001", [{ nickname: "小红", grade: 3 }, { nickname: "小蓝", grade: 5 }]);
    await t.call("PATCH", `/v1/children/${f.childIds[0]}`, { grade: 4 }, f.token);
    const r = (await t.call("POST", "/v1/data-requests", { kind: "export", childId: f.childIds[0] }, f.token)).json().request;
    expect(r).toMatchObject({ kind: "export", status: "done" });
    const url = (await t.call("GET", `/v1/data-requests/${r.id}/download`, undefined, f.token)).json().url;
    const data = JSON.parse((await t.app.inject({ method: "GET", url })).body);
    expect(data.child).toMatchObject({ nickname: "小红", grade: 4 });
    expect(data.family.phone).toBe("13700000001");
    expect(data.gradeChanges.map((g: { toGrade: number }) => g.toGrade)).toEqual([3, 4]);
    // another family cannot use it
    const g = await t.family("13700000002", [{ nickname: "别人", grade: 3 }]);
    expect((await t.call("GET", `/v1/data-requests/${r.id}/download`, undefined, g.token)).statusCode).toBe(404);
    expect((await t.call("POST", "/v1/data-requests", { kind: "export", childId: f.childIds[0] }, g.token)).json().error).toBe("child_not_found");
    await t.close();
  });

  it("delete a child: waits 7 days (can be cancelled), then the personal data and every work the child signed are anonymized", async () => {
    const t = await contestSetup();
    await t.adminUser("boss@example.com", "admin");
    // b1 uploads a file; a1 submits the work signed by a1 and b1
    const b1 = await t.as("13800000002", t.b1);
    const up = (await b1("POST", "/v1/season/uploads", { kind: "image", contentType: "image/png", size: 3 })).json();
    await t.app.inject({ method: "PUT", url: up.upload.url, payload: Buffer.from("png"), headers: { "content-type": "image/png" } });
    await b1("POST", `/v1/season/uploads/${up.fileId}/complete`);
    await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "images", fileIds: [up.fileId], text: "说明文字", members: [t.a1, t.b1] });

    const req1 = (await t.a1api("POST", "/v1/data-requests", { kind: "delete", childId: t.a1 })).json().request;
    expect(req1.status).toBe("pending");
    expect(+new Date(req1.dueAt) - +t.clock.now()).toBe(7 * DAY);
    expect((await t.a1api("POST", `/v1/data-requests/${req1.id}/cancel`)).json().request.status).toBe("cancelled");
    const req2 = (await t.a1api("POST", "/v1/data-requests", { kind: "delete", childId: t.a1 })).json().request;
    // asking twice gives the same open request
    expect((await t.a1api("POST", "/v1/data-requests", { kind: "delete", childId: t.a1 })).json().request.id).toBe(req2.id);

    t.clock.advance(6 * DAY);
    expect((await t.services.dataRights.runDue()).deleted).toBe(0);
    t.clock.advance(DAY + 60_000);
    expect((await t.services.dataRights.runDue()).deleted).toBe(1);

    const [kid] = await t.db.select().from(children).where(eq(children.id, t.a1));
    expect(kid).toMatchObject({ nickname: "已注销", status: "deleted" });
    const [w] = await t.db.select().from(works).where(eq(works.serverId, t.serverId));
    expect(w).toMatchObject({ text: null, members: [], fileIds: [] });
    const [file] = await t.db.select().from(files).where(eq(files.id, up.fileId));
    expect(file!.status).toBe("deleted");
    expect(await t.services.storage.head(file!.storageKey)).toBeNull();
    // the team keeps its record, without the child's name
    const me = (await b1("GET", "/v1/season/me")).json();
    expect(me.members.find((m: { childId: string }) => m.childId === t.a1).nickname).toBe("已注销");
    // the sibling is untouched
    expect((await t.db.select().from(children).where(eq(children.id, t.a2)))[0]!.status).toBe("active");
    await t.close();
  });

  it("2 years without login: SMS 30 days before, a login keeps the account, otherwise the family is deleted", async () => {
    const t = await setup(bj("2029-03-01", 10));
    const now = +t.clock.now();
    const [old] = await t.db.insert(families).values({ phone: "13600000001", createdAt: new Date(now - 800 * DAY), lastLoginAt: new Date(now - 701 * DAY) }).returning();
    const [kept] = await t.db.insert(families).values({ phone: "13600000002", createdAt: new Date(now - 800 * DAY), lastLoginAt: new Date(now - 701 * DAY) }).returning();
    await t.db.insert(children).values({ familyId: old!.id, nickname: "老用户", grade: 5 });
    const r1 = await t.services.dataRights.runDue();
    expect(r1.noticed).toBe(2);
    expect((await t.db.select().from(smsOutbox)).map((s) => [s.phone, s.kind]).sort()).toEqual([["13600000001", "inactive"], ["13600000002", "inactive"]]);
    expect((await t.services.dataRights.runDue()).noticed).toBe(0);
    // the second family logs in once
    t.clock.advance(10 * DAY);
    await t.db.update(families).set({ lastLoginAt: t.clock.now() }).where(eq(families.id, kept!.id));
    t.clock.advance(21 * DAY);
    const r2 = await t.services.dataRights.runDue();
    expect(r2.deleted).toBe(1);
    const [gone] = await t.db.select().from(families).where(eq(families.id, old!.id));
    expect(gone).toMatchObject({ status: "deleted", phone: `deleted:${old!.id}` });
    expect((await t.db.select().from(children).where(eq(children.familyId, old!.id)))[0]!.nickname).toBe("已注销");
    const [stay] = await t.db.select().from(families).where(eq(families.id, kept!.id));
    expect(stay).toMatchObject({ status: "active", inactiveNoticeAt: null });
    await t.close();
  });
});
