import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  aiCalls,
  childSummaries,
  dailyReviews,
  dailySubmissions,
  knowledgeCards,
  loginCodes,
  opLog,
  seasonReviews,
  sessions,
  smsOutbox,
  surveyAnswers,
  viewLog,
} from "@zhiyouji/db";
import { setup } from "./helpers.js";

const DAY = 24 * 3_600_000;

describe("the learning archive goes with the child (PRD part 8 §4)", () => {
  it("export has the daily tasks, cards, survey, summaries and season reviews; deletion removes the words and keeps plain counts", async () => {
    const t = await setup();
    const f = await t.family("13700000011", [{ nickname: "小舟", grade: 5 }]);
    const childId = f.childIds[0]!;
    const now = t.clock.now();
    const [sub] = await t.db
      .insert(dailySubmissions)
      .values({ childId, templateId: 2, evidenceFileIds: [], explainKind: "text", explainText: "我住在某某小区，月亮为什么会变", aiNote: "问了豆包", submittedAt: now, day: "2027-01-04", grade: 5, status: "passed", feedbackGood: "讲得清楚", grain: 1, counted: true })
      .returning();
    await t.db.insert(dailyReviews).values({ submissionId: sub!.id, by: "ai:fake", passed: true, expression: 3, aiLevel: 2, raw: { echo: "我住在某某小区" }, createdAt: now });
    await t.db.insert(knowledgeCards).values({ childId, submissionId: sub!.id, title: "月相", summary: "月亮绕地球转", tag: "物理与天文/天体", difficulty: 3, day: "2027-01-04", createdAt: now });
    await t.db.insert(surveyAnswers).values({ childId, version: "v1", answers: { hobby: "画画" }, curiosity: { 物理: 2 }, style: "builder", challengeKind: "text", challengeText: "我叫……", completedAt: now });
    await t.db.insert(childSummaries).values({ childId, kind: "week", period: "2027-01-04", content: { text: "这周你学了月相" }, createdAt: now });
    const a = await t.adminUser();
    const seasonId = (await t.call("POST", "/v1/admin/seasons", { name: "S3", opening: "2027-02-07" }, a.token)).json().season.id as string;
    await t.db.insert(seasonReviews).values({ childId, seasonId, content: { text: "这一季" }, createdAt: now });

    // export
    const r = (await t.call("POST", "/v1/data-requests", { kind: "export", childId }, f.token)).json().request;
    const url = (await t.call("GET", `/v1/data-requests/${r.id}/download`, undefined, f.token)).json().url;
    const data = JSON.parse((await t.app.inject({ method: "GET", url })).body);
    expect(data.dailyTasks).toEqual([expect.objectContaining({ explainText: "我住在某某小区，月亮为什么会变", feedbackGood: "讲得清楚", grain: 1 })]);
    expect(data.knowledgeCards).toEqual([expect.objectContaining({ title: "月相", summary: "月亮绕地球转" })]);
    expect(data.survey[0]).toMatchObject({ style: "builder", challengeText: "我叫……" });
    expect(data.summaries).toEqual([expect.objectContaining({ kind: "week", period: "2027-01-04" })]);
    expect(data.seasonReviews).toHaveLength(1);

    // delete
    await t.services.dataRights.deleteChild(childId);
    const [s2] = await t.db.select().from(dailySubmissions).where(eq(dailySubmissions.id, sub!.id));
    expect(s2).toMatchObject({ explainText: null, aiNote: null, feedbackGood: null, evidenceFileIds: [], day: "2027-01-04", grade: 5, status: "passed", grain: 1 });
    const [rv] = await t.db.select().from(dailyReviews).where(eq(dailyReviews.submissionId, sub!.id));
    expect(rv).toMatchObject({ raw: null, expression: 3, aiLevel: 2 });
    const [card] = await t.db.select().from(knowledgeCards).where(eq(knowledgeCards.childId, childId));
    expect(card).toMatchObject({ title: "", summary: "", visible: false, tag: "物理与天文/天体" });
    expect(await t.db.select().from(surveyAnswers).where(eq(surveyAnswers.childId, childId))).toEqual([]);
    expect(await t.db.select().from(childSummaries).where(eq(childSummaries.childId, childId))).toEqual([]);
    expect(await t.db.select().from(seasonReviews).where(eq(seasonReviews.childId, childId))).toEqual([]);
    await t.close();
  });
});

describe("logs are kept only as long as needed (PRD part 8 §4)", () => {
  it("login codes, ended sessions and sent SMS after 6 months; op and view logs after 400 days; AI call content after 90 days", async () => {
    const t = await setup();
    const now = +t.clock.now();
    const ago = (days: number) => new Date(now - days * DAY);
    await t.db.insert(loginCodes).values([
      { phone: "13700000021", codeHash: "x", createdAt: ago(200), expiresAt: ago(200) },
      { phone: "13700000021", codeHash: "y", createdAt: ago(10), expiresAt: ago(10) },
    ]);
    await t.db.insert(sessions).values([
      { tokenHash: "old-expired", kind: "admin", createdAt: ago(400), lastSeenAt: ago(200), expiresAt: ago(190) },
      { tokenHash: "old-but-live", kind: "admin", createdAt: ago(400), lastSeenAt: ago(200), expiresAt: new Date(now + DAY) },
      { tokenHash: "recent-revoked", kind: "admin", createdAt: ago(20), lastSeenAt: ago(20), expiresAt: new Date(now + DAY), revokedAt: ago(19) },
    ]);
    await t.db.insert(smsOutbox).values([
      { phone: "13700000021", kind: "attacked", mergeKey: "a", sendAfter: ago(200), createdAt: ago(200), status: "sent" },
      { phone: "13700000021", kind: "attacked", mergeKey: "b", sendAfter: ago(200), createdAt: ago(200), status: "pending" },
      { phone: "13700000021", kind: "attacked", mergeKey: "c", sendAfter: ago(5), createdAt: ago(5), status: "sent" },
    ]);
    await t.db.insert(opLog).values([
      { actor: "admin:x", action: "old", at: ago(401) },
      { actor: "admin:x", action: "kept", at: ago(300) },
    ]);
    await t.db.insert(viewLog).values([
      { adminUserId: "00000000-0000-4000-8000-000000000001", contentKind: "work", action: "view", at: ago(401) },
      { adminUserId: "00000000-0000-4000-8000-000000000001", contentKind: "work", action: "view", at: ago(300) },
    ]);
    const call = { task: "daily_review", provider: "fake", model: "m", promptVersion: 1, role: "primary", latencyMs: 10, status: "ok", tokensIn: 100, cost: 7 };
    await t.db.insert(aiCalls).values([
      { ...call, input: { text: "孩子的讲解" }, output: { ok: true }, createdAt: ago(91) },
      { ...call, input: { text: "新的讲解" }, output: { ok: true }, createdAt: ago(3) },
    ]);

    const r = await t.services.dataRights.purgeLogs();
    expect(r).toEqual({ loginCodes: 1, sessions: 1, sms: 1, opLog: 1, viewLog: 1, aiCalls: 1 });
    expect((await t.db.select().from(sessions)).map((s) => s.tokenHash).sort()).toEqual(["old-but-live", "recent-revoked"]);
    expect((await t.db.select().from(smsOutbox)).map((s) => s.mergeKey).sort()).toEqual(["b", "c"]);
    expect((await t.db.select().from(opLog)).map((x) => x.action)).toEqual(["kept"]);
    const calls = await t.db.select().from(aiCalls);
    const old = calls.find((c) => +c.createdAt === +ago(91))!;
    expect(old).toMatchObject({ input: { cleared: true }, output: null, tokensIn: 100, cost: 7, status: "ok" });
    expect(calls.find((c) => +c.createdAt === +ago(3))!.input).toEqual({ text: "新的讲解" });
    // running again changes nothing
    expect(await t.services.dataRights.purgeLogs()).toEqual({ loginCodes: 0, sessions: 0, sms: 0, opLog: 0, viewLog: 0, aiCalls: 0 });
    await t.close();
  });
});
