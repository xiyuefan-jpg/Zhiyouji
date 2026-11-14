/**
 * 军需任务 (PRD part 3 §12; part 5 E9; part 8 §1.2):
 * - published at the planned time (Tuesday evening / Saturday morning), due
 *   Wednesday / Sunday 21:00;
 * - every member hands in their own part (text and pictures), the leader or
 *   deputy the team summary; both can be changed until the deadline;
 * - 3 hours before the deadline, members who have not handed in get a message
 *   and their parents an SMS;
 * - at the deadline the AI scores quality (40) and the summary (20); the
 *   participation share (40) is counted by the system; the engine pays 10 / 20
 *   / 30 grain. No human review (admins can re-tier with a ledger adjustment).
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { children, files, plannedEvents, prompts, supplyEntries, supplyResults, type Db } from "@zhiyouji/db";
import { grainOf, supplyScore } from "@zhiyouji/engine";
import { SUPPLY_PRESETS, SUPPLY_SCHEDULE, formatBeijing } from "@zhiyouji/shared";
import type { AiSupplyScorer } from "../ai.js";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import { refuse, type PlayCtx } from "./play.js";

const HOUR = 3_600_000;
export const SUPPLY_REMINDER_HOURS = 3;
const MIN = 60_000;
const SUPPLY_RETRY_WAITS = [1, 2, 5, 10, 15, 30].map((m) => m * MIN);
const SUPPLY_GIVE_UP_AFTER = 120 * MIN;

interface SupplyWindow {
  supplyId: string;
  week: number;
  opensAt: number;
  deadline: number;
}

/** The content library draft for a supply slot (1a, 1b, 2a …). */
export function supplyTask(supplyId: string) {
  const preset = SUPPLY_PRESETS.find((p) => p.id === SUPPLY_SCHEDULE[supplyId]) ?? SUPPLY_PRESETS[0];
  return { presetId: preset.id, title: preset.title, perPerson: preset.perPerson, summaryTask: preset.summary };
}

/** The supply slots in season order. */
export const SUPPLY_SLOTS = Object.keys(SUPPLY_SCHEDULE).sort();

/**
 * 军需任务 from the question bank: the enabled 军需任务 prompts in creation order
 * are slots 1a, 1b, 2a, … (body = what each member hands in unless `perPerson`
 * is set; `summaryTask` = the summary); a slot with none keeps the draft.
 */
export async function supplyTaskFor(db: Db, supplyId: string) {
  const rows = await db.select().from(prompts).where(and(eq(prompts.status, "enabled"), eq(prompts.category, "supply"))).orderBy(asc(prompts.createdAt), asc(prompts.id));
  const p = rows[SUPPLY_SLOTS.indexOf(supplyId)];
  if (!p) return supplyTask(supplyId);
  const x = (p.extra ?? {}) as { perPerson?: string | null; summaryTask?: string | null };
  return { presetId: p.id, title: p.title, perPerson: x.perPerson?.trim() || p.body, summaryTask: x.summaryTask?.trim() || "小组总结：大家的内容里最值得记住的是什么" };
}

export class Supply {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly ai: AiSupplyScorer,
    private readonly notifier: Notifier,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  /** Every supply task of a server from its planned events (moves with pauses and admin edits). */
  async windows(serverId: string): Promise<SupplyWindow[]> {
    const rows = await this.db
      .select()
      .from(plannedEvents)
      .where(and(eq(plannedEvents.serverId, serverId), inArray(plannedEvents.kind, ["supply_publish", "supply_deadline"])));
    const by = new Map<string, Partial<SupplyWindow>>();
    for (const r of rows) {
      const p = r.params as { supplyId: string; week: number };
      const w = by.get(p.supplyId) ?? { supplyId: p.supplyId, week: p.week };
      if (r.kind === "supply_publish") w.opensAt = +r.runAt;
      else w.deadline = +r.runAt;
      by.set(p.supplyId, w);
    }
    return [...by.values()].filter((w): w is SupplyWindow => w.opensAt !== undefined && w.deadline !== undefined).sort((a, b) => a.opensAt - b.opensAt);
  }

  private async window(serverId: string, supplyId: string): Promise<SupplyWindow> {
    const w = (await this.windows(serverId)).find((x) => x.supplyId === supplyId);
    if (!w) fail(404, "not_found");
    return w!;
  }

  private async latest(serverId: string, supplyId: string, teamIds?: string[]) {
    const rows = await this.db
      .select()
      .from(supplyEntries)
      .where(and(eq(supplyEntries.serverId, serverId), eq(supplyEntries.supplyId, supplyId), ...(teamIds ? [inArray(supplyEntries.teamId, teamIds)] : [])))
      .orderBy(asc(supplyEntries.at));
    const last = new Map<string, typeof supplyEntries.$inferSelect>();
    for (const r of rows) last.set(`${r.teamId}|${r.kind}|${r.kind === "member" ? r.childId : ""}`, r);
    return [...last.values()];
  }

  // ---- the team's view (E9) ------------------------------------------------------------------------

  async list(ctx: PlayCtx) {
    const now = this.now();
    const st = await this.store.state(ctx.serverId);
    const team = st.teams[ctx.teamId]!;
    const active = team.members.filter((m) => m.active).map((m) => m.childId);
    const out = [];
    for (const w of await this.windows(ctx.serverId)) {
      if (w.opensAt > now) continue;
      const entries = await this.latest(ctx.serverId, w.supplyId, [ctx.teamId]);
      const members = entries.filter((e) => e.kind === "member");
      const mine = members.find((e) => e.childId === ctx.childId);
      const summary = entries.find((e) => e.kind === "summary");
      const [result] = await this.db
        .select()
        .from(supplyResults)
        .where(and(eq(supplyResults.serverId, ctx.serverId), eq(supplyResults.supplyId, w.supplyId), eq(supplyResults.teamId, ctx.teamId)));
      const paid = st.ledger.find((e) => e.teamId === ctx.teamId && e.source === "supply" && e.refId === w.supplyId);
      out.push({
        supplyId: w.supplyId,
        week: w.week,
        ...(await supplyTaskFor(this.db, w.supplyId)),
        opensAt: new Date(w.opensAt).toISOString(),
        deadline: new Date(w.deadline).toISOString(),
        open: now < w.deadline,
        progress: { submitted: members.filter((e) => active.includes(e.childId)).length, members: active.length },
        mine: mine ? { text: mine.text, fileIds: mine.fileIds as string[], at: mine.at.toISOString() } : null,
        summary: summary ? { text: summary.text, by: summary.childId, at: summary.at.toISOString() } : null,
        result: result
          ? { submittedMembers: result.submittedMembers, quality: result.quality, summary: result.summary, grain: result.regradedGrain ?? paid?.amount ?? null, comment: result.comment, regraded: result.regradedGrain !== null }
          : null,
      });
    }
    return { tasks: out.reverse() };
  }

  private async checkFiles(ctx: PlayCtx, fileIds: string[]) {
    if (fileIds.length === 0) return;
    const fs = await this.db.select().from(files).where(and(inArray(files.id, fileIds), eq(files.teamId, ctx.teamId)));
    if (fs.length !== new Set(fileIds).size || fs.some((f) => f.status === "uploading" || f.kind !== "image")) fail(409, "upload_missing");
  }

  /** A member's own part (any active member). */
  async submitEntry(ctx: PlayCtx, supplyId: string, b: { text: string; fileIds: string[] }) {
    const w = await this.window(ctx.serverId, supplyId);
    const now = this.now();
    if (now < w.opensAt) refuse("too_early");
    if (now >= w.deadline) refuse("too_late");
    const st = await this.store.state(ctx.serverId);
    if (!st.teams[ctx.teamId]!.members.find((m) => m.childId === ctx.childId)?.active) fail(403, "withdrawn");
    await this.checkFiles(ctx, b.fileIds);
    await this.db.insert(supplyEntries).values({ serverId: ctx.serverId, teamId: ctx.teamId, supplyId, childId: ctx.childId, kind: "member", text: b.text, fileIds: b.fileIds, at: new Date(now) });
    return this.list(ctx);
  }

  /** The team summary (leader or deputy). */
  async submitSummary(ctx: PlayCtx, supplyId: string, b: { text: string; fileIds: string[] }) {
    const w = await this.window(ctx.serverId, supplyId);
    const now = this.now();
    if (now < w.opensAt) refuse("too_early");
    if (now >= w.deadline) refuse("too_late");
    const st = await this.store.state(ctx.serverId);
    const t = st.teams[ctx.teamId]!;
    if (t.leader !== ctx.childId && t.deputy !== ctx.childId) refuse("not_leader");
    await this.checkFiles(ctx, b.fileIds);
    await this.db.insert(supplyEntries).values({ serverId: ctx.serverId, teamId: ctx.teamId, supplyId, childId: ctx.childId, kind: "summary", text: b.text, fileIds: b.fileIds, at: new Date(now) });
    return this.list(ctx);
  }

  // ---- worker: reminders and scoring ------------------------------------------------------------------

  async runDue(serverId: string): Promise<{ reminded: number; settled: number }> {
    const now = this.now();
    const st = await this.store.state(serverId);
    let reminded = 0;
    let settled = 0;
    for (const w of await this.windows(serverId)) {
      if (now >= w.opensAt && now < w.deadline && now >= w.deadline - SUPPLY_REMINDER_HOURS * HOUR) {
        const done = new Set((await this.latest(serverId, w.supplyId)).filter((e) => e.kind === "member").map((e) => e.childId));
        const missing = st.teamOrder.flatMap((t) => st.teams[t]!.members.filter((m) => m.active && !done.has(m.childId)).map((m) => m.childId));
        const r = await this.notifier.notify({
          kind: "supply_due",
          childIds: missing,
          serverId,
          title: "军需任务你还没交",
          body: `「${(await supplyTaskFor(this.db, w.supplyId)).title}」你自己的那份还没交，${formatBeijing(w.deadline)} 截止。`,
          link: `/season/supply`,
          dedupeKey: `supply_due:${serverId}:${w.supplyId}`,
        });
        reminded += r.messages;
      }
      if (now >= w.deadline && !st.done.includes(`supply:${w.supplyId}`) && (await this.settle(serverId, w))) settled++;
    }
    return { reminded, settled };
  }

  /** AI answers kept between retries (one supply task, one team). */
  private scored = new Map<string, { quality: number; summary: number; model: string; comment: string | null }>();
  /** When to ask the AI again after a failure, per supply task (part 6 §5: retry, then fallback, then a person). */
  private nextTry = new Map<string, { at: number; attempts: number }>();

  /**
   * Score every team with the AI and pay out (part 3 §12). When the AI fails the task waits and
   * tries again (1, 2, 5, 10, 15, 30 … minutes); after 2 hours it settles on participation alone
   * and tells the admins, who can add points by hand (人工干预). Returns whether it settled.
   */
  // ---- admin: 军需 list, spot check, re-tier (part 7 §7) --------------------------------------------------

  /** Every supply task of a server with each team's result (no child content). */
  async adminList(serverId: string) {
    const now = this.now();
    const st = await this.store.state(serverId);
    const results = await this.db.select().from(supplyResults).where(eq(supplyResults.serverId, serverId));
    const entries = await this.db.select({ supplyId: supplyEntries.supplyId, teamId: supplyEntries.teamId, kind: supplyEntries.kind, childId: supplyEntries.childId }).from(supplyEntries).where(eq(supplyEntries.serverId, serverId));
    const out = [];
    for (const w of await this.windows(serverId)) {
      const settled = st.ledger.some((e) => e.source === "supply" && e.refId === w.supplyId) || results.some((r) => r.supplyId === w.supplyId);
      out.push({
        supplyId: w.supplyId,
        week: w.week,
        ...(await supplyTaskFor(this.db, w.supplyId)),
        opensAt: new Date(w.opensAt).toISOString(),
        deadline: new Date(w.deadline).toISOString(),
        status: now < w.opensAt ? "planned" : now < w.deadline ? "open" : settled ? "settled" : "scoring",
        teams: st.teamOrder.map((teamId) => {
          const team = st.teams[teamId]!;
          const active = team.members.filter((m) => m.active).length;
          const r = results.find((x) => x.supplyId === w.supplyId && x.teamId === teamId);
          const mine = entries.filter((e) => e.supplyId === w.supplyId && e.teamId === teamId);
          const submitted = new Set(mine.filter((e) => e.kind === "member").map((e) => e.childId)).size;
          const paid = st.ledger.find((e) => e.teamId === teamId && e.source === "supply" && e.refId === w.supplyId)?.amount ?? null;
          const score = r ? Math.round(supplyScore({ submittedMembers: r.submittedMembers, activeMembers: active, quality: r.quality, summary: r.summary }, st.params) * 10) / 10 : null;
          return {
            teamId,
            name: team.name,
            activeMembers: active,
            submittedMembers: r?.submittedMembers ?? submitted,
            hasSummary: mine.some((e) => e.kind === "summary"),
            quality: r?.quality ?? null,
            summary: r?.summary ?? null,
            score,
            model: r?.model ?? null,
            grain: r?.regradedGrain ?? paid ?? (r ? 0 : null),
            aiGrain: paid ?? (r ? 0 : null),
            regrade: r?.regradedGrain != null ? { grain: r.regradedGrain, note: r.regradeNote, by: r.regradedBy, at: r.regradedAt?.toISOString() ?? null } : null,
          };
        }),
      });
    }
    return { tiers: st.params.supply.tierGrain, bounds: st.params.supply.tierBounds, tasks: out };
  }

  /** One team's hand-ins for a spot check (the route records the view per child). */
  async adminTeam(serverId: string, supplyId: string, teamId: string) {
    await this.window(serverId, supplyId);
    const st = await this.store.state(serverId);
    if (!st.teams[teamId]) fail(404, "not_found");
    const entries = await this.latest(serverId, supplyId, [teamId]);
    const ids = [...new Set(entries.map((e) => e.childId))];
    const names = new Map((ids.length ? await this.db.select({ id: children.id, nickname: children.nickname }).from(children).where(inArray(children.id, ids)) : []).map((c) => [c.id, c.nickname]));
    const [r] = await this.db.select().from(supplyResults).where(and(eq(supplyResults.serverId, serverId), eq(supplyResults.supplyId, supplyId), eq(supplyResults.teamId, teamId)));
    return {
      ...(await supplyTaskFor(this.db, supplyId)),
      team: st.teams[teamId]!.name,
      entries: entries.map((e) => ({ kind: e.kind, childId: e.childId, nickname: names.get(e.childId) ?? "", text: e.text, files: (e.fileIds as string[]).length, at: e.at.toISOString() })),
      comment: r?.comment ?? null,
      children: ids,
    };
  }

  /**
   * 抽查改档: move a settled team to another grain tier. The difference from
   * what it has now is a grain adjustment (ledger, with the reason); refused
   * when the team no longer has the grain a lower tier would take back.
   */
  async regrade(serverId: string, supplyId: string, teamId: string, b: { grain: number; reason: string }, by: string) {
    const st = await this.store.state(serverId);
    const [r] = await this.db.select().from(supplyResults).where(and(eq(supplyResults.serverId, serverId), eq(supplyResults.supplyId, supplyId), eq(supplyResults.teamId, teamId)));
    if (!r || !st.teams[teamId]) fail(409, "supply_not_settled");
    if (!st.params.supply.tierGrain.includes(b.grain)) fail(400, "bad_request", { message: `档位只能是 ${st.params.supply.tierGrain.join(" / ")} 粮草` });
    const paid = st.ledger.find((e) => e.teamId === teamId && e.source === "supply" && e.refId === supplyId)?.amount ?? 0;
    const now = r!.regradedGrain ?? paid;
    const diff = b.grain - now;
    if (diff < 0 && grainOf(st, teamId) < -diff) fail(409, "not_enough_grain_to_take_back");
    if (diff !== 0) {
      const res = await this.store.apply(
        serverId,
        { type: "adjust_ledger", teamId, currency: "grain", amount: diff, at: this.now(), by, reason: `军需改档（${(await supplyTaskFor(this.db, supplyId)).title}）：${now} → ${b.grain} 粮草。${b.reason}` },
        "admin",
      );
      if (!res.ok) fail(409, String(res.refusal));
    }
    await this.db
      .update(supplyResults)
      .set({ regradedGrain: b.grain, regradeNote: b.reason, regradedBy: by, regradedAt: new Date(this.now()) })
      .where(eq(supplyResults.id, r!.id));
    await this.notifier.notify({
      kind: "system",
      childIds: st.teams[teamId]!.members.filter((m) => m.active).map((m) => m.childId),
      serverId,
      title: "军需任务的结果调整了",
      body: `「${(await supplyTaskFor(this.db, supplyId)).title}」管理员复查后改为 ${b.grain} 粮草（${diff > 0 ? `多给 ${diff}` : `收回 ${-diff}`}）。`,
      link: "/season/supply",
      dedupeKey: `supply_regrade:${serverId}:${supplyId}:${teamId}:${this.now()}:${now}->${b.grain}`,
    });
    return { grain: b.grain, change: diff };
  }

  private async settle(serverId: string, w: SupplyWindow): Promise<boolean> {
    const now = this.now();
    const key = `${serverId}:${w.supplyId}`;
    const wait = this.nextTry.get(key);
    if (wait && now < wait.at) return false;
    const st = await this.store.state(serverId);
    const entries = await this.latest(serverId, w.supplyId);
    const task = await supplyTaskFor(this.db, w.supplyId);
    const giveUp = now - w.deadline >= SUPPLY_GIVE_UP_AFTER;
    const results = [];
    const rows = [];
    let failure: unknown = null;
    for (const teamId of st.teamOrder) {
      const active = new Set(st.teams[teamId]!.members.filter((m) => m.active).map((m) => m.childId));
      const mine = entries.filter((e) => e.teamId === teamId);
      const members = mine.filter((e) => e.kind === "member" && active.has(e.childId));
      const summary = mine.find((e) => e.kind === "summary") ?? null;
      let got = { quality: 0, summary: 0, model: "none", comment: null as string | null };
      if (members.length > 0 || summary) {
        const cacheKey = `${key}:${teamId}`;
        const cached = this.scored.get(cacheKey);
        if (cached) got = cached;
        else {
          try {
            const r = await this.ai.scoreSupply({ task: { title: task.title, perPerson: task.perPerson, summary: task.summaryTask }, entries: members.map((e) => e.text), summary: summary?.text ?? null });
            got = { quality: Math.max(0, Math.min(40, Math.round(r.quality))), summary: summary ? Math.max(0, Math.min(20, Math.round(r.summary))) : 0, model: r.model, comment: r.comment };
            this.scored.set(cacheKey, got);
          } catch (err) {
            failure = err;
            // Participation still counts when the AI could not score in 2 hours.
            got = { quality: 0, summary: 0, model: "failed", comment: null };
          }
        }
      }
      rows.push({ serverId, supplyId: w.supplyId, teamId, submittedMembers: members.length, quality: got.quality, summary: got.summary, model: got.model, comment: got.comment, at: new Date(now) });
      results.push({ teamId, submittedMembers: members.length, quality: got.quality, summary: got.summary });
    }
    if (failure && !giveUp) {
      const attempts = (wait?.attempts ?? 0) + 1;
      this.nextTry.set(key, { at: now + SUPPLY_RETRY_WAITS[Math.min(attempts - 1, SUPPLY_RETRY_WAITS.length - 1)]!, attempts });
      return false;
    }
    if (failure)
      await this.notifier.notifyAdmins({
        kind: "ai_failed",
        title: "军需任务打分失败",
        body: `军需任务 ${w.supplyId} 的 AI 打分 2 小时都没成功（${String((failure as Error).message ?? failure)}），没打上分的组只按参与面结算。要补分请在"赛季监控与干预 → 军需"里给这些组改档。`,
        dedupeKey: `supply_ai_failed:${serverId}:${w.supplyId}`,
        roles: ["admin"],
      });
    for (const r of rows) await this.db.insert(supplyResults).values(r).onConflictDoNothing();
    await this.store.apply(serverId, { type: "settle_supply", supplyId: w.supplyId, at: now, results }, "system");
    for (const teamId of st.teamOrder) this.scored.delete(`${key}:${teamId}`);
    this.nextTry.delete(key);
    return true;
  }

}
