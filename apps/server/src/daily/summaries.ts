/**
 * 周小结、月报告 (PRD part 5 C8; part 6 T8; personal system 0.6) and 赛季回顾
 * (part 5 G6, §4.1; part 6 T9; part 7 §9):
 * - every Monday (for the past week) and on the 1st (for the past month),
 *   children with knowledge cards in that period get a short look back: the
 *   AI's few sentences plus the numbers (cards, subjects, how many were above
 *   their grade — the crossing score);
 * - after the final settlement an admin generates each player's season review
 *   ("这一季我带走了什么"), previews it and releases it to everyone at once.
 */

import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { children, childSummaries, dailyReviews, dailySubmissions, knowledgeCards, seasonReviews, seasons, servers, teamMembers, teams, works, type Db } from "@zhiyouji/db";
import { addDays, beijingDate, dateOfSeasonDay, dayOfWeek } from "@zhiyouji/engine";
import type { AiSummarizer } from "../ai.js";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import { teamHighlights, workOutcome } from "../season/reviewFacts.js";
import { workTask } from "../season/taskInfo.js";

type Card = typeof knowledgeCards.$inferSelect;

/** Monday of the week before `today` and the first day of last month. */
export function lastPeriods(today: string): { week: { from: string; to: string }; month: { from: string; to: string; label: string } } {
  const dow = dayOfWeek(today); // 0 = Sunday
  const thisMonday = addDays(today, -((dow + 6) % 7));
  const lastMonday = addDays(thisMonday, -7);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const ly = m === 1 ? y - 1 : y;
  const lm = m === 1 ? 12 : m - 1;
  const label = `${ly}-${String(lm).padStart(2, "0")}`;
  return { week: { from: lastMonday, to: thisMonday }, month: { from: `${label}-01`, to: `${y}-${String(m).padStart(2, "0")}-01`, label } };
}

const SUMMARY_RETRY_MS = 10 * 60_000;

export class Summaries {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly ai: AiSummarizer,
    private readonly notifier: Notifier,
    private readonly store: SeasonStore,
  ) {}

  private async crossingOf(cards: Card[]): Promise<Map<string, number>> {
    const ids = cards.map((c) => c.submissionId);
    if (ids.length === 0) return new Map();
    const rows = await this.db.select({ s: dailyReviews.submissionId, c: dailyReviews.crossing }).from(dailyReviews).where(inArray(dailyReviews.submissionId, ids));
    return new Map(rows.filter((r) => r.c !== null).map((r) => [r.s, r.c!]));
  }

  private stats(cards: Card[], crossing: Map<string, number>) {
    const subjects: Record<string, number> = {};
    for (const c of cards) {
      const s = c.tag?.split("/")[0];
      if (s) subjects[s] = (subjects[s] ?? 0) + 1;
    }
    return { cards: cards.length, subjects, aboveGrade: cards.filter((c) => (crossing.get(c.submissionId) ?? 0) > 0).length };
  }

  /** Worker: last week's and last month's look-backs (idempotent: one per child and period). */
  async runDue(): Promise<number> {
    const today = beijingDate(+this.clock.now());
    const p = lastPeriods(today);
    let n = 0;
    n += await this.make("week", p.week.from, p.week.from, p.week.to);
    if (today.endsWith("-01")) n += await this.make("month", p.month.label, p.month.from, p.month.to);
    return n;
  }

  /** After a failed AI call, wait before asking again (per kind and period). */
  private retryAt = new Map<string, number>();

  private async make(kind: "week" | "month", period: string, from: string, to: string): Promise<number> {
    const now = +this.clock.now();
    if ((this.retryAt.get(`${kind}:${period}`) ?? 0) > now) return 0;
    const failed: string[] = [];
    const cards = await this.db.select().from(knowledgeCards).where(and(gte(knowledgeCards.day, from), lt(knowledgeCards.day, to), eq(knowledgeCards.visible, true)));
    const byChild = new Map<string, Card[]>();
    for (const c of cards) byChild.set(c.childId, [...(byChild.get(c.childId) ?? []), c]);
    const done = byChild.size
      ? new Set(
          (
            await this.db
              .select({ c: childSummaries.childId })
              .from(childSummaries)
              .where(and(eq(childSummaries.kind, kind), eq(childSummaries.period, period), inArray(childSummaries.childId, [...byChild.keys()])))
          ).map((r) => r.c),
        )
      : new Set<string>();
    let n = 0;
    for (const [childId, list] of byChild) {
      if (done.has(childId)) continue;
      const [kid] = await this.db.select().from(children).where(eq(children.id, childId));
      if (!kid || kid.status !== "active") continue;
      const crossing = await this.crossingOf(list);
      let ai: { model: string; text: string };
      try {
        ai = await this.ai.summarize({ kind, grade: kid.grade, cards: list.map((c) => ({ title: c.title, summary: c.summary, tag: c.tag, crossing: crossing.get(c.submissionId) ?? null })) });
      } catch (err) {
        // One child's failure does not hold up the others; this child is tried again later.
        failed.push(String((err as Error).message ?? err));
        continue;
      }
      const [row] = await this.db
        .insert(childSummaries)
        .values({ childId, kind, period, content: { text: ai.text, model: ai.model, from, to, ...this.stats(list, crossing) }, createdAt: this.clock.now() })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      n++;
      await this.notifier.notify({
        kind: "system",
        childIds: [childId],
        title: kind === "week" ? "你的周小结来了" : "你的月报告来了",
        body: ai.text,
        link: `/journal/summaries/${row.id}`,
        dedupeKey: `summary:${kind}:${period}`,
      });
    }
    if (failed.length) {
      this.retryAt.set(`${kind}:${period}`, now + SUMMARY_RETRY_MS);
      await this.notifier.notifyAdmins({
        kind: "ai_failed",
        title: kind === "week" ? "周小结生成失败" : "月报告生成失败",
        body: `${period} 有 ${failed.length} 个孩子的${kind === "week" ? "周小结" : "月报告"}没生成出来（${failed[0]}），系统 10 分钟后再试。`,
        dedupeKey: `summary_failed:${kind}:${period}`,
        roles: ["admin"],
      });
    }
    return n;
  }

  async list(childId: string) {
    const rows = await this.db.select().from(childSummaries).where(eq(childSummaries.childId, childId));
    return { summaries: rows.sort((a, b) => +b.createdAt - +a.createdAt).map((r) => ({ id: r.id, kind: r.kind, period: r.period, content: r.content, createdAt: r.createdAt.toISOString() })) };
  }

  // ---- 赛季回顾 ----------------------------------------------------------------------------------------

  /** Admin: (re)generate every player's review of a finished season (not yet released). */
  async generateSeasonReviews(seasonId: string): Promise<{ generated: number }> {
    const [season] = await this.db.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!season) fail(404, "season_not_found");
    if (!["ended", "archived", "final_pending"].includes(season!.status)) fail(409, "wrong_season_status", { status: season!.status });
    const from = dateOfSeasonDay(season!.openingDate, 0);
    const to = addDays(from, 40);
    const members = await this.db
      .select({ childId: teamMembers.childId, teamId: teams.id, serverId: servers.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .innerJoin(servers, eq(teams.serverId, servers.id))
      .where(eq(servers.seasonId, seasonId));
    let n = 0;
    for (const m of members) {
      const [kid] = await this.db.select().from(children).where(eq(children.id, m.childId));
      if (!kid || kid.status !== "active") continue;
      const st = await this.store.state(m.serverId);
      const cards = await this.db.select().from(knowledgeCards).where(and(eq(knowledgeCards.childId, m.childId), gte(knowledgeCards.day, from), lt(knowledgeCards.day, to)));
      const crossing = await this.crossingOf(cards);
      const hardest = [...cards].sort((a, b) => (crossing.get(b.submissionId) ?? -9) - (crossing.get(a.submissionId) ?? -9) || (b.difficulty ?? 0) - (a.difficulty ?? 0))[0];
      // Each work the child signed, once per slot (its latest version; part 5 §4.1 我参与的作品).
      const signed = (await this.db.select().from(works).where(eq(works.serverId, m.serverId))).filter((w) => (w.members as string[]).includes(m.childId));
      const latest = new Map<string, (typeof signed)[number]>();
      for (const w of signed) {
        // A debate's 立论 and 驳论 are one contest: keep the 驳论 when there is one.
        const key = `${w.teamId}|${w.slot.replace(/:open$/, "")}`;
        const cur = latest.get(key);
        const rank = (x: typeof w) => (x.slot.endsWith(":open") ? 0 : 1e6) + x.version;
        if (!cur || rank(cur) < rank(w)) latest.set(key, w);
      }
      const mine = [...latest.values()].sort((a, b) => +a.submittedAt - +b.submittedAt);
      const tasks = await this.db.select({ id: dailySubmissions.id }).from(dailySubmissions).where(and(eq(dailySubmissions.childId, m.childId), eq(dailySubmissions.status, "passed"), gte(dailySubmissions.day, from), lt(dailySubmissions.day, to)));
      const rank = st.final?.ranking.find((r) => r.teamId === m.teamId)?.rank ?? null;
      const scholarshipYuan = st.final ? (st.final.scholarship.find((r) => r.teamId === m.teamId)?.yuan ?? 0) : null;
      const ai = await this.ai.summarize({ kind: "season", grade: kid.grade, cards: cards.map((c) => ({ title: c.title, summary: c.summary, tag: c.tag, crossing: crossing.get(c.submissionId) ?? null })) });
      const content = {
        text: ai.text,
        team: st.teams[m.teamId]?.name ?? "",
        rank,
        scholarshipYuan,
        highlights: teamHighlights(st, m.teamId),
        // 我的探索地图: the child's knowledge cards plus the works they signed (part 5 §4.1; part 6 T7)
        map: (() => {
          const m = { ...this.stats(cards, crossing).subjects };
          for (const w of mine) for (const tag of ((w.tags as string[] | null) ?? [])) {
            const subject = tag.split("/")[0]!;
            m[subject] = (m[subject] ?? 0) + 1;
          }
          return m;
        })(),
        hardest: hardest ? { title: hardest.title, tag: hardest.tag, crossing: crossing.get(hardest.submissionId) ?? null } : null,
        works: await Promise.all(
          mine.map(async (w) => {
            const task = await workTask(this.db, m.serverId, st, w);
            return { kind: w.kind, slot: w.slot, tags: (w.tags as string[] | null) ?? [], title: task?.title ?? null, land: task?.landName ?? null, subject: task?.subject ?? null, result: workOutcome(st, w.teamId, w) };
          }),
        ),
        numbers: { dailyTasks: tasks.length, cards: cards.length, works: mine.length, aboveGrade: this.stats(cards, crossing).aboveGrade },
      };
      await this.db
        .insert(seasonReviews)
        .values({ childId: m.childId, seasonId, content, createdAt: this.clock.now() })
        .onConflictDoUpdate({ target: [seasonReviews.childId, seasonReviews.seasonId], set: { content, createdAt: this.clock.now() } });
      n++;
    }
    return { generated: n };
  }

  async previewSeasonReviews(seasonId: string) {
    const rows = await this.db.select().from(seasonReviews).where(eq(seasonReviews.seasonId, seasonId));
    return { reviews: rows.map((r) => ({ id: r.id, childId: r.childId, content: r.content, releasedAt: r.releasedAt?.toISOString() ?? null })) };
  }

  async releaseSeasonReviews(seasonId: string) {
    const rows = await this.db.select().from(seasonReviews).where(and(eq(seasonReviews.seasonId, seasonId)));
    const now = this.clock.now();
    const fresh = rows.filter((r) => !r.releasedAt);
    if (fresh.length) await this.db.update(seasonReviews).set({ releasedAt: now }).where(inArray(seasonReviews.id, fresh.map((r) => r.id)));
    await this.notifier.notify({ kind: "system", childIds: fresh.map((r) => r.childId), title: "你的赛季回顾来了", body: "看看这一季你带走了什么。", link: "/season-review", dedupeKey: `season_review:${seasonId}` });
    return { released: fresh.length };
  }

  async seasonReviewsOf(childId: string) {
    const rows = await this.db.select({ r: seasonReviews, name: seasons.name }).from(seasonReviews).innerJoin(seasons, eq(seasonReviews.seasonId, seasons.id)).where(eq(seasonReviews.childId, childId));
    return { reviews: rows.filter((x) => x.r.releasedAt).map((x) => ({ id: x.r.id, season: x.name, content: x.r.content, releasedAt: x.r.releasedAt!.toISOString() })) };
  }
}

