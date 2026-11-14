import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dailyReviews, messages, plannedEvents } from "@zhiyouji/db";
import type { FakeAiDaily, FakeAiSummarizer } from "../src/index.js";
import { bj, setup } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

/** 60 characters about air pressure, with the child's own example. */
const TEXT = "我今天用AI学了大气压。原来我以为空气没有重量，后来懂了空气也有重量会压在我们身上。我自己想到的例子是用吸管喝饮料，其实是外面的大气把饮料压进嘴里。";

type Call = (m: "GET" | "POST", url: string, body?: unknown) => Promise<{ json: () => any; statusCode: number }>;

async function picture(t: { app: { inject: (o: object) => Promise<{ statusCode: number }> } }, call: Call): Promise<string> {
  const up = (await call("POST", "/v1/daily/uploads", { kind: "image", contentType: "image/jpeg", size: 4 })).json();
  await t.app.inject({ method: "PUT", url: up.upload.url, payload: Buffer.from("jpeg"), headers: { "content-type": "image/jpeg" } });
  await call("POST", `/v1/daily/uploads/${up.fileId}/complete`);
  return up.fileId as string;
}

async function kid(t: Awaited<ReturnType<typeof setup>>, phone = "13500000001") {
  const f = await t.family(phone, [{ nickname: "小雨", grade: 4 }]);
  await t.call("POST", "/v1/session/child", { childId: f.childIds[0] }, f.token);
  const call: Call = (m, url, body) => t.call(m, url, body, f.token);
  return { ...f, call };
}

describe("每日任务 and 修行日志 (part 5 C1–C7; part 6 T4)", () => {
  it("hand in → AI passes it → a knowledge card in the journal; the rules for the explanation and the AI line", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const k = await kid(t);
    const pic = await picture(t, k.call);
    const base = { templateId: 1, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT }, aiNote: "我让 AI 给我举了三个例子" };
    expect((await k.call("POST", "/v1/daily/submissions", { ...base, explain: { kind: "text", text: "太短了" } })).json().error).toBe("explain_length");
    expect((await k.call("POST", "/v1/daily/submissions", { ...base, aiNote: undefined, noAi: true })).json().error).toBe("no_ai_not_allowed");
    expect((await k.call("POST", "/v1/daily/submissions", { ...base, aiNote: undefined })).json().error).toBe("ai_note_required");
    expect((await k.call("POST", "/v1/daily/submissions", { ...base, evidenceFileIds: [] })).json().error).toBe("evidence_required");
    const other = await kid(t, "13500000002");
    expect((await other.call("POST", "/v1/daily/submissions", base)).json().error).toBe("upload_missing");

    const r = (await k.call("POST", "/v1/daily/submissions", base)).json();
    expect(r).toMatchObject({ status: "passed", counted: null, grain: null, failReason: null });
    expect(r.feedbackGood).toContain("做得好的");
    expect(r.card.tag).toBe("物理与天文/力与运动");
    // the model sees the evidence picture and what the template asks for (part 6 T4)
    const req = (t.services.aiDaily as FakeAiDaily).last!;
    expect(req).toMatchObject({ templatePrompt: "今天你用 AI 学会了一个什么以前不知道的东西？", evidenceExpected: "和 AI 对话的截图", evidenceCount: 1 });
    expect(req.evidenceImages).toHaveLength(1);
    expect((await t.app.inject({ method: "GET", url: req.evidenceImages![0]! })).body).toBe("jpeg");
    const [rev] = await t.db.select().from(dailyReviews);
    expect(rev).toMatchObject({ passed: true, expression: 3, aiLevel: 2, difficulty: 3, crossing: 1, length: [...TEXT].length });
    const msg = (await k.call("GET", "/v1/messages")).json().messages[0];
    expect(msg).toMatchObject({ type: "review_result", title: "每日任务通过了", body: "通过了！已经记进修行日志。" });

    // template 4 without AI: the human–AI level is "not applicable"
    const pic2 = await picture(t, k.call);
    expect((await k.call("POST", "/v1/daily/submissions", { templateId: 4, evidenceFileIds: [pic2], explain: { kind: "text", text: TEXT }, noAi: true })).json().status).toBe("passed");
    expect((await t.db.select().from(dailyReviews)).find((x) => x.mainTag === "生活与实践/手工与修理")!.aiLevel).toBeNull();

    const today = (await k.call("GET", "/v1/daily/today")).json();
    expect(today).toMatchObject({ day: "2027-03-10", passedToday: 2, retriesLeft: 3, season: null });
    expect(today.templates).toHaveLength(6);
    const cal = (await k.call("GET", "/v1/journal/calendar?month=2027-03")).json();
    expect(cal.days["2027-03-10"]).toHaveLength(2);
    const subj = (await k.call("GET", "/v1/journal/subjects")).json();
    expect(subj.subjects).toHaveLength(15);
    expect(subj.subjects.find((s: { name: string }) => s.name === "物理与天文").cards).toBe(1);
    expect(subj.total).toBe(2);
    expect((await k.call("GET", `/v1/journal/cards?q=${encodeURIComponent("大气压")}`)).json().cards).toHaveLength(2);
    expect((await k.call("GET", `/v1/journal/cards?tag=${encodeURIComponent("生活与实践")}`)).json().cards).toHaveLength(1);
    const card = (await k.call("GET", `/v1/journal/cards/${r.card.id}`)).json();
    expect(card.explainText).toBe(TEXT);
    expect((await t.app.inject({ method: "GET", url: card.evidence[0].url })).body).toBe("jpeg");
    expect((await other.call("GET", `/v1/journal/cards/${r.card.id}`)).statusCode).toBe(404);
    await t.close();
  });

  it("not passed: the reason and how to fix it; two re-tries a day", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const k = await kid(t);
    const bad = { templateId: 1, explain: { kind: "text", text: `${TEXT}不通过` }, aiNote: "问了 AI" };
    for (let i = 0; i < 3; i++) {
      const r = (await k.call("POST", "/v1/daily/submissions", { ...bad, evidenceFileIds: [await picture(t, k.call)] })).json();
      expect(r).toMatchObject({ status: "failed", card: null });
      expect(r.failReason).toContain("为什么");
    }
    expect((await k.call("GET", "/v1/daily/today")).json().retriesLeft).toBe(0);
    expect((await k.call("POST", "/v1/daily/submissions", { ...bad, evidenceFileIds: [await picture(t, k.call)] })).json().error).toBe("retries_used");
    // the next day is a new day
    t.clock.set(bj("2027-03-11", 8));
    const pic = await picture(t, k.call);
    expect((await k.call("POST", "/v1/daily/submissions", { ...bad, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT } })).json().status).toBe("passed");
    await t.close();
  });

  it("season players: the engine counts 2 a day for the team's grain; more still go to the journal", async () => {
    const t = await contestSetup();
    const grain0 = (await t.a1api("GET", "/v1/season/team")).json().grain as number;
    const results = [];
    for (let i = 0; i < 3; i++) {
      const pic = await picture(t, t.a1api as unknown as Call);
      results.push((await t.a1api("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT }, aiNote: "问了 AI" })).json());
    }
    expect(results.map((r) => [r.counted, r.grain])).toEqual([[true, 3], [true, 3], [false, 0]]);
    expect((await t.a1api("GET", "/v1/season/team")).json().grain).toBe(grain0 + 6);
    expect((await t.a1api("GET", "/v1/daily/today")).json().season).toMatchObject({ countedToday: 2, capPerDay: 2, countedThisWeek: 2, capPerWeek: 4 });
    const bodies = (await t.a1api("GET", "/v1/messages")).json().messages.filter((m: { type: string }) => m.type === "review_result").map((m: { body: string }) => m.body);
    expect(bodies).toContain("通过了！本组粮草 +3。");
    expect(bodies).toContain("通过了！今天或本周已经计满，这次记进修行日志。");
    // the team feed shows it
    const feed = (await t.a1api("GET", "/v1/season/team-feed")).json().lines.map((l: { text: string }) => l.text);
    expect(feed.some((x: string) => x.includes("每日任务通过了，本组粮草 +3"))).toBe(true);
    await t.close();
  });

  it("the participation award waits for a Sunday-evening task still under review (part 3 §7: it counts for the day it was handed in)", async () => {
    const t = await contestSetup();
    t.clock.set(bj("2027-02-14", 23));
    await t.services.scheduler.runDue(t.serverId);
    const ai = t.services.aiDaily as FakeAiDaily;
    ai.failDaily = true;
    const pic = await picture(t, t.a1api as unknown as Call);
    expect((await t.a1api("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT }, aiNote: "问了 AI" })).json().status).toBe("reviewing");
    const award = async () => (await t.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, t.serverId), eq(plannedEvents.key, "participation_award:1"))))[0]!.status;
    t.clock.set(bj("2027-02-15", 0, 5));
    await t.services.scheduler.runDue(t.serverId);
    expect(await award()).toBe("pending");
    ai.failDaily = false;
    await t.services.daily.runDue();
    await t.services.scheduler.runDue(t.serverId);
    expect(await award()).toBe("done");
    const st = await t.services.store.state(t.serverId);
    expect(st.taskPasses.find((x) => x.childId === t.a1)).toMatchObject({ week: 1 });
    await t.close();
  });

  it("AI keeps failing: retries, '土地公有点忙' after 10 minutes, exception queue after 2 hours, a reviewer decides", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const ai = t.services.aiDaily as FakeAiDaily;
    const k = await kid(t);
    const reviewer = await t.adminUser("r@example.com", "reviewer");
    ai.failDaily = true;
    const pic = await picture(t, k.call);
    const r = (await k.call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT }, aiNote: "问了 AI" })).json();
    expect(r.status).toBe("reviewing");
    t.clock.advance(61_000);
    expect(await t.services.daily.runDue()).toEqual({ reviewed: 0, errors: 0 });
    t.clock.advance(10 * 60_000);
    await t.services.daily.runDue();
    expect((await k.call("GET", "/v1/messages")).json().messages[0].title).toBe("土地公有点忙");
    t.clock.advance(2 * 3_600_000);
    expect((await t.services.daily.runDue()).errors).toBe(1);
    expect((await k.call("GET", `/v1/daily/submissions/${r.id}`)).json().status).toBe("error");
    expect((await t.db.select().from(messages).where(eq(messages.type, "daily_error"))).map((m) => m.recipientId)).toContain(reviewer.id);

    const token = await reviewer.relogin();
    const q = (await t.call("GET", "/v1/admin/daily/exceptions", undefined, token)).json().tasks;
    expect(q).toHaveLength(1);
    expect(q[0].explainText).toBe(TEXT);
    const ok = await t.call("POST", `/v1/admin/daily/${r.id}/decide`, { passed: true, expression: 3, aiLevel: 2, mainTag: "物理与天文/力与运动", difficulty: 3, feedbackGood: "做得好的：例子很贴切。", feedbackBetter: "可以更好的：再讲讲为什么。" }, token);
    expect(ok.json().ok).toBe(true);
    const v = (await k.call("GET", `/v1/daily/submissions/${r.id}`)).json();
    expect(v).toMatchObject({ status: "passed", feedbackGood: "做得好的：例子很贴切。" });
    expect(v.card).toBeTruthy();
    expect((await t.call("POST", `/v1/admin/daily/${r.id}/decide`, { passed: false, expression: 0, aiLevel: 0, mainTag: "数学/数与代数", difficulty: 1 }, token)).json().error).toBe("not_reviewing");
    await t.close();
  });

  it("周小结 on Monday and 月报告 on the 1st, with the numbers and how many cards were above the child's grade", async () => {
    const t = await setup(bj("2027-03-10", 16)); // Wednesday
    const k = await kid(t);
    for (let i = 0; i < 2; i++) {
      const pic = await picture(t, k.call);
      await k.call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT }, aiNote: "问了 AI" });
    }
    expect(await t.services.summaries.runDue()).toBe(0); // nothing in last week yet
    t.clock.set(bj("2027-03-15", 8)); // next Monday
    expect(await t.services.summaries.runDue()).toBe(1);
    expect(await t.services.summaries.runDue()).toBe(0);
    const list = (await k.call("GET", "/v1/journal/summaries")).json().summaries;
    expect(list[0]).toMatchObject({ kind: "week", period: "2027-03-08", content: { cards: 2, aboveGrade: 2, subjects: { 物理与天文: 2 } } });
    expect(list[0].content.text).toContain("2 张知识卡片");
    t.clock.set(bj("2027-04-01", 8));
    expect(await t.services.summaries.runDue()).toBe(1);
    expect((await k.call("GET", "/v1/journal/summaries")).json().summaries[0]).toMatchObject({ kind: "month", period: "2027-03" });
    expect((await k.call("GET", "/v1/messages")).json().messages[0].title).toBe("你的月报告来了");
    await t.close();
  });

  it("one child's summary failing does not hold up the others; it is tried again 10 minutes later and the admins are told", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const k = await kid(t);
    const f2 = await t.family("13500000009", [{ nickname: "小风", grade: 7 }]);
    await t.call("POST", "/v1/session/child", { childId: f2.childIds[0] }, f2.token);
    const k2: Call = (m, url, body) => t.call(m, url, body, f2.token);
    for (const call of [k.call, k2]) {
      const pic = await picture(t, call);
      await call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT }, aiNote: "问了 AI" });
    }
    await t.adminUser();
    const ai = t.services.aiSummary as FakeAiSummarizer;
    ai.failGrades.add(7);
    t.clock.set(bj("2027-03-15", 8));
    expect(await t.services.summaries.runDue()).toBe(1);
    expect((await t.db.select().from(messages)).filter((m) => m.type === "ai_failed").map((m) => m.title)).toContain("周小结生成失败");
    ai.failGrades.clear();
    t.clock.advance(5 * 60_000);
    expect(await t.services.summaries.runDue()).toBe(0); // still waiting
    t.clock.advance(6 * 60_000);
    expect(await t.services.summaries.runDue()).toBe(1);
    await t.close();
  });

  it("admins export the daily tasks as CSV (in the view log)", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const k = await kid(t);
    const pic = await picture(t, k.call);
    await k.call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "text", text: TEXT }, aiNote: "问了 AI" });
    const boss = await t.adminUser();
    const csv = await t.call("GET", "/v1/admin/exports/daily.csv", undefined, boss.token);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = csv.body.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("物理与天文/力与运动");
    for (const kind of ["works", "ledger", "survey"]) expect((await t.call("GET", `/v1/admin/exports/${kind}.csv`, undefined, boss.token)).statusCode).toBe(200);
    const log = (await t.call("GET", "/v1/admin/view-log", undefined, boss.token)).json().entries;
    expect(log.map((e: { contentKind: string }) => e.contentKind)).toContain("export:daily");
    await t.close();
  });
});
