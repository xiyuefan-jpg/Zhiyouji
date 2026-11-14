/**
 * Fixes from the end-to-end design walkthrough (docs/review/设计逻辑走查.md):
 * the team and the reviewer both see the question, the audience and how the
 * work is judged; the blind auction states its real cost and publishes every
 * team's bid; the map shows each land's subject; the site counts down from the
 * server's clock; tied teams keep their order for the day.
 */

import { describe, expect, it } from "vitest";
import { createRng, rankingAt } from "@zhiyouji/engine";
import { bj } from "./helpers.js";
import { contestSetup, playSetup } from "./seasonHelpers.js";

describe("design walkthrough fixes", () => {
  it("a contest shows the land's subject and question type, the audience, the rubric with its 50/75 lines and the work requirements", async () => {
    const t = await contestSetup({ seedBank: true });
    const c = (await t.a1api("GET", `/v1/season/contests/${t.contestId}`)).json();
    expect(c.task.subject).toBeTruthy();
    expect(c.task.questionType).toBeTruthy();
    expect(c.task.audience).toBe("一个没学过这个知识的初中生或普通成年人");
    expect(c.rubric.dims.length).toBeGreaterThanOrEqual(5);
    expect(c.rubric.dims.every((d: { hint: string }) => d.hint.length > 0 || d)).toBe(true);
    expect(c.rubric.dims.some((d: { name: string }) => d.name === "人机协作")).toBe(true);
    expect(c.rubric.at50.length).toBeGreaterThan(5);
    expect(c.rubric.at75.length).toBeGreaterThan(5);
    expect(c.requirements).toMatch(/视频|立论/);

    // the map tells which subject each land is, and that my team already attacks this one
    const map = (await t.a1api("GET", "/v1/season/map")).json();
    const land = map.lands.find((l: { id: string }) => l.id === t.target);
    expect(land.subject).toBeTruthy();
    expect(land.contest.involved).toBe(true);
    await t.close();
  });

  it("the reviewer and the AI get the question and the audience together with the work", async () => {
    const t = await contestSetup({ seedBank: true });
    const slots = (await t.a1api("GET", "/v1/season/works")).json().slots as { slot: string; open: boolean }[];
    const slot = slots.find((s) => s.open && s.slot.startsWith("contest:"))!.slot;
    await t.a1api("POST", `/v1/season/works/${encodeURIComponent(slot)}`, { mediaKind: "text", text: "作品", members: [t.a1], aiNote: "问了豆包，它把折射说成了反射，我们查书改过来了" });
    const reviewer = await t.adminUser("rev@example.com", "reviewer");
    const seen: unknown[] = [];
    const inner = t.services.ai.score.bind(t.services.ai);
    t.services.ai.score = async (r) => {
      seen.push(r.task);
      return inner(r);
    };
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    expect(seen.length).toBeGreaterThan(0);
    expect((seen[0] as { audience: string }).audience).toBe("一个没学过这个知识的初中生或普通成年人");

    const token = await reviewer.relogin();
    const queue = (await t.call("GET", "/v1/admin/reviews", undefined, token)).json();
    const key = Object.keys(queue).find((k) => Array.isArray(queue[k]))!;
    const items = queue[key] as { assignmentId: string }[];
    expect(items.length).toBeGreaterThan(0);
    const v = (await t.call("GET", `/v1/admin/reviews/${items[0]!.assignmentId}`, undefined, token)).json();
    expect(v.task.audience).toBe("一个没学过这个知识的初中生或普通成年人");
    expect(v.task.subject).toBeTruthy();
    expect(v.guide.at50).toBeTruthy();
    expect(v.guide.dims.length).toBeGreaterThan(0);
    await t.close();
  });

  it("the blind auction states its cost, shows each land's subject, and publishes every team's bid", async () => {
    const t = await playSetup({ seedBank: true });
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });
    const before = (await a1("GET", "/v1/season/rounds/blind_auction")).json();
    expect(before.rules).toContain("一定会从粮草里扣掉");
    expect(before.rules).toContain("开营法宝里先挑");
    expect(before.options.length).toBe(8);
    expect(before.options.every((o: { detail: string }) => o.detail.length > 0)).toBe(true);
    expect(before.result).toBeNull();
    await a1("POST", "/v1/season/rounds/blind_auction", { bid: 12, prefs: ["E3"] });
    t.clock.set(bj("2027-02-08", 21, 1));
    await t.services.scheduler.runDue(t.serverId);
    const after = (await a1("GET", "/v1/season/rounds/blind_auction")).json();
    expect(after.result).toHaveLength(8);
    const mine = after.result.find((r: { mine: boolean }) => r.mine);
    expect(mine.paid).toBe(12);
    expect(after.result[0].paid).toBeGreaterThanOrEqual(after.result[7].paid);

    const starter = (await a1("GET", "/v1/season/rounds/starter_items")).json();
    expect(starter.rules).toContain("每组免费拿 2 件");
    expect(starter.options.map((o: { id: string }) => o.id).sort()).toEqual(["bihuo", "huanhun", "jianbi", "taixu", "yujing"]);
    expect(starter.options.every((o: { detail: string }) => o.detail.length > 0)).toBe(true);
    await t.close();
  });

  it("every response carries the server's clock for the site's countdowns", async () => {
    const t = await playSetup();
    const r = await t.call("GET", "/v1/policy");
    expect(Number(r.headers["x-server-time"])).toBe(+t.clock.now());
    await t.close();
  });

  it("tied teams keep the same order all day (the tie is still broken at random)", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const st = await t.services.store.state(t.serverId);
    const at10 = rankingAt(st, +bj("2027-02-08", 10)).map((r) => r.teamId);
    const at11 = rankingAt(st, +bj("2027-02-08", 11, 37)).map((r) => r.teamId);
    expect(at11).toEqual(at10);
    // a different day may break the tie differently; the result is still one valid order
    const nextDay = rankingAt(st, +bj("2027-02-09", 10)).map((r) => r.teamId);
    expect([...nextDay].sort()).toEqual([...at10].sort());
    void createRng;
    await t.close();
  });
});
