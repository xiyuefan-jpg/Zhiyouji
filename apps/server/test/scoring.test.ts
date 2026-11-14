import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messages, reviewAssignments, viewLog } from "@zhiyouji/db";
import type { FakeAiScorer } from "../src/index.js";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

const A_DIMS = { accuracy: 20, teach: 25, depth: 15, presentation: 5, ai: 5 }; // 70

async function scoringSetup(doubleReviewRatio: number) {
  const t = await contestSetup();
  await t.services.control.setParams(t.seasonId, { review: { doubleReviewRatio } }, "测试", "admin:test");
  const r1 = await t.adminUser("r1@example.com", "reviewer");
  const r2 = await t.adminUser("r2@example.com", "reviewer");
  const boss = await t.adminUser("boss@example.com", "admin");
  return { ...t, r1, r2, boss, ai: t.services.ai as FakeAiScorer };
}

describe("from deadline to settlement (part 3 §10.5; part 7 §5–§6)", () => {
  it("AI first score, a blind review by the assigned reviewer settles the contest; a review nobody does times out to the AI score", async () => {
    const t = await scoringSetup(0);
    const a1 = t.a1api;
    // a second attack (more grain from an admin adjustment)
    await t.services.store.apply(t.serverId, { type: "adjust_ledger", teamId: t.myTeam, currency: "grain", amount: 100, at: +t.clock.now(), by: "admin", reason: "测试" }, "admin");
    const st = await t.services.store.state(t.serverId);
    const target2 = st.landOrder.find((l) => st.lands[l]!.kind === "edge" && st.lands[l]!.owner && ![t.myTeam, t.defender].includes(st.lands[l]!.owner!))!;
    const contest2 = (await a1("POST", "/v1/season/contests", { landId: target2 })).json().contest.id as string;

    const w1 = (await a1("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "我们的讲解", members: [t.a1, t.b1] })).json().work;
    const w2 = (await a1("POST", `/v1/season/works/contest:${contest2}`, { mediaKind: "text", text: "第二份", members: [t.a1] })).json().work;
    t.ai.fixed.set(w1.id, 66);
    t.ai.fixed.set(w2.id, 40);

    // before the deadline nothing happens; at the deadline both close
    expect((await t.services.scoring.runDue(t.serverId)).closed).toBe(0);
    t.clock.set(bj("2027-02-12", 21, 1));
    expect(await t.services.scoring.runDue(t.serverId)).toMatchObject({ closed: 2, settled: 0 });
    expect((await t.services.scoring.runDue(t.serverId)).closed).toBe(0);
    const as = await t.db.select().from(reviewAssignments);
    expect(as).toHaveLength(2);
    expect(new Set(as.map((a) => a.reviewerId)).size).toBe(2); // spread over both reviewers
    // each reviewer is told once for the round (part 8 §1.2 "复核分派 → 分派时")
    const told = await t.db.select().from(messages).where(eq(messages.type, "review_assigned"));
    expect(told.map((m) => m.recipientId).sort()).toEqual(as.map((a) => a.reviewerId).sort());
    expect(told[0]!.body).toContain("分给你 1 件作品");
    const mine = as.find((a) => a.workId === w1.id)!;
    const reviewer = mine.reviewerId === t.r1.id ? t.r1 : t.r2;
    const token = await reviewer.relogin();

    const queue = (await t.call("GET", "/v1/admin/reviews", undefined, token)).json().reviews;
    expect(queue).toHaveLength(1);
    const view = (await t.call("GET", `/v1/admin/reviews/${queue[0].assignmentId}`, undefined, token)).json();
    expect(view.work.text).toBe("我们的讲解");
    expect(view.ai.total).toBe(66);
    expect(view.rubric.id).toBe("A");
    expect(JSON.stringify(view)).not.toContain(t.myTeam); // blind
    expect((await t.db.select().from(viewLog)).map((v) => v.childId).sort()).toEqual([t.a1, t.b1].sort());

    expect((await t.call("POST", `/v1/admin/reviews/${queue[0].assignmentId}`, { dims: { ...A_DIMS, accuracy: 26 }, comment: "x" }, token)).json().error).toBe("bad_dims");
    expect((await t.call("POST", `/v1/admin/reviews/${queue[0].assignmentId}`, { dims: A_DIMS, comment: "原理讲对了，例子可以更贴近受众。" }, token)).json().total).toBe(70);
    // the defender did not answer, 70 ≥ 50: the attacker takes the land
    const after = await t.services.store.state(t.serverId);
    expect(after.contests[t.contestId]!.status).toBe("settled");
    expect(after.lands[t.target]!.owner).toBe(t.myTeam);
    expect((await t.call("POST", `/v1/admin/reviews/${queue[0].assignmentId}`, { dims: A_DIMS, comment: "again" }, token)).json().error).toBe("review_done");

    // the team sees its score, each dimension and the comment
    const res = (await a1("GET", `/v1/season/works/contest:${t.contestId}/result`)).json();
    expect(res.settled).toBe(true);
    expect(res.mine).toMatchObject({ score: 70, basis: "human", comment: "原理讲对了，例子可以更贴近受众。" });
    expect(res.mine.dims.map((d: { name: string; score: number }) => [d.name, d.score])).toEqual([["准确", 20], ["教会受众", 25], ["深度", 15], ["呈现与创意", 5], ["人机协作", 10 - 5]]);
    expect((await a1("GET", `/v1/season/works/contest:${contest2}/result`)).json().settled).toBe(false);

    // the other review: reminder 6 hours before the limit, then the AI score at the limit
    t.clock.set(bj("2027-02-13", 15, 30));
    await t.services.scoring.runDue(t.serverId);
    const other = as.find((a) => a.workId === w2.id)!;
    const reminded = await t.db.select().from(messages).where(eq(messages.type, "review_due"));
    expect(reminded.map((m) => m.recipientId)).toEqual([other.reviewerId]);
    t.clock.set(bj("2027-02-13", 21, 2));
    expect((await t.services.scoring.runDue(t.serverId)).timeouts).toBe(1);
    const after2 = await t.services.store.state(t.serverId);
    expect(after2.contests[contest2]!.outcome).toEqual({ kind: "nothing" }); // 40 < 50, no defender
    expect((await t.db.select().from(messages).where(eq(messages.type, "review_timeout"))).map((m) => m.title)).toContain("复核超时，按 AI 分结算");
    expect((await a1("GET", `/v1/season/works/contest:${contest2}/result`)).json().mine).toMatchObject({ score: 40, basis: "ai_timeout" });

    const bossToken = await t.boss.relogin();
    const dash = (await t.call("GET", "/v1/admin/reviewers/dashboard", undefined, bossToken)).json();
    expect(dash.total.timedOutToAi).toBe(1);
    expect(dash.reviewers.find((r: { reviewerId: string }) => r.reviewerId === other.reviewerId)).toMatchObject({ assigned: 1, timedOutToAi: 1, timedOutWorks: [w2.id] });
    expect(dash.reviewers.find((r: { reviewerId: string }) => r.reviewerId === mine.reviewerId)).toMatchObject({ doneOnTime: 1, averageGapWithAi: 4 });
    await t.close();
  });

  it("a second reviewer far from the first alerts the admins; the admin's ruling settles; reassigning and leave", async () => {
    const t = await scoringSetup(1);
    const w = (await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "作品", members: [t.a1] })).json().work;
    t.ai.fixed.set(w.id, 55);
    // r2 is on leave today: everything goes to r1 … and with only one reviewer there is no second one
    const r2token = await t.r2.relogin();
    expect((await t.call("POST", "/v1/admin/reviews/leave", { from: "2027-02-12", to: "2027-02-13" }, r2token)).json().ok).toBe(true);
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    let as = await t.db.select().from(reviewAssignments);
    expect(as.map((a) => [a.reviewerId, a.second])).toEqual([[t.r1.id, false]]);
    // the admin moves it to r2 and adds a second review by r1 by reassigning later
    const boss = await t.boss.relogin();
    const re = (await t.call("POST", `/v1/admin/reviews/${as[0]!.id}/reassign`, { reviewerId: t.r2.id }, boss)).json();
    as = await t.db.select().from(reviewAssignments);
    expect(as.find((a) => a.id === as[0]!.id)?.status ?? "reassigned").toBeTruthy();
    expect(as.find((a) => a.id === re.assignmentId)!.reviewerId).toBe(t.r2.id);
    await t.db.insert(reviewAssignments).values({ workId: w.id, reviewerId: t.r1.id, second: true, assignedAt: t.clock.now(), dueAt: bj("2027-02-13", 21) });

    const r2 = await t.r2.relogin();
    await t.call("POST", `/v1/admin/reviews/${re.assignmentId}`, { dims: { accuracy: 10, teach: 10, depth: 10, presentation: 5, ai: 5 }, comment: "一般" }, r2); // 40
    // the contest settled on the first reviewer's 40 (< 50, no defender → nothing)
    expect((await t.services.store.state(t.serverId)).contests[t.contestId]!.outcome).toEqual({ kind: "nothing" });
    const r1 = await t.r1.relogin();
    const second = (await t.call("GET", "/v1/admin/reviews", undefined, r1)).json().reviews[0];
    expect(second.second).toBe(true);
    await t.call("POST", `/v1/admin/reviews/${second.assignmentId}`, { dims: { accuracy: 25, teach: 25, depth: 20, presentation: 5, ai: 5 }, comment: "很好" }, r1); // 80
    const gap = await t.db.select().from(messages).where(eq(messages.type, "double_review_gap"));
    expect(gap.length).toBeGreaterThan(0);
    expect(gap[0]!.body).toContain("40 和 80");
    // ruling after settlement is refused (that is 改判)
    const boss2 = await t.boss.relogin();
    expect((await t.call("POST", `/v1/admin/works/${w.id}/rule`, { score: 60, note: "取中" }, boss2)).json().error).toBe("already_settled");
    await t.close();
  });

  it("weekly war: the pair's works are reviewed, then the war settles (the side that did not submit loses)", async () => {
    const t = await scoringSetup(0);
    t.clock.set(bj("2027-02-11", 19, 1)); // D4 evening: W1 pairing
    await t.services.scheduler.runDue(t.serverId);
    const slots = (await t.a1api("GET", "/v1/season/works")).json().slots as { slot: string; open: boolean }[];
    expect(slots.find((s) => s.slot === "war:1")!.open).toBe(true);
    const w = (await t.a1api("POST", "/v1/season/works/war:1", { mediaKind: "text", text: "方案", members: [t.a1] })).json().work;
    t.clock.set(bj("2027-02-14", 21, 1)); // D7 21:00
    await t.services.scoring.runDue(t.serverId);
    const [a] = (await t.db.select().from(reviewAssignments)).filter((x) => x.workId === w.id);
    const reviewer = a!.reviewerId === t.r1.id ? t.r1 : t.r2;
    const token = await reviewer.relogin();
    const view = (await t.call("GET", `/v1/admin/reviews/${a!.id}`, undefined, token)).json();
    expect(view.rubric.id).toBe("C");
    const dims = { problem: 15, solution: 20, constraints: 15, novelty: 10, clarity: 5, ai: 5 };
    expect((await t.call("POST", `/v1/admin/reviews/${a!.id}`, { dims, comment: "可行" }, token)).json().total).toBe(70);
    // the other contest work is still open, but the war settles on its own
    const st = await t.services.store.state(t.serverId);
    expect(st.wars[1]!.settled).toBe(true);
    expect(st.wars[1]!.results!.find((r) => r.teamId === t.myTeam)).toMatchObject({ outcome: "win" });
    const res = (await t.a1api("GET", "/v1/season/works/war:1/result")).json();
    expect(res.mine.score).toBe(70);
    expect(res.scores).toHaveLength(1);
    await t.close();
  });
});

describe("改判 after settlement (part 3 §16, §20.4)", () => {
  it("records the new score and works the outcome out again automatically when nothing happened on the land since", async () => {
    const t = await scoringSetup(0);
    const w = (await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "作品", members: [t.a1] })).json().work;
    t.ai.fixed.set(w.id, 70);
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    t.clock.set(bj("2027-02-13", 21, 2)); // nobody reviews: AI 70 → captured
    await t.services.scoring.runDue(t.serverId);
    expect((await t.services.store.state(t.serverId)).lands[t.target]!.owner).toBe(t.myTeam);
    const boss = await t.boss.relogin();
    const r = (await t.call("POST", `/v1/admin/works/${w.id}/rejudge`, { score: 40, note: "抄袭" }, boss)).json();
    expect(r).toMatchObject({ before: { kind: "captured", winner: t.myTeam }, after: { kind: "nothing" }, changed: true, automatic: true, suggestions: [] });
    // nothing happened on the land since: worked out again automatically (§20.4)
    const st2 = await t.services.store.state(t.serverId);
    expect(st2.lands[t.target]!.owner).toBe(t.defender);
    expect(st2.contests[t.contestId]!.outcome).toEqual({ kind: "nothing" });
    expect(st2.ledger.some((e) => e.source === "reversal" && e.teamId === t.myTeam)).toBe(true);
    expect((await t.a1api("GET", `/v1/season/works/contest:${t.contestId}/result`)).json().mine).toMatchObject({ score: 40, basis: "admin" });
    // 单条重跑: an extra AI score, the official one stays
    const rerun = (await t.call("POST", `/v1/admin/works/${w.id}/ai-rerun`, undefined, boss)).json().scores;
    expect(rerun.map((x: { official: boolean }) => x.official).sort()).toEqual([false, true]);
    // the same score again: nothing changes
    const same = (await t.call("POST", `/v1/admin/works/${w.id}/rejudge`, { score: 45, note: "复查后维持" }, boss)).json();
    expect(same.changed).toBe(false);
    // the admin's view of the work: team, AI scores, the settled history
    const v = (await t.call("GET", `/v1/admin/works/${w.id}`, undefined, boss)).json();
    expect(v.work).toMatchObject({ text: "作品", team: (await t.services.store.state(t.serverId)).teams[t.myTeam]!.name });
    expect(v.round.status).toBe("settled");
    expect(v.settled.map((x: { score: number; basis: string }) => [x.score, x.basis])).toEqual([[70, "ai_timeout"], [40, "admin"], [45, "admin"]]);
    expect(v.ai.length).toBe(2);
    await t.close();
  });
});

describe("看板 (part 7 §1)", () => {
  it("today's numbers, what needs handling, live servers", async () => {
    const { contestSetup: cs } = await import("./seasonHelpers.js");
    const t = await cs();
    const boss = await t.adminUser("boss@example.com", "admin");
    const r = await t.adminUser("r@example.com", "reviewer");
    await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "作品", members: [t.a1] });
    const d = (await t.call("GET", "/v1/admin/dashboard", undefined, boss.token)).json();
    expect(d.today.worksSubmitted).toBe(1);
    expect(d.today.activeChildren).toBeGreaterThan(0);
    expect(d.servers).toHaveLength(1);
    expect(d.servers[0]).toMatchObject({ day: 2, activeContests: 1, paused: false });
    expect(d.servers[0].top).toHaveLength(3);
    // the reviewer sees only their own queue and no servers
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    const rd = (await t.call("GET", "/v1/admin/dashboard", undefined, await r.relogin())).json();
    expect(rd.servers).toEqual([]);
    expect(rd.attention.reviewsPending).toBe(1);
    expect(rd.attention.reviewsDueSoon).toBe(0);
    await t.close();
  });
});
