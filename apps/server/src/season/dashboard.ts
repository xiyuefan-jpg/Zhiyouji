/**
 * 看板 (PRD part 7 §1): today in numbers, what needs handling, each live
 * server at a glance.
 */

import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { aiCalls, aiScores, children, dailyReviews, dailySubmissions, messages, plannedEvents, reviewAssignments, safetyQueue, seasons, servers, works, type Db } from "@zhiyouji/db";
import { DEFAULT_PARAMS, beijingDate, beijingInstant, nextPublicationAfter, rankingAt, seasonDayOf } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import type { SeasonStore } from "../seasonStore.js";
import { QuestionBank } from "../content/questionBank.js";
import { LIVE_SEASON_STATES } from "../worker.js";

const HOUR = 3_600_000;

export class Dashboard {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
  ) {}

  async view(adminId: string, role: string) {
    const now = +this.clock.now();
    const dayStart = new Date(beijingInstant(beijingDate(now), 0));
    const today = beijingDate(now);

    const daily = await this.db.select({ status: dailySubmissions.status }).from(dailySubmissions).where(eq(dailySubmissions.day, today));
    const worksToday = await this.db.select({ id: works.id }).from(works).where(gte(works.submittedAt, dayStart));
    const newKids = await this.db.select({ id: children.id }).from(children).where(gte(children.createdAt, dayStart));
    const activeKids = await this.db.select({ id: children.id }).from(children).where(gte(children.lastActiveAt, dayStart));

    const pending = await this.db.select().from(reviewAssignments).where(eq(reviewAssignments.status, "pending"));
    const mine = role === "admin" ? pending : pending.filter((a) => a.reviewerId === adminId);
    const dueSoon = mine.filter((a) => +a.dueAt - now <= DEFAULT_PARAMS.review.remindBeforeHours * HOUR).length;
    const exceptions = (await this.db.select({ id: dailySubmissions.id }).from(dailySubmissions).where(eq(dailySubmissions.status, "error"))).length;

    const live = await this.db
      .select({ id: servers.id, name: servers.name, season: seasons.name, status: seasons.status })
      .from(servers)
      .innerJoin(seasons, eq(servers.seasonId, seasons.id))
      .where(inArray(seasons.status, LIVE_SEASON_STATES));
    const failed = live.length
      ? await this.db.select({ key: plannedEvents.key, serverId: plannedEvents.serverId }).from(plannedEvents).where(and(eq(plannedEvents.status, "failed"), inArray(plannedEvents.serverId, live.map((s) => s.id))))
      : [];
    const serverViews = [];
    let lowPrompts = 0;
    for (const s of live) {
      const st = await this.store.state(s.id);
      lowPrompts += QuestionBank.lowStock(st).length;
      serverViews.push({
        id: s.id,
        name: s.name,
        season: s.season,
        status: s.status,
        day: seasonDayOf(st.opening, now),
        paused: st.paused,
        activeContests: Object.values(st.contests).filter((c) => c.status === "active").length,
        nextPublication: new Date(nextPublicationAfter(now, st.params, st.calendar)).toISOString(),
        top: rankingAt(st, now)
          .slice(0, 3)
          .map((r) => ({ rank: r.rank, name: st.teams[r.teamId]!.name, points: r.points })),
      });
    }

    // part 7 §1 "需要处理": content-safety items waiting, two reviewers far apart waiting for a ruling
    const safetyPending = (await this.db.select({ id: safetyQueue.id }).from(safetyQueue).where(eq(safetyQueue.status, "pending"))).length;
    const gapRows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.recipientKind, "admin"), eq(messages.recipientId, adminId), eq(messages.type, "double_review_gap"), isNull(messages.readAt)));
    // today's AI calls: how many, how many failed, what they cost (part 7 §1; part 6 §6.2)
    const calls = await this.db.select({ status: aiCalls.status, cost: aiCalls.cost }).from(aiCalls).where(gte(aiCalls.createdAt, dayStart));
    const aiWorks = await this.db.select({ id: aiScores.id }).from(aiScores).where(gte(aiScores.createdAt, dayStart));
    const aiDaily = await this.db.select({ by: dailyReviews.by }).from(dailyReviews).where(and(gte(dailyReviews.createdAt, dayStart), lte(dailyReviews.createdAt, new Date(now))));

    return {
      today: {
        day: today,
        dailyTasks: {
          passed: daily.filter((d) => d.status === "passed").length,
          failed: daily.filter((d) => d.status === "failed").length,
          error: daily.filter((d) => d.status === "error").length,
          reviewing: daily.filter((d) => d.status === "reviewing").length,
        },
        worksSubmitted: worksToday.length,
        newChildren: newKids.length,
        activeChildren: activeKids.length,
      },
      attention: {
        reviewsDueSoon: dueSoon,
        reviewsPending: mine.length,
        dailyExceptions: exceptions,
        failedPlannedEvents: role === "admin" ? failed.map((f) => ({ serverId: f.serverId, key: f.key })) : [],
        lowPromptLands: role === "admin" ? lowPrompts : 0,
        safetyPending: role === "admin" ? safetyPending : 0,
        doubleReviewGaps: role === "admin" ? gapRows.length : 0,
      },
      servers: role === "admin" ? serverViews : [],
      ai: {
        workScores: aiWorks.length,
        dailyReviews: aiDaily.filter((d) => d.by.startsWith("ai:")).length,
        calls: calls.length,
        errors: calls.filter((c) => c.status === "error").length,
        errorRate: calls.length ? Math.round((calls.filter((c) => c.status === "error").length / calls.length) * 1000) / 1000 : 0,
        /** Yuan (the log keeps 1/10000 yuan). */
        costYuan: calls.reduce((n, c) => n + (c.cost ?? 0), 0) / 10000,
      },
    };
  }
}
