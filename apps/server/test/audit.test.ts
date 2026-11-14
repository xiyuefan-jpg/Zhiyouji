import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { opLog, viewLog } from "@zhiyouji/db";
import { ADMIN_AUDIT, adminAudit, auditObject, sanitizeBody } from "../src/http/audit.js";
import { SimClock } from "../src/index.js";
import { buildApp, defaultConfig, FakeCaptcha, FakeSms } from "../src/index.js";
import { createPgliteDb } from "@zhiyouji/db";
import { setup } from "./helpers.js";

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe("admin audit coverage (PRD part 8 §3.1, §3.4; part 7 §7)", () => {
  it("every admin route has a policy, and every policy belongs to a route", async () => {
    const { db, close } = await createPgliteDb();
    const { app, adminRouteKeys } = buildApp({ db, clock: new SimClock(new Date("2027-01-04T02:00:00Z")), cfg: defaultConfig(), sms: new FakeSms(), captcha: new FakeCaptcha() });
    await app.ready();
    cleanup = async () => {
      await app.close();
      await close();
    };
    expect(adminRouteKeys.length).toBeGreaterThan(80);
    expect([...new Set(adminRouteKeys)].sort()).toEqual(Object.keys(ADMIN_AUDIT).sort());
    // every policy that is not "none" names what it writes; every "none" says why
    for (const [k, p] of Object.entries(ADMIN_AUDIT)) {
      if (p.kind === "none") expect(p.why.length, k).toBeGreaterThan(3);
      // writes are never "none" except the listed harmless ones
      if (!k.startsWith("GET ") && p.kind === "none") expect(p.why, k).toMatch(/登录|激活|已读|上传凭证/);
      if (k.startsWith("GET ")) expect(["none", "view"], k).toContain(p.kind);
    }
  });

  it("an admin route without a policy stops the app from starting", async () => {
    const { db, close } = await createPgliteDb();
    const app = Fastify();
    adminAudit(app, db, new SimClock(new Date()));
    let err: unknown = null;
    try {
      app.get("/v1/admin/something-new", async () => ({}));
      await app.ready();
    } catch (e) {
      err = e;
    }
    expect(String(err)).toMatch(/without an audit policy.*GET \/v1\/admin\/something-new/);
    await app.close().catch(() => {});
    await close();
  });

  it("the logged body drops secrets and cuts long text; objects come from the URL", () => {
    expect(sanitizeBody({ password: "x", totp: "123456", note: "a", nested: { code: "1", ok: 2 } })).toEqual({ note: "a", nested: { ok: 2 } });
    const long = sanitizeBody({ content: "字".repeat(600) }) as { content: string };
    expect(long.content).toMatch(/^字{500}…（共 600 字）$/);
    expect(auditObject("server:{id}/camp:{camp}", { id: "s1", camp: "a" })).toBe("server:s1/camp:a");
    expect(sanitizeBody(undefined)).toBeNull();
  });
});

describe("routes the services did not log now leave an operation-log line", () => {
  it("announcements, AI config and prompts: who, what, the body; a refused call writes nothing", async () => {
    const t = await setup();
    cleanup = t.close;
    const a = await t.adminUser();
    const call = (m: "GET" | "POST" | "PUT", url: string, body?: unknown) => t.call(m, url, body, a.token);

    const ann = (await call("POST", "/v1/admin/announcements", { scope: "all", title: "停服", body: "周六维护", publishAt: "2027-02-09T04:00:00Z" })).json().announcement;
    await call("POST", `/v1/admin/announcements/${ann.id}/withdraw`);
    expect((await call("PUT", "/v1/admin/ai/config/work_score", { provider: "bailian", model: "qwen-max" })).statusCode).toBe(200);
    expect((await call("POST", "/v1/admin/ai/prompts/work_score", { content: "提示词".repeat(300), note: "第二版" })).statusCode).toBe(200);
    // refused: validation error → no line
    expect((await call("POST", "/v1/admin/announcements", { scope: "all" })).statusCode).toBe(400);

    const rows = await t.db.select().from(opLog);
    const of = (action: string) => rows.filter((r) => r.action === action);
    expect(of("announcement_create")).toHaveLength(1);
    expect(of("announcement_create")[0]).toMatchObject({ actor: `admin:${a.id}`, object: "announcements", after: { scope: "all", title: "停服" } });
    expect(of("announcement_withdraw")[0]).toMatchObject({ actor: `admin:${a.id}`, object: `announcement:${ann.id}` });
    expect(of("ai_config_set")[0]).toMatchObject({ object: "ai:work_score", after: { provider: "bailian", model: "qwen-max" } });
    const p = of("ai_prompt_add")[0]!;
    expect(p.reason).toBe("第二版");
    expect(((p.after as { content: string }).content).length).toBeLessThan(600);

    // and it shows in the admin op-log query
    const q = (await call("GET", "/v1/admin/op-log?action=ai_config_set")).json();
    expect(q.entries ?? q).toHaveLength(1);
  });

  it("a reviewer's leave is logged with the reviewer as the actor; forbidden calls are not", async () => {
    const t = await setup();
    cleanup = t.close;
    const r = await t.adminUser("rev@example.com", "reviewer");
    expect((await t.call("POST", "/v1/admin/reviews/leave", { from: "2027-01-05", to: "2027-01-06" }, r.token)).statusCode).toBe(200);
    // reviewers may not change AI config → 403, nothing logged
    expect((await t.call("PUT", "/v1/admin/ai/config/work_score", { provider: "x", model: "y" }, r.token)).statusCode).toBe(403);
    const rows = await t.db.select().from(opLog);
    expect(rows.filter((x) => x.action === "reviewer_leave")).toEqual([expect.objectContaining({ actor: `admin:${r.id}`, object: "reviewer" })]);
    expect(rows.filter((x) => x.action === "ai_config_set")).toEqual([]);
  });
});

describe("looking at children's data is in the view log (PRD part 8 §3.1)", () => {
  it("child search and the roster: one line per child shown; the CSV is a download; grouping is one line", async () => {
    const t = await setup();
    cleanup = t.close;
    const a = await t.adminUser();
    const call = (m: "GET" | "POST", url: string, body?: unknown) => t.call(m, url, body, a.token);
    const f = await t.family("13800000001", [
      { nickname: "小明", grade: 5 },
      { nickname: "小红", grade: 7 },
    ]);

    const found = (await call("GET", "/v1/admin/children?q=13800000001")).json().children;
    expect(found).toHaveLength(2);
    let rows = await t.db.select().from(viewLog).where(eq(viewLog.contentKind, "child_search"));
    expect(rows.map((r) => r.childId).sort()).toEqual([...f.childIds].sort());
    expect(rows[0]).toMatchObject({ adminUserId: a.id, action: "view", objectId: "13800000001" });

    const id = (await call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-07" })).json().season.id;
    await call("POST", `/v1/admin/seasons/${id}/open-enrollment`);
    await call("POST", `/v1/admin/seasons/${id}/players`, { players: [{ childId: f.childIds[0] }] });
    expect((await call("GET", `/v1/admin/seasons/${id}/players`)).json().players).toHaveLength(1);
    expect((await call("GET", `/v1/admin/seasons/${id}/players.csv`)).statusCode).toBe(200);
    rows = await t.db.select().from(viewLog).where(eq(viewLog.contentKind, "roster"));
    expect(rows.map((r) => [r.childId, r.action, r.objectId])).toEqual(
      expect.arrayContaining([
        [f.childIds[0], "view", id],
        [f.childIds[0], "download", id],
      ]),
    );
    expect(rows).toHaveLength(2);

    // the view log is filterable by child: a parent asking "who looked at my child" gets both kinds
    const byChild = (await call("GET", `/v1/admin/view-log?childId=${f.childIds[0]}`)).json().entries;
    expect(byChild.map((e: { contentKind: string }) => e.contentKind).sort()).toEqual(["child_search", "roster", "roster"]);
  });

  it("data requests: one line per request (the family when the whole family asked)", async () => {
    const t = await setup();
    cleanup = t.close;
    const a = await t.adminUser();
    const f = await t.family("13800000002", [{ nickname: "小刚", grade: 4 }]);
    expect((await t.call("POST", "/v1/data-requests", { kind: "export", childId: f.childIds[0] }, f.token)).statusCode).toBe(200);
    expect((await t.call("GET", "/v1/admin/data-requests", undefined, a.token)).json().requests).toHaveLength(1);
    const rows = await t.db.select().from(viewLog).where(eq(viewLog.contentKind, "data_request"));
    expect(rows).toEqual([expect.objectContaining({ adminUserId: a.id, childId: f.childIds[0], action: "view" })]);
  });
});
