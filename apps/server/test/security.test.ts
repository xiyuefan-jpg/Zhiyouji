/**
 * 上线前的基础安全测试 (PRD part 8 §3.1, §3.3; part 9 §2): every route is
 * closed to callers without a login, reviewers only reach what PRD part 7 §0
 * gives them, and a family cannot reach another family's children.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb } from "@zhiyouji/db";
import { buildApp, defaultConfig, FakeCaptcha, FakeSms, SimClock } from "../src/index.js";
import { setup } from "./helpers.js";

const UUID = "00000000-0000-4000-8000-000000000000";

/** A concrete URL for a route pattern (values that pass the usual param checks). */
function concrete(pattern: string): string {
  return pattern.replace(/:(\w+)/g, (_, name: string) => {
    if (/task/i.test(name)) return "work_score";
    if (name === "kind") return "daily";
    if (name === "day") return "2027-01-04";
    if (name === "camp") return "a";
    if (name === "key") return "x";
    if (name === "slot") return "contest:x";
    return UUID;
  });
}

/** Routes anyone may call (logging in and out, the documents, health; the dev storage checks its own signature). */
const PUBLIC = new Set([
  "GET /v1/health",
  "GET /v1/policy",
  "POST /v1/auth/sms-code",
  "POST /v1/auth/login",
  "POST /v1/auth/logout",
  "POST /v1/admin/auth/login",
  "POST /v1/admin/auth/logout",
  "POST /v1/admin/auth/invite/start",
  "POST /v1/admin/auth/invite/finish",
]);
const isDevStorage = (k: string) => k.includes("/v1/dev-storage");

/** What a reviewer may reach (PRD part 7 §0: 看板、复核、题库与评分; plus the daily exception queue and "转给管理员" in content safety). */
const REVIEWER = new Set([
  "GET /v1/admin/me",
  "POST /v1/admin/auth/logout",
  "GET /v1/admin/dashboard",
  "GET /v1/admin/messages",
  "GET /v1/admin/messages/unread-count",
  "POST /v1/admin/messages/:id/read",
  "POST /v1/admin/messages/read-all",
  "GET /v1/admin/reviews",
  "GET /v1/admin/reviews/:id",
  "POST /v1/admin/reviews/:id",
  "POST /v1/admin/reviews/leave",
  "GET /v1/admin/daily/exceptions",
  "POST /v1/admin/daily/:id/decide",
  "GET /v1/admin/land-templates",
  "GET /v1/admin/prompts",
  "GET /v1/admin/prompts/low-stock",
  "GET /v1/admin/seasons",
  "GET /v1/admin/seasons/:id",
  "GET /v1/admin/safety",
  "POST /v1/admin/safety/:id/forward",
  "GET /v1/admin/ai/config",
  "GET /v1/admin/ai/prompts/:task",
  "GET /v1/admin/about",
  "GET /v1/admin/rubrics",
  "GET /v1/admin/content/war-cards",
  "GET /v1/admin/content/daily-templates",
]);

let routeKeys: string[] = [];
let app: Awaited<ReturnType<typeof buildApp>>["app"];
let closeDb: () => Promise<void>;

beforeAll(async () => {
  const { db, close } = await createPgliteDb();
  closeDb = close;
  const built = buildApp({ db, clock: new SimClock(new Date("2027-01-04T02:00:00Z")), cfg: defaultConfig(), sms: new FakeSms(), captcha: new FakeCaptcha() });
  await built.app.ready();
  app = built.app;
  routeKeys = [...new Set(built.routeKeys)];
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("basic security test (PRD part 8 §3; part 9 §2)", () => {
  it("every route that is not public answers 401 without a login, before looking at the request", async () => {
    expect(routeKeys.length).toBeGreaterThan(150);
    const open: string[] = [];
    for (const k of routeKeys) {
      if (PUBLIC.has(k) || isDevStorage(k)) continue;
      const [method, pattern] = k.split(" ") as [string, string];
      const r = await app.inject({ method: method as "GET", url: concrete(pattern), payload: method === "GET" ? undefined : {} });
      if (r.statusCode !== 401) open.push(`${k} → ${r.statusCode}`);
    }
    expect(open).toEqual([]);
  });

  it("the public routes are only these", () => {
    const listed = routeKeys.filter((k) => PUBLIC.has(k));
    expect(listed.sort()).toEqual([...PUBLIC].sort());
  });
});

describe("reviewers reach only their part of the admin console (PRD part 7 §0)", () => {
  it("everything else answers 403", async () => {
    const t = await setup();
    const r = await t.adminUser("rev@example.com", "reviewer");
    const wrong: string[] = [];
    for (const k of routeKeys) {
      if (!k.includes(" /v1/admin/") || PUBLIC.has(k)) continue;
      if (k === "POST /v1/admin/auth/logout") continue; // would end the session
      const [method, pattern] = k.split(" ") as [string, string];
      const res = await t.app.inject({ method: method as "GET", url: concrete(pattern), payload: method === "GET" ? undefined : {}, headers: { authorization: `Bearer ${r.token}` } });
      const allowed = REVIEWER.has(k);
      if (allowed && (res.statusCode === 403 || res.statusCode === 401)) wrong.push(`${k} should be open to reviewers → ${res.statusCode}`);
      if (!allowed && res.statusCode !== 403) wrong.push(`${k} should be admin-only → ${res.statusCode}`);
    }
    expect(wrong).toEqual([]);
    await t.close();
  });
});

describe("a family reaches only its own children", () => {
  it("another family's child cannot be chosen, edited, exported or deleted", async () => {
    const t = await setup();
    const a = await t.family("13900000001", [{ nickname: "甲", grade: 5 }]);
    const b = await t.family("13900000002", [{ nickname: "乙", grade: 5 }]);
    const other = b.childIds[0]!;
    expect((await t.call("POST", "/v1/session/child", { childId: other }, a.token)).statusCode).toBe(404);
    expect((await t.call("PATCH", `/v1/children/${other}`, { grade: 6 }, a.token)).statusCode).toBe(404);
    expect((await t.call("POST", "/v1/data-requests", { kind: "export", childId: other }, a.token)).statusCode).toBe(404);
    expect((await t.call("POST", "/v1/data-requests", { kind: "delete", childId: other }, a.token)).statusCode).toBe(404);
    // and the other family still sees its child unchanged
    const me = (await t.call("GET", "/v1/me", undefined, b.token)).json();
    expect(me.children.find((c: { id: string }) => c.id === other)).toMatchObject({ nickname: "乙", grade: 5 });
    await t.close();
  });
});

describe("incident response (PRD part 8 §3.5)", () => {
  it("ends every open login of one side; the other side keeps working", async () => {
    const t = await setup();
    const a = await t.adminUser();
    const f = await t.family("13900000003", [{ nickname: "丙", grade: 5 }]);
    expect((await t.call("GET", "/v1/me", undefined, f.token)).statusCode).toBe(200);
    expect(await t.services.sessions.revokeKind("family")).toBe(1);
    expect((await t.call("GET", "/v1/me", undefined, f.token)).statusCode).toBe(401);
    expect((await t.call("GET", "/v1/admin/me", undefined, a.token)).statusCode).toBe(200);
    expect(await t.services.sessions.revokeKind("all")).toBe(1);
    expect((await t.call("GET", "/v1/admin/me", undefined, a.token)).statusCode).toBe(401);
    expect(await t.services.sessions.revokeKind("all")).toBe(0);
    await t.close();
  });
});
