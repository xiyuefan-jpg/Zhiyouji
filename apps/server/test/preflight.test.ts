import { describe, expect, it } from "vitest";
import { changedPaths } from "../src/season/preflight.js";
import { setup } from "./helpers.js";
import { playSetup } from "./seasonHelpers.js";

type Check = { key: string; status: string; detail: string };
const byKey = (checks: Check[]) => Object.fromEntries(checks.map((c) => [c.key, c]));

describe("开营前检查清单 (PRD part 9 §3)", () => {
  it("a new season: no grouping, no question bank, no reviewer → not ready, and says what is missing", async () => {
    const t = await setup();
    const a = await t.adminUser();
    const id = (await t.call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-07" }, a.token)).json().season.id;
    const r = (await t.call("GET", `/v1/admin/seasons/${id}/preflight`, undefined, a.token)).json();
    expect(r.ready).toBe(false);
    const c = byKey(r.checks);
    expect(c.params).toMatchObject({ status: "ok", detail: "第 1 版，全部是默认值" });
    expect(c.calendar!.status).toBe("warn");
    expect(c.pool!.status).toBe("info");
    expect(c.grouping).toMatchObject({ status: "fail", detail: "还没生成分组" });
    expect(c.reviewers!.status).toBe("fail");
    expect(c.prompts!.status).toBe("fail");
    expect(c.ai!.detail).toMatch(/还在用假的 AI/);
    // reviewers may not see it
    const rv = await t.adminUser("rev@example.com", "reviewer");
    expect((await t.call("GET", `/v1/admin/seasons/${id}/preflight`, undefined, rv.token)).statusCode).toBe(403);
    await t.close();
  });

  it("a confirmed season with a reviewer and a holiday set: ready; QR codes and changed parameters are listed", async () => {
    const t = await playSetup();
    const a = await t.adminUser();
    await t.adminUser("rev@example.com", "reviewer");
    await t.call("POST", "/v1/admin/calendar/2027-02-11", { kind: "rest" }, a.token);
    await t.call("POST", `/v1/admin/seasons/${t.seasonId}/params`, { patch: { "grouping.maxTeamSize": 10 }, note: "试" }, a.token);
    const r = (await t.call("GET", `/v1/admin/seasons/${t.seasonId}/preflight`, undefined, a.token)).json();
    const c = byKey(r.checks);
    expect(c.grouping).toMatchObject({ status: "ok" });
    expect(c.grouping!.detail).toMatch(/1 个服、8 个组、16 人，每组 1–3 人/);
    expect(c.prompts).toMatchObject({ status: "ok" });
    expect(c.reviewers).toMatchObject({ status: "ok" });
    expect(c.calendar!.detail).toMatch(/手动设了 1 天（上学 0、休息 1）/);
    expect(c.qr).toMatchObject({ status: "warn" });
    expect(c.params!.detail).toMatch(/第 2 版；和默认值不同的 1 项：grouping.maxTeamSize/);
    expect(r.ready).toBe(true);
    await t.close();
  });

  it("changedPaths walks objects and treats arrays as one value", () => {
    expect(changedPaths({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { b: 2, c: [1, 3] }, d: 1 })).toEqual(["a.b", "a.c"]);
    expect(changedPaths({ a: 1 }, { a: 1 })).toEqual([]);
  });
});
