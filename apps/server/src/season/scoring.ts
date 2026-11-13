/**
 * From deadline to settlement (PRD part 3 §10.5, §11, §14; part 6 T5; part 7
 * §5–§6):
 *
 * 1. At the deadline of a contest, a weekly war or the big battle, the
 *    counting work of each team is frozen, the AI gives an initial score, and
 *    each work gets a responsible reviewer (fewest open reviews first; reviewers
 *    on leave are skipped); about 10 % also get a second reviewer.
 * 2. Reviewers score blind (no team or member names). The first reviewer's
 *    score is the settled score. A second score more than `diffAlert` away goes
 *    to the admins to rule.
 * 3. `remindBeforeHours` before the time limit the reviewer is reminded; at the
 *    limit the AI score is used ("超时，按 AI 分结算") and the admins are told;
 *    without an AI score an admin must rule.
 * 4. When every work of a round has a settled score, the engine settles it
 *    (missing works count as not submitted).
 *
 * The worker calls `runDue` for every live server each tick; every step is
 * idempotent.
 */

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  adminUsers,
  aiScores,
  files,
  humanScores,
  lands,
  reviewAssignments,
  reviewerLeaves,
  scoringRounds,
  settledScores,
  works,
  type Db,
} from "@zhiyouji/db";
import { battleDeadline, beijingDate, campsFormAt, resolveContest, warDeadline, type SeasonEvent, type SeasonState } from "@zhiyouji/engine";
import { formatBeijing } from "@zhiyouji/shared";
import type { AiScorer } from "../ai.js";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import type { ObjectStorage } from "../storage.js";
import { refusalText } from "./refusals.js";
import { checkDims, RUBRICS, rubricFor, type RubricId } from "./rubrics.js";

const HOUR = 3_600_000;
type WorkRow = typeof works.$inferSelect;
type RoundRow = typeof scoringRounds.$inferSelect;

/** Slots a scoring round covers. */
function slotsOf(key: string): string[] {
  if (key === "battle") return ["line", "main:a", "main:b"];
  // Debate lands: the opening (立论) and the rebuttal (驳论) are scored together.
  return key.startsWith("contest:") ? [key, `${key}:open`] : [key];
}

const baseSlot = (slot: string) => slot.replace(/:open$/, "");

export class Scoring {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly ai: AiScorer,
    private readonly notifier: Notifier,
    private readonly storage: ObjectStorage,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  async runDue(serverId: string): Promise<{ closed: number; settled: number; timeouts: number }> {
    const st = await this.store.state(serverId);
    const now = this.now();
    let closed = 0;
    for (const id of st.contestOrder) {
      const c = st.contests[id]!;
      if (c.status === "active" && c.deadline <= now && (await this.close(serverId, st, `contest:${id}`))) closed++;
    }
    for (const w of Object.values(st.wars)) {
      if (!w.settled && w.pairs.length > 0 && warDeadline(st, w.week) <= now && (await this.close(serverId, st, `war:${w.week}`))) closed++;
    }
    if (st.bigBattle?.final && !st.bigBattle.settled && battleDeadline(st) <= now && (await this.close(serverId, st, "battle"))) closed++;
    const timeouts = await this.timers(serverId);
    const settled = await this.trySettle(serverId);
    return { closed, settled, timeouts };
  }

  // ---- 1. closing a round ------------------------------------------------------------------------

  /** The works that count: each team's last version; for the main field, the camp's last one. */
  async countingWorks(serverId: string, key: string): Promise<WorkRow[]> {
    const rows = await this.db
      .select()
      .from(works)
      .where(and(eq(works.serverId, serverId), inArray(works.slot, slotsOf(key))))
      .orderBy(asc(works.submittedAt), asc(works.version));
    const last = new Map<string, WorkRow>();
    // Openings first, so a team's rebuttal (when there is one) is the work that counts.
    const ordered = [...rows.filter((r) => r.slot.endsWith(":open")), ...rows.filter((r) => !r.slot.endsWith(":open"))];
    for (const r of ordered) last.set(r.slot.startsWith("main:") ? r.slot : `${baseSlot(r.slot)}|${r.teamId}`, r);
    return [...last.values()];
  }

  private async rubricOf(serverId: string, st: SeasonState, w: WorkRow): Promise<RubricId> {
    if (w.kind !== "contest") return rubricFor(w.kind, null);
    const landId = st.contests[baseSlot(w.slot).slice("contest:".length)]?.landId;
    const [land] = landId ? await this.db.select().from(lands).where(and(eq(lands.serverId, serverId), eq(lands.code, landId))) : [];
    return rubricFor("contest", land?.name ?? null);
  }

  private async close(serverId: string, st: SeasonState, key: string): Promise<boolean> {
    const now = this.now();
    const [round] = await this.db.insert(scoringRounds).values({ serverId, key, closedAt: new Date(now) }).onConflictDoNothing().returning();
    if (!round) return false;
    let due = now + st.params.review.timeoutHours * HOUR;
    // W4 must be reviewed before the camps form (D29 noon, §14).
    if (key.startsWith("war:") && Number(key.slice(4)) === Math.floor((st.params.time.bigBattleStartDay - 1) / 7)) due = Math.min(due, Math.max(now + HOUR, campsFormAt(st)));
    for (const w of await this.countingWorks(serverId, key)) {
      await this.aiScore(serverId, st, w);
      await this.assign(w, new Date(due), st.params.review.doubleReviewRatio);
    }
    return true;
  }

  /** 单条重跑 (part 6 §9): score a work again; kept as an extra record, the official score stays. */
  async rerunAi(workId: string) {
    const [w] = await this.db.select().from(works).where(eq(works.id, workId));
    if (!w) fail(404, "not_found");
    const st = await this.store.state(w!.serverId);
    await this.aiScore(w!.serverId, st, w!, false);
    const rows = await this.db.select().from(aiScores).where(eq(aiScores.workId, workId)).orderBy(desc(aiScores.createdAt));
    return { scores: rows.map((r) => ({ total: r.total, model: r.model, official: r.official, createdAt: r.createdAt.toISOString() })) };
  }

  private async aiScore(serverId: string, st: SeasonState, w: WorkRow, official = true): Promise<void> {
    const rubric = RUBRICS[await this.rubricOf(serverId, st, w)];
    const ids = (w.fileIds as string[]) ?? [];
    const fs = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
    const transcript = fs.map((f) => f.transcript).filter(Boolean).join("\n") || null;
    try {
      const r = await this.ai.score({ workId: w.id, rubric, promptId: w.promptId, mediaKind: w.mediaKind, text: w.text, aiNote: w.aiNote, transcript });
      await this.db.insert(aiScores).values({
        workId: w.id,
        rubric: `${rubric.id}@${rubric.version}`,
        model: r.model,
        total: Math.max(0, Math.min(100, Math.round(r.total))),
        dims: r.dims,
        comment: r.comment,
        flags: r.flags,
        official,
        createdAt: this.clock.now(),
      });
    } catch (err) {
      if (!official) throw err;
      // No AI score: reviewers score as usual; at the time limit an admin must rule (part 6 §5).
      await this.notifier.notifyAdmins({
        kind: "ai_failed",
        title: "作品初评失败",
        body: `一件作品的 AI 初评失败了（${String((err as Error).message ?? err)}）。复核员照常打分即可。`,
        link: `/reviews/works/${w.id}`,
        dedupeKey: `ai_failed:${w.id}`,
        roles: ["admin"],
      });
    }
  }

  /** Reviewers on duty today, fewest open reviews first (admins if there is no reviewer). */
  private async onDuty(): Promise<{ id: string; load: number }[]> {
    const today = beijingDate(this.now());
    const users = await this.db.select().from(adminUsers).where(eq(adminUsers.status, "active"));
    const leaves = await this.db.select().from(reviewerLeaves);
    const away = new Set(leaves.filter((l) => l.fromDay <= today && today <= l.toDay).map((l) => l.reviewerId));
    let pool = users.filter((u) => u.role === "reviewer" && !away.has(u.id));
    if (pool.length === 0) pool = users.filter((u) => u.role === "admin" && !away.has(u.id));
    if (pool.length === 0) return [];
    const open = await this.db
      .select({ reviewerId: reviewAssignments.reviewerId })
      .from(reviewAssignments)
      .where(and(eq(reviewAssignments.status, "pending"), inArray(reviewAssignments.reviewerId, pool.map((u) => u.id))));
    const load = new Map<string, number>();
    for (const r of open) load.set(r.reviewerId, (load.get(r.reviewerId) ?? 0) + 1);
    return pool.map((u) => ({ id: u.id, load: load.get(u.id) ?? 0 })).sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));
  }

  private async assign(w: WorkRow, dueAt: Date, ratio: number): Promise<void> {
    const pool = await this.onDuty();
    if (pool.length === 0) return;
    const now = this.clock.now();
    await this.db.insert(reviewAssignments).values({ workId: w.id, reviewerId: pool[0]!.id, assignedAt: now, dueAt });
    // About `ratio` of works also go to a second reviewer (deterministic per work).
    const r = createHash("sha256").update(`second|${w.id}`).digest().readUInt32BE(0) / 0x1_0000_0000;
    if (pool.length > 1 && r < ratio) await this.db.insert(reviewAssignments).values({ workId: w.id, reviewerId: pool[1]!.id, second: true, assignedAt: now, dueAt });
  }

  // ---- 2. reviewing --------------------------------------------------------------------------------

  private async settledOf(workIds: string[]): Promise<Map<string, typeof settledScores.$inferSelect>> {
    const out = new Map<string, typeof settledScores.$inferSelect>();
    if (workIds.length === 0) return out;
    const rows = await this.db.select().from(settledScores).where(inArray(settledScores.workId, workIds)).orderBy(asc(settledScores.decidedAt));
    for (const r of rows) out.set(r.workId, r); // the latest decision wins
    return out;
  }

  private async officialAi(workId: string) {
    const [r] = await this.db
      .select()
      .from(aiScores)
      .where(and(eq(aiScores.workId, workId), eq(aiScores.official, true)))
      .orderBy(desc(aiScores.createdAt))
      .limit(1);
    return r ?? null;
  }

  private async roundOfWork(w: WorkRow): Promise<RoundRow | null> {
    const key = w.slot === "line" || w.slot.startsWith("main:") ? "battle" : baseSlot(w.slot);
    const [r] = await this.db.select().from(scoringRounds).where(and(eq(scoringRounds.serverId, w.serverId), eq(scoringRounds.key, key)));
    return r ?? null;
  }

  /** The reviewer's queue (blind: no team or member names), soonest due first. */
  async queue(reviewerId: string) {
    const rows = await this.db
      .select({ a: reviewAssignments, w: works })
      .from(reviewAssignments)
      .innerJoin(works, eq(reviewAssignments.workId, works.id))
      .where(and(eq(reviewAssignments.reviewerId, reviewerId), eq(reviewAssignments.status, "pending")))
      .orderBy(asc(reviewAssignments.dueAt));
    const now = this.now();
    return {
      reviews: rows.map((r) => ({
        assignmentId: r.a.id,
        workId: r.w.id,
        kind: r.w.kind,
        promptId: r.w.promptId,
        second: r.a.second,
        dueAt: r.a.dueAt.toISOString(),
        dueSoon: +r.a.dueAt - now <= 6 * HOUR,
      })),
    };
  }

  private async assignment(reviewerId: string, assignmentId: string) {
    const [row] = await this.db
      .select({ a: reviewAssignments, w: works })
      .from(reviewAssignments)
      .innerJoin(works, eq(reviewAssignments.workId, works.id))
      .where(eq(reviewAssignments.id, assignmentId));
    if (!row || row.a.reviewerId !== reviewerId) fail(404, "not_found");
    return row!;
  }

  /** One work to review: the work, its files, the rubric and the AI's draft (part 7 §5.2). Blind. */
  async reviewView(reviewerId: string, assignmentId: string) {
    const { a, w } = await this.assignment(reviewerId, assignmentId);
    const st = await this.store.state(w.serverId);
    const rubric = RUBRICS[await this.rubricOf(w.serverId, st, w)];
    const ids = (w.fileIds as string[]) ?? [];
    const fs = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
    const ai = await this.officialAi(w.id);
    const now = this.now();
    // Debate lands: the reviewer sees the team's opening next to its rebuttal.
    let opening = null;
    if (w.kind === "contest" && !w.slot.endsWith(":open")) {
      const [o] = await this.db
        .select()
        .from(works)
        .where(and(eq(works.serverId, w.serverId), eq(works.teamId, w.teamId), eq(works.slot, `${w.slot}:open`)))
        .orderBy(desc(works.version))
        .limit(1);
      if (o) {
        const oids = (o.fileIds as string[]) ?? [];
        const ofs = oids.length ? await this.db.select().from(files).where(inArray(files.id, oids)) : [];
        opening = {
          text: o.text,
          mediaKind: o.mediaKind,
          files: await Promise.all(ofs.map(async (f) => ({ id: f.id, kind: f.kind, contentType: f.contentType, transcript: f.transcript, url: await this.storage.downloadUrl(f.storageKey, now) }))),
        };
      }
    }
    return {
      opening,
      assignmentId: a.id,
      status: a.status,
      second: a.second,
      dueAt: a.dueAt.toISOString(),
      work: {
        id: w.id,
        kind: w.kind,
        promptId: w.promptId,
        mediaKind: w.mediaKind,
        text: w.text,
        aiNote: w.aiNote,
        submittedAt: w.submittedAt.toISOString(),
        files: await Promise.all(
          fs.map(async (f) => ({ id: f.id, kind: f.kind, contentType: f.contentType, transcript: f.transcript, url: await this.storage.downloadUrl(f.storageKey, now) })),
        ),
      },
      rubric,
      ai: ai ? { total: ai.total, dims: ai.dims, comment: ai.comment, flags: ai.flags, model: ai.model } : null,
      /** Children whose data this is (for the view log). */
      members: w.members as string[],
    };
  }

  /** Submit a score: final (part 7 §5.2: corrections are an admin ruling). */
  async submitScore(reviewerId: string, assignmentId: string, b: { dims: Record<string, number>; comment: string; flags?: string[] }) {
    const { a, w } = await this.assignment(reviewerId, assignmentId);
    if (a.status !== "pending") fail(409, a.status === "timeout" ? "review_timeout" : "review_done");
    const st = await this.store.state(w.serverId);
    const rubric = RUBRICS[await this.rubricOf(w.serverId, st, w)];
    if (!checkDims(rubric, b.dims)) fail(400, "bad_dims");
    const total = Object.values(b.dims).reduce((s, v) => s + v, 0);
    const now = this.clock.now();
    await this.db.insert(humanScores).values({ assignmentId, workId: w.id, reviewerId, total, dims: b.dims, comment: b.comment, flags: b.flags ?? [], at: now });
    await this.db.update(reviewAssignments).set({ status: "done", doneAt: now }).where(eq(reviewAssignments.id, assignmentId));
    const settled = (await this.settledOf([w.id])).get(w.id);
    const round = await this.roundOfWork(w);
    if (!a.second) {
      if (!settled && round?.status !== "settled")
        await this.db.insert(settledScores).values({ workId: w.id, score: total, basis: "human", decidedAt: now, decidedBy: `admin:${reviewerId}` });
    } else {
      const [first] = await this.db
        .select({ h: humanScores })
        .from(humanScores)
        .innerJoin(reviewAssignments, eq(humanScores.assignmentId, reviewAssignments.id))
        .where(and(eq(humanScores.workId, w.id), eq(reviewAssignments.second, false)));
      const base = first?.h.total ?? settled?.score;
      if (base !== undefined && Math.abs(base - total) > st.params.review.diffAlert)
        await this.notifier.notifyAdmins({
          kind: "double_review_gap",
          title: "双人复核分差过大",
          body: `一件作品两位复核员的分数是 ${base} 和 ${total}，相差超过 ${st.params.review.diffAlert} 分，请裁定。`,
          link: `/reviews/works/${w.id}`,
          dedupeKey: `double_gap:${w.id}`,
          roles: ["admin"],
        });
    }
    await this.trySettle(w.serverId);
    return { total };
  }

  /** Admin ruling: the score a settlement uses (before the round is settled). */
  async rule(workId: string, score: number, note: string, by: string) {
    const [w] = await this.db.select().from(works).where(eq(works.id, workId));
    if (!w) fail(404, "not_found");
    const round = await this.roundOfWork(w!);
    if (!round) fail(409, "not_closed");
    if (round!.status === "settled") fail(409, "already_settled");
    await this.db.insert(settledScores).values({ workId, score, basis: "admin", decidedAt: this.clock.now(), decidedBy: by, note });
    await this.trySettle(w!.serverId);
    return { ok: true };
  }

  /**
   * 改判 after settlement (part 3 §16, §20.4): the new score is recorded (the
   * team's result page shows it), the contest outcome is worked out again, and
   * the admins get the list of interventions that would bring the season in
   * line (land owner, merit points, income moved) — they apply them by hand in
   * 人工干预, since later events may have built on the old result.
   */
  async rejudge(workId: string, score: number, note: string, by: string) {
    const [w] = await this.db.select().from(works).where(eq(works.id, workId));
    if (!w) fail(404, "not_found");
    const round = await this.roundOfWork(w!);
    if (!round || round.status !== "settled") fail(409, "not_settled");
    await this.db.insert(settledScores).values({ workId, score, basis: "admin", decidedAt: this.clock.now(), decidedBy: by, note: `改判：${note}` });
    const st = await this.store.state(w!.serverId);
    const suggestions: string[] = [];
    let before: unknown = null;
    let after: unknown = null;
    if (round!.key.startsWith("contest:")) {
      const c = st.contests[round!.key.slice(8)]!;
      const ws = await this.countingWorks(w!.serverId, round!.key);
      const settled = await this.settledOf(ws.map((x) => x.id));
      const sc = (t: string) => {
        const x = ws.find((y) => y.teamId === t);
        return x ? (settled.get(x.id)?.score ?? null) : null;
      };
      const outcome = resolveContest({ attackers: c.attackers.map((a) => ({ teamId: a.teamId, score: sc(a.teamId), order: a.order })), defender: { teamId: c.defender, score: sc(c.defender) } }, st.params);
      before = c.outcome ?? null;
      after = outcome.kind === "captured" ? { kind: "captured", winner: outcome.winner } : { kind: outcome.kind };
      const name = (id: string) => st.teams[id]?.name ?? id;
      const oldWinner = c.outcome?.kind === "captured" ? c.outcome.winner : null;
      const newWinner = outcome.kind === "captured" ? outcome.winner : null;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        const laterContest = Object.values(st.contests).some((x) => x.landId === c.landId && x.id !== c.id && x.startedAt > (c.settledAt ?? 0));
        if (laterContest) suggestions.push(`这块地之后又被争夺过，请先核对后来的结果，再手动调整。`);
        const merit = st.ledger.filter((e) => e.refId === c.id && (e.source === "merit_capture" || e.source === "merit_defend" || e.source === "territory_transfer" || e.source === "item_effect") && !e.reverses);
        for (const e of merit) suggestions.push(`冲正账目 ${e.id}（${name(e.teamId)}，${e.source}，${e.amount}）`);
        const owner = newWinner ?? c.defender;
        if ((oldWinner ?? c.defender) !== owner) suggestions.push(`把 ${c.landId} 的主人改为 ${name(owner)}`);
        if (outcome.kind === "captured") suggestions.push(`给 ${name(outcome.winner)} 加夺地战功（团队分 ${st.params.contest.meritCapture}，九转兵劫印期间加倍），并转移截止后已发的领地收益`);
        if (outcome.kind === "defended") suggestions.push(`给 ${name(c.defender)} 加守地战功（团队分 ${st.params.contest.meritDefend}）`);
      }
    } else suggestions.push("周战争 / 大团战的改判请按新分数手动调整团队分。");
    await this.notifier.notifyAdmins({
      kind: "rejudged",
      title: "改判已记录",
      body: suggestions.length ? `结果有变化，需要手动处理：${suggestions.join("；")}` : "结果没有变化，只更新了分数。",
      link: `/reviews/works/${workId}`,
      dedupeKey: `rejudge:${workId}:${+this.clock.now()}`,
      roles: ["admin"],
    });
    return { before, after, changed: suggestions.length > 0, suggestions };
  }

  /** Move an open review to another reviewer. */
  async reassign(assignmentId: string, reviewerId: string) {
    const [a] = await this.db.select().from(reviewAssignments).where(eq(reviewAssignments.id, assignmentId));
    if (!a) fail(404, "not_found");
    if (a!.status !== "pending") fail(409, "review_done");
    const [u] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, reviewerId));
    if (!u || u.status !== "active") fail(404, "not_found");
    await this.db.update(reviewAssignments).set({ status: "reassigned" }).where(eq(reviewAssignments.id, assignmentId));
    const [n] = await this.db
      .insert(reviewAssignments)
      .values({ workId: a!.workId, reviewerId, second: a!.second, assignedAt: this.clock.now(), dueAt: a!.dueAt })
      .returning();
    return { assignmentId: n!.id };
  }

  async addLeave(reviewerId: string, fromDay: string, toDay: string) {
    if (toDay < fromDay) fail(400, "bad_request");
    await this.db.insert(reviewerLeaves).values({ reviewerId, fromDay, toDay, createdAt: this.clock.now() });
    return { ok: true };
  }

  // ---- 3. time limits ----------------------------------------------------------------------------

  private async timers(serverId: string): Promise<number> {
    const now = this.now();
    const rows = await this.db
      .select({ a: reviewAssignments, w: works })
      .from(reviewAssignments)
      .innerJoin(works, eq(reviewAssignments.workId, works.id))
      .where(and(eq(works.serverId, serverId), eq(reviewAssignments.status, "pending")));
    const st = await this.store.state(serverId);
    let timeouts = 0;
    for (const { a, w } of rows) {
      if (+a.dueAt <= now) {
        timeouts++;
        await this.db.update(reviewAssignments).set({ status: "timeout" }).where(eq(reviewAssignments.id, a.id));
        if (a.second) continue;
        await this.settleByAi(w, now);
      } else if (!a.remindedAt && +a.dueAt - now <= st.params.review.remindBeforeHours * HOUR) {
        await this.db.update(reviewAssignments).set({ remindedAt: new Date(now) }).where(eq(reviewAssignments.id, a.id));
        await this.notifier.notifyAdmins({
          kind: "review_due",
          title: "复核快到时限了",
          body: `你有一件作品要在 ${formatBeijing(+a.dueAt)}（北京时间）前复核完。`,
          link: `/reviews/${a.id}`,
          dedupeKey: `review_due:${a.id}`,
          userIds: [a.reviewerId],
        });
      }
    }
    // Works nobody could be assigned to (no reviewer or admin on duty): the AI score at the time limit.
    const open = await this.db.select().from(scoringRounds).where(and(eq(scoringRounds.serverId, serverId), eq(scoringRounds.status, "open")));
    for (const round of open) {
      if (+round.closedAt + st.params.review.timeoutHours * HOUR > now) continue;
      for (const w of await this.countingWorks(serverId, round.key)) {
        const [primary] = await this.db
          .select({ id: reviewAssignments.id })
          .from(reviewAssignments)
          .where(and(eq(reviewAssignments.workId, w.id), eq(reviewAssignments.second, false)));
        if (!primary) {
          timeouts++;
          await this.settleByAi(w, now);
        }
      }
    }
    return timeouts;
  }

  /** At the time limit: the AI score, or (without one) ask an admin to rule. */
  private async settleByAi(w: WorkRow, now: number): Promise<void> {
    const settled = (await this.settledOf([w.id])).get(w.id);
    if (settled) return;
    const ai = await this.officialAi(w.id);
    if (ai) {
      await this.db.insert(settledScores).values({ workId: w.id, score: ai.total, basis: "ai_timeout", decidedAt: new Date(now), decidedBy: "system", note: "超时，按 AI 分结算" });
      await this.notifier.notifyAdmins({
        kind: "review_timeout",
        title: "复核超时，按 AI 分结算",
        body: `一件作品到了复核时限还没有人工分，已按 AI 分 ${ai.total} 结算。`,
        link: `/reviews/works/${w.id}`,
        dedupeKey: `review_timeout:${w.id}`,
        roles: ["admin"],
      });
    } else
      await this.notifier.notifyAdmins({
        kind: "review_timeout",
        title: "复核超时，没有 AI 分，请裁定",
        body: "一件作品到了复核时限，既没有人工分也没有 AI 分，需要管理员给分后才能结算。",
        link: `/reviews/works/${w.id}`,
        dedupeKey: `review_timeout:${w.id}`,
        roles: ["admin"],
      });
  }

  // ---- 4. settling --------------------------------------------------------------------------------

  private async trySettle(serverId: string): Promise<number> {
    const open = await this.db.select().from(scoringRounds).where(and(eq(scoringRounds.serverId, serverId), eq(scoringRounds.status, "open")));
    let n = 0;
    for (const round of open) if (await this.settleRound(serverId, round)) n++;
    return n;
  }

  private async settleRound(serverId: string, round: RoundRow): Promise<boolean> {
    const ws = await this.countingWorks(serverId, round.key);
    const settled = await this.settledOf(ws.map((w) => w.id));
    if (ws.some((w) => !settled.has(w.id))) return false;
    const st = await this.store.state(serverId);
    const at = this.now();
    const score = (w: WorkRow | undefined) => (w ? settled.get(w.id)!.score : null);
    let event: SeasonEvent | null = null;
    if (round.key.startsWith("contest:")) {
      const c = st.contests[round.key.slice(8)];
      if (c && c.status === "active") {
        const teams = [c.defender, ...c.attackers.map((x) => x.teamId)];
        event = { type: "settle_contest", contestId: c.id, at, scores: Object.fromEntries(teams.map((t) => [t, score(ws.find((w) => w.teamId === t))])) };
      }
    } else if (round.key.startsWith("war:")) {
      const week = Number(round.key.slice(4));
      const war = st.wars[week];
      if (war && !war.settled) {
        const teams = war.pairs.flat();
        event = { type: "settle_war", week, at, scores: Object.fromEntries(teams.map((t) => [t, score(ws.find((w) => w.teamId === t && w.slot === round.key))])) };
      }
    } else if (round.key === "battle") {
      const bb = st.bigBattle;
      if (bb?.final && !bb.settled) {
        const teams = [...bb.final.a, ...bb.final.b];
        event = {
          type: "settle_big_battle",
          at,
          lineScores: Object.fromEntries(teams.map((t) => [t, score(ws.find((w) => w.slot === "line" && w.teamId === t))])),
          mainScores: { a: score(ws.find((w) => w.slot === "main:a")), b: score(ws.find((w) => w.slot === "main:b")) },
        };
      }
    }
    if (event) {
      const r = await this.store.apply(serverId, event, "system");
      if (!r.ok && r.refusal !== "already_done" && r.refusal !== "already_settled") {
        await this.notifier.notifyAdmins({
          kind: "settle_failed",
          title: "结算失败",
          body: `${round.key} 结算没有成功：${refusalText(r.refusal)}。`,
          link: `/servers/${serverId}`,
          dedupeKey: `settle_failed:${serverId}:${round.key}:${r.refusal}`,
          roles: ["admin"],
        });
        return false;
      }
    }
    await this.db.update(scoringRounds).set({ status: "settled", settledAt: new Date(at) }).where(eq(scoringRounds.id, round.id));
    return true;
  }

  // ---- results for the team (part 5 E7) and the reviewer dashboard (part 7 §6) ----------------------

  /** After settlement: every team's score; the own team's dimensions and comments. */
  async results(serverId: string, teamId: string, slot: string) {
    const key = slot === "line" || slot.startsWith("main:") ? "battle" : baseSlot(slot);
    const [round] = await this.db.select().from(scoringRounds).where(and(eq(scoringRounds.serverId, serverId), eq(scoringRounds.key, key)));
    if (!round || round.status !== "settled") return { settled: false as const };
    const st = await this.store.state(serverId);
    const ws = (await this.countingWorks(serverId, key)).filter((w) => baseSlot(w.slot) === baseSlot(slot));
    const settled = await this.settledOf(ws.map((w) => w.id));
    const mine = ws.find((w) => w.teamId === teamId);
    let detail = null;
    if (mine) {
      const s = settled.get(mine.id)!;
      const [human] = await this.db
        .select({ h: humanScores })
        .from(humanScores)
        .innerJoin(reviewAssignments, eq(humanScores.assignmentId, reviewAssignments.id))
        .where(and(eq(humanScores.workId, mine.id), eq(reviewAssignments.second, false)));
      const ai = await this.officialAi(mine.id);
      const rubric = RUBRICS[await this.rubricOf(serverId, st, mine)];
      const dims = rubric.dims.map((d) => ({
        name: d.name,
        max: d.max,
        score: human ? ((human.h.dims as Record<string, number>)[d.key] ?? null) : ((ai?.dims as { key: string; score: number; reason: string }[] | undefined)?.find((x) => x.key === d.key)?.score ?? null),
        reason: human ? null : ((ai?.dims as { key: string; reason: string }[] | undefined)?.find((x) => x.key === d.key)?.reason ?? null),
      }));
      detail = { score: s.score, basis: s.basis, dims, comment: human?.h.comment ?? ai?.comment ?? null };
    }
    return {
      settled: true as const,
      scores: ws.map((w) => ({ teamId: w.teamId, name: st.teams[w.teamId]?.name ?? "", score: settled.get(w.id)?.score ?? null, mine: w.teamId === teamId })),
      mine: detail,
    };
  }

  /** 复核员看板: per reviewer, and the works settled by AI after a timeout. */
  async dashboard() {
    const users = await this.db.select().from(adminUsers);
    const as = await this.db.select().from(reviewAssignments);
    const hs = await this.db.select().from(humanScores);
    const ss = await this.db.select().from(settledScores);
    const ai = await this.db.select().from(aiScores).where(eq(aiScores.official, true));
    const aiByWork = new Map(ai.map((r) => [r.workId, r.total]));
    const humanByAssignment = new Map(hs.map((h) => [h.assignmentId, h]));
    const timeoutWorks = ss.filter((s) => s.basis === "ai_timeout");
    const reviewers = users
      .filter((u) => as.some((a) => a.reviewerId === u.id))
      .map((u) => {
        const mine = as.filter((a) => a.reviewerId === u.id && a.status !== "reassigned");
        const done = mine.filter((a) => a.status === "done");
        const onTime = done.filter((a) => a.doneAt && +a.doneAt <= +a.dueAt);
        const timedOut = mine.filter((a) => a.status === "timeout" && !a.second);
        const minutes = done.map((a) => (+(a.doneAt ?? a.assignedAt) - +a.assignedAt) / 60_000);
        const aiGaps = done
          .map((a) => {
            const h = humanByAssignment.get(a.id);
            const x = aiByWork.get(a.workId);
            return h && x !== undefined ? Math.abs(h.total - x) : null;
          })
          .filter((x): x is number => x !== null);
        const pairGaps = done
          .map((a) => {
            const h = humanByAssignment.get(a.id);
            const other = as.find((b) => b.workId === a.workId && b.id !== a.id && b.status === "done");
            const oh = other ? humanByAssignment.get(other.id) : undefined;
            return h && oh ? Math.abs(h.total - oh.total) : null;
          })
          .filter((x): x is number => x !== null);
        const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10 : null);
        return {
          reviewerId: u.id,
          name: u.name,
          assigned: mine.length,
          pending: mine.filter((a) => a.status === "pending").length,
          doneOnTime: onTime.length,
          timedOutToAi: timedOut.length,
          timedOutWorks: timedOut.map((a) => a.workId),
          averageMinutes: avg(minutes),
          averageGapWithSecond: avg(pairGaps),
          averageGapWithAi: avg(aiGaps),
        };
      });
    return {
      reviewers,
      total: { settled: ss.length, timedOutToAi: timeoutWorks.length, works: timeoutWorks.map((s) => ({ workId: s.workId, score: s.score, at: s.decidedAt.toISOString() })) },
    };
  }
}

