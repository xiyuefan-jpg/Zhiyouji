/**
 * 每日任务 and 修行日志 (PRD part 5 C1–C9, §3.1; part 6 T4, §5; content
 * library §8–§9; part 3 §7):
 *
 * - The child uploads evidence pictures (and a voice explanation, or writes
 *   50–150 characters), adds one line on how AI was used ("没用 AI" for
 *   templates 3–6), and hands it in.
 * - The AI reviews it right away; if that fails it retries with growing waits;
 *   after 10 minutes the child is told the result will come; after 2 hours the
 *   task goes to the exception queue (admins and reviewers decide). Never
 *   passed automatically (it makes grain).
 * - Passed: a knowledge card for the journal; for season players the engine
 *   counts it (2 a day, 4 a week, +3 grain) — over the caps it still goes to the
 *   journal. Not passed: the reason and how to fix it; up to 2 re-tries a day.
 */

import type { MediaPipeline } from "../media.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, or } from "drizzle-orm";
import { dailyReviews, dailySubmissions, files, knowledgeCards, type Db } from "@zhiyouji/db";
import { beijingDate, seasonDayOf, seasonWeekOf } from "@zhiyouji/engine";
import {
  DAILY_TEMPLATES,
  DAILY_TEXT_MAX,
  DAILY_TEXT_MIN,
  TAXONOMY,
  crossing,
  isKnownTag,
  type DailyDecide,
  type DailySubmit,
} from "@zhiyouji/shared";
import type { AiDailyReviewer, DailyReviewResult } from "../ai.js";
import type { ChildRow } from "../accounts/family.js";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonPlay } from "../season/play.js";
import type { SeasonStore } from "../seasonStore.js";
import type { ObjectStorage } from "../storage.js";

const MIN = 60_000;
/** Waits between AI retries (part 6 §5: growing waits). */
const RETRY_WAITS = [1, 2, 5, 10, 15, 30].map((m) => m * MIN);
const BUSY_AFTER = 10 * MIN;
const GIVE_UP_AFTER = 120 * MIN;
/** Re-tries after a failed task per day (PRD part 5 §3.1: 当天最多 2 次). */
export const DAILY_RETRIES_PER_DAY = 2;

type SubRow = typeof dailySubmissions.$inferSelect;

export class DailyTasks {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: ServerConfig,
    private readonly storage: ObjectStorage,
    private readonly ai: AiDailyReviewer,
    private readonly notifier: Notifier,
    private readonly store: SeasonStore,
    private readonly play: SeasonPlay,
    private readonly media?: MediaPipeline,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  // ---- uploads ------------------------------------------------------------------------------

  async requestUpload(child: ChildRow, b: { kind: "image" | "audio"; contentType: string; size: number; durationSec?: number }) {
    const lim = this.cfg.uploads;
    if (!lim.allowedTypes[b.kind].includes(b.contentType)) fail(400, "file_type");
    if (b.size > lim.maxBytes[b.kind]) fail(400, "file_too_big", { maxBytes: lim.maxBytes[b.kind] });
    // A child's own audio is always the narration: ≤90 s (part 5 §3.1, part 3 §20.6).
    const timed = b.kind === "audio" && b.durationSec !== undefined;
    if (timed && b.durationSec! > lim.maxDurationSec.narration + lim.durationGraceSec) fail(400, "explain_too_long", { maxSec: lim.maxDurationSec.narration });
    const key = `daily/${child.id}/${randomUUID()}`;
    const [row] = await this.db
      .insert(files)
      .values({ childId: child.id, kind: b.kind, contentType: b.contentType, size: b.size, storageKey: key, durationSec: timed ? Math.round(b.durationSec!) : null, createdAt: this.clock.now() })
      .returning();
    return { fileId: row!.id, upload: await this.storage.uploadTicket(key, b.contentType, b.size, this.now()) };
  }

  async completeUpload(child: ChildRow, fileId: string) {
    const [f] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.childId, child.id)));
    if (!f || f.teamId) fail(404, "not_found");
    if (f!.status !== "uploading") return { ok: true };
    const head = await this.storage.head(f!.storageKey);
    if (!head) fail(409, "upload_missing");
    if (head!.size !== f!.size) fail(409, "upload_size");
    await this.db.update(files).set({ status: "uploaded", uploadedAt: this.clock.now() }).where(eq(files.id, fileId));
    return { ok: true };
  }

  // ---- handing in (C2) -----------------------------------------------------------------------

  async submit(child: ChildRow, b: DailySubmit) {
    const tpl = DAILY_TEMPLATES.find((t) => t.id === b.templateId)!;
    const noAi = !!b.noAi;
    if (noAi && !tpl.noAiAllowed) fail(400, "no_ai_not_allowed");
    if (!noAi && !b.aiNote?.trim()) fail(400, "ai_note_required");
    const fileIds = [...new Set([...b.evidenceFileIds, ...(b.explain.kind === "voice" ? [b.explain.fileId] : [])])];
    const fs = await this.db.select().from(files).where(and(inArray(files.id, fileIds), eq(files.childId, child.id)));
    const byId = new Map(fs.map((f) => [f.id, f]));
    for (const id of b.evidenceFileIds) {
      const f = byId.get(id);
      if (!f || f.status === "uploading" || f.kind !== "image") fail(409, "upload_missing");
    }
    if (b.explain.kind === "voice") {
      const f = byId.get(b.explain.fileId);
      if (!f || f.status === "uploading" || f.kind !== "audio") fail(409, "explain_missing");
      const lim = this.cfg.uploads;
      if (f!.durationSec !== null && f!.durationSec > lim.maxDurationSec.narration + lim.durationGraceSec) fail(400, "explain_too_long", { maxSec: lim.maxDurationSec.narration });
    } else {
      const n = [...b.explain.text].length;
      if (n < DAILY_TEXT_MIN || n > DAILY_TEXT_MAX) fail(400, "explain_length", { length: n });
    }
    const now = this.now();
    const day = beijingDate(now);
    const failedToday = await this.db
      .select({ id: dailySubmissions.id })
      .from(dailySubmissions)
      .where(and(eq(dailySubmissions.childId, child.id), eq(dailySubmissions.day, day), eq(dailySubmissions.status, "failed")));
    if (failedToday.length > DAILY_RETRIES_PER_DAY) fail(429, "retries_used");
    const [row] = await this.db
      .insert(dailySubmissions)
      .values({
        childId: child.id,
        templateId: b.templateId,
        evidenceFileIds: b.evidenceFileIds,
        explainKind: b.explain.kind,
        explainFileId: b.explain.kind === "voice" ? b.explain.fileId : null,
        explainText: b.explain.kind === "text" ? b.explain.text : null,
        aiNote: noAi ? null : b.aiNote!.trim(),
        noAi,
        submittedAt: new Date(now),
        day,
        grade: child.grade,
        nextTryAt: new Date(now),
      })
      .returning();
    // Try once right away (usually done within a minute); the worker retries if the AI is busy.
    await this.tryReview(row!.id);
    return this.view(child.id, row!.id);
  }

  /** Worker: retry reviews whose wait is over; tell children whose result is late; give up after 2 hours. */
  async runDue(): Promise<{ reviewed: number; errors: number }> {
    const now = this.now();
    const rows = await this.db
      .select()
      .from(dailySubmissions)
      .where(and(eq(dailySubmissions.status, "reviewing"), lte(dailySubmissions.nextTryAt, new Date(now))))
      .orderBy(asc(dailySubmissions.submittedAt))
      .limit(200);
    let reviewed = 0;
    let errors = 0;
    for (const r of rows) {
      const res = await this.tryReview(r.id);
      if (res === "done") reviewed++;
      if (res === "error") errors++;
    }
    // "土地公有点忙" for tasks still waiting after 10 minutes.
    const late = await this.db
      .select()
      .from(dailySubmissions)
      .where(and(eq(dailySubmissions.status, "reviewing"), lt(dailySubmissions.submittedAt, new Date(now - BUSY_AFTER))));
    for (const r of late) {
      if (r.busyNoticeAt) continue;
      await this.db.update(dailySubmissions).set({ busyNoticeAt: new Date(now) }).where(eq(dailySubmissions.id, r.id));
      await this.notifier.notify({
        kind: "review_result",
        childIds: [r.childId],
        title: "土地公有点忙",
        body: "你的每日任务还在审核，结果出来会告诉你。",
        link: `/daily/${r.id}`,
        dedupeKey: `daily_busy:${r.id}`,
      });
    }
    return { reviewed, errors };
  }

  private async tryReview(id: string): Promise<"done" | "retry" | "error" | "skip"> {
    const [s] = await this.db.select().from(dailySubmissions).where(eq(dailySubmissions.id, id));
    if (!s || s.status !== "reviewing") return "skip";
    const tpl = DAILY_TEMPLATES.find((t) => t.id === s.templateId)!;
    const evidence = s.evidenceFileIds as string[];
    let transcript: string | null = null;
    try {
      // the voice explanation is transcribed first ("材料齐了", part 6 §2)
      if (s.explainFileId) {
        await this.media?.ensure([s.explainFileId]);
        transcript = (await this.db.select({ t: files.transcript }).from(files).where(eq(files.id, s.explainFileId)))[0]?.t ?? null;
      }
      // the evidence pictures go to the model too: "讲解和证据是同一件事" (part 6 §3)
      const now0 = this.now();
      const evidenceRows = evidence.length ? await this.db.select().from(files).where(inArray(files.id, evidence)) : [];
      const evidenceImages = await Promise.all(
        evidence
          .map((id) => evidenceRows.find((f) => f.id === id))
          .filter((f): f is NonNullable<typeof f> => !!f && f.kind === "image" && f.status !== "deleted")
          .map((f) => this.storage.downloadUrl(f.storageKey, now0)),
      );
      const r = await this.ai.reviewDaily({
        submissionId: s.id,
        templateId: s.templateId,
        templateName: tpl.name,
        templatePrompt: tpl.prompt,
        evidenceExpected: tpl.evidence,
        evidenceImages,
        grade: s.grade,
        explainText: s.explainText,
        transcript,
        aiNote: s.aiNote,
        noAi: s.noAi,
        evidenceCount: evidence.length,
      });
      await this.decideWith(s, r, `ai:${r.model}`);
      return "done";
    } catch (err) {
      const now = this.now();
      const attempts = s.attempts + 1;
      if (now - +s.submittedAt >= GIVE_UP_AFTER) {
        await this.db.update(dailySubmissions).set({ status: "error", attempts }).where(eq(dailySubmissions.id, s.id));
        await this.notifier.notifyAdmins({
          kind: "daily_error",
          title: "每日任务审核出错",
          body: `一条每日任务 2 小时还没有审核结果（${String((err as Error).message ?? err)}），请在"每日任务异常"里处理。`,
          link: `/daily/exceptions`,
          dedupeKey: `daily_error:${s.id}`,
        });
        return "error";
      }
      const wait = RETRY_WAITS[Math.min(attempts - 1, RETRY_WAITS.length - 1)]!;
      await this.db.update(dailySubmissions).set({ attempts, nextTryAt: new Date(now + wait) }).where(eq(dailySubmissions.id, s.id));
      return "retry";
    }
  }

  /** Store a review (AI or person) and carry out what follows: card, grain, message. */
  private async decideWith(s: SubRow, r: DailyReviewResult, by: string): Promise<void> {
    const now = this.now();
    const mainTag = isKnownTag(r.mainTag) ? r.mainTag : `其他/${r.mainTag}`;
    const difficulty = Math.max(1, Math.min(6, Math.round(r.difficulty)));
    const expression = r.aiTone ? Math.min(1, r.expression) : r.expression;
    const length = s.explainText ? [...s.explainText].length : null;
    await this.db.insert(dailyReviews).values({
      submissionId: s.id,
      by,
      passed: r.passed,
      expression,
      aiLevel: s.noAi ? null : r.aiLevel,
      aiTone: r.aiTone,
      mainTag,
      subTag: r.subTag,
      difficulty,
      crossing: crossing(difficulty, s.grade),
      length,
      raw: r,
      createdAt: new Date(now),
    });
    let grain: number | null = null;
    let counted: boolean | null = null;
    if (r.passed) {
      await this.db.insert(knowledgeCards).values({ childId: s.childId, submissionId: s.id, title: [...r.card.title].slice(0, 15).join(""), summary: r.card.summary, tag: mainTag, difficulty, day: s.day, createdAt: new Date(now) });
      const season = await this.countInSeason(s, now);
      grain = season?.grain ?? null;
      counted = season?.counted ?? null;
    }
    await this.db
      .update(dailySubmissions)
      .set({
        status: r.passed ? "passed" : "failed",
        failReason: r.passed ? null : r.failReason,
        feedbackGood: r.feedbackGood,
        feedbackBetter: r.feedbackBetter,
        grain,
        counted,
        decidedAt: new Date(now),
      })
      .where(eq(dailySubmissions.id, s.id));
    const body = r.passed
      ? counted
        ? `通过了！本组粮草 +${grain}。`
        : counted === false
          ? "通过了！今天或本周已经计满，这次记进修行日志。"
          : "通过了！已经记进修行日志。"
      : `还差一点：${r.failReason ?? ""}改一改再交。`;
    await this.notifier.notify({
      kind: "review_result",
      childIds: [s.childId],
      title: r.passed ? "每日任务通过了" : "每日任务还没通过",
      body,
      link: `/daily/${s.id}`,
      dedupeKey: `daily_result:${s.id}`,
    });
  }

  /** Season players: the engine counts it (caps, 还魂金丹) and credits the team's grain. */
  private async countInSeason(s: SubRow, now: number): Promise<{ counted: boolean; grain: number } | null> {
    const l = await this.play.lookup(s.childId);
    if (l.kind !== "playing" || !["running", "big_battle"].includes(l.ctx.season.status)) return null;
    const r = await this.store.apply(l.ctx.serverId, { type: "daily_task_passed", taskId: s.id, childId: s.childId, submittedAt: +s.submittedAt, at: now }, `child:${s.childId}`);
    if (!r.ok) return null;
    const pass = r.state.taskPasses.find((t) => t.id === s.id);
    return pass ? { counted: pass.counted, grain: pass.grain } : null;
  }

  // ---- exception queue (part 7 §5.3) ------------------------------------------------------------

  async exceptions() {
    const rows = await this.db
      .select()
      .from(dailySubmissions)
      .where(eq(dailySubmissions.status, "error"))
      .orderBy(asc(dailySubmissions.submittedAt));
    return { tasks: await Promise.all(rows.map((r) => this.adminView(r))) };
  }

  private async adminView(s: SubRow) {
    const ids = [...(s.evidenceFileIds as string[]), ...(s.explainFileId ? [s.explainFileId] : [])];
    const fs = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
    const now = this.now();
    return {
      id: s.id,
      childId: s.childId,
      templateId: s.templateId,
      grade: s.grade,
      submittedAt: s.submittedAt.toISOString(),
      explainText: s.explainText,
      aiNote: s.aiNote,
      noAi: s.noAi,
      files: await Promise.all(fs.map(async (f) => ({ id: f.id, kind: f.kind, transcript: f.transcript, url: await this.storage.downloadUrl(f.storageKey, now) }))),
    };
  }

  /** An admin or reviewer decides a task the AI could not (the child gets the result at once). */
  async decide(id: string, b: DailyDecide, by: string) {
    const [s] = await this.db.select().from(dailySubmissions).where(eq(dailySubmissions.id, id));
    if (!s) fail(404, "not_found");
    if (s!.status !== "error" && s!.status !== "reviewing") fail(409, "not_reviewing");
    if (!isKnownTag(b.mainTag)) fail(400, "bad_request");
    const text = s!.explainText ?? "";
    await this.decideWith(
      s!,
      {
        model: "person",
        passed: b.passed,
        failReason: b.passed ? null : (b.failReason ?? "请补充讲解后再交。"),
        feedbackGood: b.feedbackGood ?? "",
        feedbackBetter: b.feedbackBetter ?? "",
        expression: b.expression,
        aiLevel: b.aiLevel,
        aiTone: false,
        mainTag: b.mainTag,
        subTag: b.subTag ?? null,
        difficulty: b.difficulty,
        card: { title: b.cardTitle ?? ([...text].slice(0, 15).join("") || "今天的修行"), summary: b.cardSummary ?? text.slice(0, 120) },
      },
      by,
    );
    return { ok: true };
  }

  // ---- what the child sees (C1, C3) --------------------------------------------------------------

  async view(childId: string, id: string) {
    const [s] = await this.db.select().from(dailySubmissions).where(and(eq(dailySubmissions.id, id), eq(dailySubmissions.childId, childId)));
    if (!s) fail(404, "not_found");
    const [card] = await this.db.select().from(knowledgeCards).where(eq(knowledgeCards.submissionId, id));
    return {
      id: s!.id,
      templateId: s!.templateId,
      status: s!.status,
      submittedAt: s!.submittedAt.toISOString(),
      feedbackGood: s!.status === "passed" ? s!.feedbackGood : null,
      feedbackBetter: s!.status === "passed" ? s!.feedbackBetter : null,
      failReason: s!.status === "failed" ? s!.failReason : null,
      grain: s!.grain,
      counted: s!.counted,
      card: card ? { id: card.id, title: card.title, summary: card.summary, tag: card.tag } : null,
      // what the child handed in, so "改一改再交" starts from it (part 5 C2 "可以修改后重交")
      explainKind: s!.explainKind,
      explainText: s!.explainText,
      aiNote: s!.aiNote,
      noAi: s!.noAi,
      evidenceFileIds: s!.evidenceFileIds as string[],
    };
  }

  /** C1 header: "今天已计 x/2 次、本周 y/4 次" (season players), retries left today. */
  async today(child: ChildRow) {
    const now = this.now();
    const day = beijingDate(now);
    const subs = await this.db.select().from(dailySubmissions).where(and(eq(dailySubmissions.childId, child.id), eq(dailySubmissions.day, day)));
    const failed = subs.filter((s) => s.status === "failed").length;
    const out = {
      day,
      submittedToday: subs.length,
      passedToday: subs.filter((s) => s.status === "passed").length,
      retriesLeft: Math.max(0, DAILY_RETRIES_PER_DAY + 1 - failed),
      season: null as null | { countedToday: number; capPerDay: number; countedThisWeek: number; capPerWeek: number },
      templates: DAILY_TEMPLATES,
    };
    const l = await this.play.lookup(child.id);
    if (l.kind === "playing") {
      const st = await this.store.state(l.ctx.serverId);
      const week = seasonWeekOf(seasonDayOf(st.opening, now));
      const mine = st.taskPasses.filter((t) => t.childId === child.id && t.counted);
      out.season = {
        countedToday: mine.filter((t) => t.date === day).length,
        capPerDay: st.params.dailyTask.capPerDay,
        countedThisWeek: mine.filter((t) => t.week === week).length,
        capPerWeek: st.params.dailyTask.capPerWeek,
      };
    }
    return out;
  }

  // ---- 修行日志 (C4–C7) ---------------------------------------------------------------------------

  private cardView(c: typeof knowledgeCards.$inferSelect) {
    return { id: c.id, title: c.title, summary: c.summary, tag: c.tag, difficulty: c.difficulty, day: c.day, submissionId: c.submissionId };
  }

  /** C4: one month as a calendar (cards per day). `month` = "2027-03". */
  async calendar(childId: string, month: string) {
    const rows = await this.db
      .select()
      .from(knowledgeCards)
      .where(and(eq(knowledgeCards.childId, childId), eq(knowledgeCards.visible, true), gte(knowledgeCards.day, `${month}-01`), lte(knowledgeCards.day, `${month}-31`)))
      .orderBy(asc(knowledgeCards.day), asc(knowledgeCards.createdAt));
    const days: Record<string, ReturnType<DailyTasks["cardView"]>[]> = {};
    for (const r of rows) (days[r.day] ??= []).push(this.cardView(r));
    return { month, days };
  }

  /** C5: the 15 subjects with how many cards each, and the sub-fields. */
  async subjects(childId: string) {
    const rows = await this.db.select().from(knowledgeCards).where(and(eq(knowledgeCards.childId, childId), eq(knowledgeCards.visible, true)));
    return {
      subjects: Object.entries(TAXONOMY).map(([name, subs]) => ({
        name,
        cards: rows.filter((r) => r.tag?.startsWith(`${name}/`)).length,
        subfields: subs.map((sub) => ({ name: sub, cards: rows.filter((r) => r.tag === `${name}/${sub}`).length })),
      })),
      other: rows.filter((r) => r.tag?.startsWith("其他/")).length,
      total: rows.length,
    };
  }

  /** C5 drill-down and C6 search. */
  async cards(childId: string, q: { tag?: string; text?: string }) {
    const conds = [eq(knowledgeCards.childId, childId), eq(knowledgeCards.visible, true)];
    if (q.tag) conds.push(q.tag.includes("/") ? eq(knowledgeCards.tag, q.tag) : ilike(knowledgeCards.tag, `${q.tag}/%`));
    if (q.text) conds.push(or(ilike(knowledgeCards.title, `%${q.text}%`), ilike(knowledgeCards.summary, `%${q.text}%`))!);
    const rows = await this.db.select().from(knowledgeCards).where(and(...conds)).orderBy(desc(knowledgeCards.day), desc(knowledgeCards.createdAt)).limit(200);
    return { cards: rows.map((r) => this.cardView(r)) };
  }

  /** C7: the card with the child's own explanation and the evidence. */
  async card(childId: string, id: string) {
    const [c] = await this.db.select().from(knowledgeCards).where(and(eq(knowledgeCards.id, id), eq(knowledgeCards.childId, childId)));
    if (!c) fail(404, "not_found");
    const [s] = await this.db.select().from(dailySubmissions).where(eq(dailySubmissions.id, c!.submissionId));
    const ids = [...(s!.evidenceFileIds as string[]), ...(s!.explainFileId ? [s!.explainFileId] : [])];
    const fs = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
    const now = this.now();
    const url = async (f: typeof files.$inferSelect) => ({ id: f.id, kind: f.kind, url: await this.storage.downloadUrl(f.storageKey, now) });
    return {
      ...this.cardView(c!),
      templateId: s!.templateId,
      explainText: s!.explainText,
      voice: s!.explainFileId ? await url(fs.find((f) => f.id === s!.explainFileId)!) : null,
      evidence: await Promise.all(fs.filter((f) => f.id !== s!.explainFileId && f.status !== "deleted").map(url)),
    };
  }
}
