/**
 * 数据导出 (PRD part 7 §9): daily tasks, works and scores, ledgers, survey
 * answers as CSV (opens in Excel; BOM so Chinese shows). Every export is in
 * the view log as a download.
 */

import type { FastifyInstance } from "fastify";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { aiScores, children, dailyReviews, dailySubmissions, grainLedger, pointsLedger, servers, settledScores, surveyAnswers, teams, works, type Db } from "@zhiyouji/db";
import type { AdminAccounts } from "../accounts/admin.js";
import type { AdminAuth } from "./adminRoutes.js";

const kindParam = z.object({ kind: z.enum(["daily", "works", "ledger", "survey"]) });
const scopeQuery = z.object({ seasonId: z.uuid().optional() });

export function toCsv(rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

export function exportRoutes(app: FastifyInstance, db: Db, accounts: AdminAccounts, auth: AdminAuth): void {
  app.get("/v1/admin/exports/:kind.csv", async (req, reply) => {
    const { user } = await auth.user(req, ["admin"]);
    const { kind } = kindParam.parse(req.params);
    const { seasonId } = scopeQuery.parse(req.query);
    const serverIds = seasonId ? (await db.select({ id: servers.id }).from(servers).where(eq(servers.seasonId, seasonId))).map((s) => s.id) : null;
    let rows: unknown[][] = [];
    if (kind === "daily") {
      const subs = await db.select().from(dailySubmissions).orderBy(asc(dailySubmissions.submittedAt));
      const revs = await db.select().from(dailyReviews);
      const last = new Map(revs.map((r) => [r.submissionId, r]));
      rows = [
        ["提交ID", "孩子ID", "日期", "模板", "年级", "状态", "计入粮草", "粮草", "表达档", "人机协作档", "AI腔调", "主标签", "难度", "跨越度", "讲解长度", "审核方"],
        ...subs.map((s) => {
          const r = last.get(s.id);
          return [s.id, s.childId, s.day, s.templateId, s.grade, s.status, s.counted, s.grain, r?.expression, r?.aiLevel, r?.aiTone, r?.mainTag, r?.difficulty, r?.crossing, r?.length, r?.by];
        }),
      ];
    } else if (kind === "works") {
      const ws = serverIds ? (serverIds.length ? await db.select().from(works).where(inArray(works.serverId, serverIds)) : []) : await db.select().from(works);
      const ai = await db.select().from(aiScores).where(eq(aiScores.official, true));
      const st = await db.select().from(settledScores).orderBy(asc(settledScores.decidedAt));
      const settled = new Map(st.map((x) => [x.workId, x]));
      const teamName = new Map((await db.select().from(teams)).map((t) => [t.id, t.name]));
      rows = [
        ["作品ID", "服", "组", "类型", "作品位", "版本", "提交时间", "形式", "署名人数", "AI分", "评分族", "结算分", "依据", "内容安全"],
        ...ws.map((w) => [w.id, w.serverId, teamName.get(w.teamId), w.kind, w.slot, w.version, w.submittedAt, w.mediaKind, (w.members as string[]).length, ai.find((a) => a.workId === w.id)?.total, ai.find((a) => a.workId === w.id)?.rubric, settled.get(w.id)?.score, settled.get(w.id)?.basis, w.safety]),
      ];
    } else if (kind === "ledger") {
      const g = serverIds ? (serverIds.length ? await db.select().from(grainLedger).where(inArray(grainLedger.serverId, serverIds)) : []) : await db.select().from(grainLedger);
      const p = serverIds ? (serverIds.length ? await db.select().from(pointsLedger).where(inArray(pointsLedger.serverId, serverIds)) : []) : await db.select().from(pointsLedger);
      const teamName = new Map((await db.select().from(teams)).map((t) => [t.id, t.name]));
      rows = [
        ["账本", "条目", "服", "组", "数量", "来源", "关联", "说明", "时间", "冲正了", "参数版本"],
        ...g.map((e) => ["粮草", e.entryId, e.serverId, teamName.get(e.teamId), e.amount, e.source, e.refId, e.note, e.at, e.reverses, e.paramVersion]),
        ...p.map((e) => ["团队分（0.01 分）", e.entryId, e.serverId, teamName.get(e.teamId), e.amount, e.source, e.refId, e.note, e.at, e.reverses, e.paramVersion]),
      ];
    } else {
      const sv = await db.select().from(surveyAnswers).orderBy(asc(surveyAnswers.completedAt));
      const kids = new Map((await db.select({ id: children.id, grade: children.grade }).from(children)).map((c) => [c.id, c.grade]));
      rows = [["孩子ID", "年级", "版本", "游戏风格", "好奇分", "30秒挑战", "完成时间", "全部答案"], ...sv.map((s) => [s.childId, kids.get(s.childId), s.version, s.style, s.curiosity, s.challengeKind, s.completedAt, s.answers])];
    }
    await accounts.recordView(user.id, { childId: null, contentKind: `export:${kind}`, objectId: seasonId ?? null, action: "download" });
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${kind}.csv"`);
    return toCsv(rows);
  });
}
