import { describe, expect, it } from "vitest";
import { dailySubmissions, knowledgeCards, surveyAnswers, viewLog } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";

describe("孩子档案 for the admins (part 7 §3)", () => {
  it("grade, siblings, survey and the journal in numbers; the view is recorded", async () => {
    const t = await setup(bj("2027-02-01", 10));
    const f = await t.family("13700000001", [
      { nickname: "小满", grade: 5 },
      { nickname: "小雪", grade: 2 },
    ]);
    const [kid] = f.childIds as [string];
    await t.db.insert(surveyAnswers).values({ childId: kid, version: "v1", answers: {}, curiosity: { 物理与天文: 6, 历史与考古: 2, 数学: 4 }, style: "strategist", completedAt: new Date() });
    for (const [i, status] of (["passed", "passed", "failed"] as const).entries()) {
      const [s] = await t.db
        .insert(dailySubmissions)
        .values({ childId: kid, templateId: 1, evidenceFileIds: [], explainKind: "text", explainText: "x", submittedAt: new Date(), day: `2027-01-2${i}`, grade: 5, status })
        .returning();
      if (status === "passed") await t.db.insert(knowledgeCards).values({ childId: kid, submissionId: s!.id, title: `卡片${i}`, summary: "…", tag: i === 0 ? "物理与天文/力与运动" : "数学/几何与空间", difficulty: 3, day: `2027-01-2${i}`, createdAt: new Date(Date.now() + i) });
    }
    const boss = await t.adminUser();
    const p = (await t.call("GET", `/v1/admin/children/${kid}`, undefined, boss.token)).json();
    expect(p.child).toMatchObject({ nickname: "小满", gradeLabel: "五年级", phoneMasked: "137****0001" });
    expect(p.siblings).toEqual([expect.objectContaining({ nickname: "小雪", gradeLabel: "二年级" })]);
    expect(p.grades[0]).toMatchObject({ to: 5, source: "created" });
    expect(p.survey).toMatchObject({ style: "strategist", topCuriosity: [{ subject: "物理与天文", score: 6 }, { subject: "数学", score: 4 }, { subject: "历史与考古", score: 2 }] });
    expect(p.journal).toMatchObject({ daily: { total: 3, passed: 2, days: 2 }, cards: 2 });
    expect(p.journal.latest.map((c: { title: string }) => c.title)).toEqual(["卡片1", "卡片0"]);
    expect(p.journal.bySubject).toEqual(expect.arrayContaining([{ subject: "数学", cards: 1 }, { subject: "物理与天文", cards: 1 }]));
    expect((await t.db.select().from(viewLog)).map((v) => [v.childId, v.contentKind])).toEqual([[kid, "child_profile"]]);
    expect((await t.call("GET", `/v1/admin/children/00000000-0000-4000-8000-000000000000`, undefined, boss.token)).statusCode).toBe(404);
    await t.close();
  });
});
