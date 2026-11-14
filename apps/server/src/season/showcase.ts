/**
 * 观战 and 作品展 (PRD part 1 §2 免费用户; part 5 F5; part 6 §7; part 7 §8):
 * - when a contest, a weekly war or the big battle settles, its works go
 *   through content safety; passed works are shown in the showcase to every
 *   logged-in child, free users included (team name, land or week, score — no
 *   member names); the rest go to the safety queue;
 * - watching: the read-only map, ranking and broadcasts of any live server
 *   (no items held, no team details);
 * - the safety queue: admins pass or remove; reviewers can look and "转给管理员".
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { childSummaries, files, knowledgeCards, lands, safetyQueue, scoringRounds, seasons, servers, settledScores, works, type Db } from "@zhiyouji/db";
import { GRADE_LABELS } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { ContentSafety } from "../providers.js";
import type { SeasonStore } from "../seasonStore.js";
import type { ObjectStorage } from "../storage.js";
import { LIVE_SEASON_STATES } from "../worker.js";
import type { PlayCtx, SeasonPlay } from "./play.js";
import type { Reports } from "./reports.js";

const WATCHABLE = [...LIVE_SEASON_STATES, "ended"];

export class Showcase {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly safety: ContentSafety,
    private readonly notifier: Notifier,
    private readonly storage: ObjectStorage,
    private readonly play: SeasonPlay,
    private readonly reports: Reports,
  ) {}

  // ---- content safety after settlement ----------------------------------------------------------

  /** Worker: works of settled rounds that were not checked yet. */
  async runDue(serverId: string): Promise<number> {
    const rounds = await this.db.select().from(scoringRounds).where(and(eq(scoringRounds.serverId, serverId), eq(scoringRounds.status, "settled")));
    if (rounds.length === 0) return 0;
    const slots = rounds.flatMap((r) => (r.key === "battle" ? ["line", "main:a", "main:b"] : r.key.startsWith("contest:") ? [r.key, `${r.key}:open`] : [r.key]));
    const pending = await this.db
      .select()
      .from(works)
      .where(and(eq(works.serverId, serverId), eq(works.safety, "pending"), inArray(works.slot, slots)));
    for (const w of pending) {
      const ids = (w.fileIds as string[]) ?? [];
      const fs = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
      const r = await this.safety.check({ texts: [w.text, w.aiNote].filter((x): x is string => !!x), files: fs.map((f) => ({ key: f.storageKey, kind: f.kind })) });
      await this.db.update(works).set({ safety: r.pass ? "pass" : "block" }).where(eq(works.id, w.id));
      if (!r.pass) {
        await this.db.insert(safetyQueue).values({ objectKind: "work", objectId: w.id, labels: r.labels, createdAt: this.clock.now() }).onConflictDoNothing();
        await this.notifier.notifyAdmins({
          kind: "safety_block",
          title: "内容安全不通过",
          body: "一件作品没有通过内容安全检查，没有公开，请在内容安全队列里处理。",
          link: `/safety`,
          dedupeKey: `safety:${w.id}`,
          roles: ["admin"],
        });
      }
    }
    return pending.length;
  }

  // ---- 作品展 (F5) ----------------------------------------------------------------------------------

  async showcase(serverId: string, f: { kind?: string; landId?: string; week?: number; teamId?: string }) {
    await this.watchable(serverId);
    const st = await this.store.state(serverId);
    const rows = await this.db
      .select()
      .from(works)
      .where(and(eq(works.serverId, serverId), eq(works.safety, "pass")))
      .orderBy(desc(works.submittedAt));
    // Only each team's counting (last) version.
    const last = new Map<string, (typeof rows)[number]>();
    for (const r of [...rows].reverse()) last.set(`${r.slot}|${r.teamId}`, r);
    let list = [...last.values()];
    if (f.kind) list = list.filter((w) => w.kind === f.kind);
    if (f.landId) list = list.filter((w) => w.slot.startsWith("contest:") && st.contests[w.slot.split(":")[1]!]?.landId === f.landId);
    if (f.week) list = list.filter((w) => w.slot === `war:${f.week}`);
    if (f.teamId) list = list.filter((w) => w.teamId === f.teamId);
    const landNames = new Map((await this.db.select().from(lands).where(eq(lands.serverId, serverId))).map((l) => [l.code, l.name]));
    const scores = list.length ? await this.db.select().from(settledScores).where(inArray(settledScores.workId, list.map((w) => w.id))).orderBy(asc(settledScores.decidedAt)) : [];
    const score = new Map(scores.map((s) => [s.workId, s.score]));
    return {
      works: list
        .sort((a, b) => +b.submittedAt - +a.submittedAt)
        .map((w) => {
          const contest = w.slot.startsWith("contest:") ? st.contests[w.slot.split(":")[1]!] : undefined;
          return {
            id: w.id,
            kind: w.kind,
            slot: w.slot,
            team: st.teams[w.teamId]?.name ?? "",
            land: contest ? (landNames.get(contest.landId) ?? contest.landId) : null,
            week: w.slot.startsWith("war:") ? Number(w.slot.slice(4)) : null,
            mediaKind: w.mediaKind,
            score: score.get(w.id) ?? null,
            submittedAt: w.submittedAt.toISOString(),
          };
        }),
    };
  }

  async work(serverId: string, workId: string) {
    const [w] = await this.db.select().from(works).where(and(eq(works.id, workId), eq(works.serverId, serverId), eq(works.safety, "pass")));
    if (!w) fail(404, "not_found");
    const st = await this.store.state(serverId);
    const ids = (w!.fileIds as string[]) ?? [];
    const fs = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
    const now = +this.clock.now();
    return {
      id: w!.id,
      team: st.teams[w!.teamId]?.name ?? "",
      kind: w!.kind,
      mediaKind: w!.mediaKind,
      text: w!.text,
      aiNote: w!.aiNote,
      files: await Promise.all(fs.filter((f) => f.status !== "deleted").map(async (f) => ({ id: f.id, kind: f.kind, url: await this.storage.downloadUrl(f.storageKey, now) }))),
    };
  }

  // ---- 观战 -------------------------------------------------------------------------------------------

  /**
   * 小组公开主页 (F4): what anyone watching may know about a team — grade
   * spread, lands, where its points came from, the weekly-war record and its
   * published works. No member names, no items.
   */
  async team(serverId: string, teamId: string) {
    await this.watchable(serverId);
    const st = await this.store.state(serverId);
    const t = st.teams[teamId];
    if (!t) fail(404, "not_found");
    const landNames = new Map((await this.db.select().from(lands).where(eq(lands.serverId, serverId))).map((l) => [l.code, l.name]));
    const grades = new Map<number, number>();
    for (const m of t!.members.filter((x) => x.active)) grades.set(m.grade, (grades.get(m.grade) ?? 0) + 1);
    const bySource = new Map<string, number>();
    for (const e of st.ledger) if (e.teamId === teamId && e.currency === "points") bySource.set(e.source, (bySource.get(e.source) ?? 0) + e.amount);
    const ranking = (await this.play.ranking(await this.watcher(serverId))).ranking;
    const r = ranking.find((x) => x.teamId === teamId);
    return {
      id: teamId,
      name: t!.name,
      rank: r?.rank ?? null,
      points: r?.points ?? 0,
      lands: st.landOrder.filter((l) => st.lands[l]!.owner === teamId).map((l) => ({ id: l, name: landNames.get(l) ?? l })),
      grades: [...grades.entries()].sort((a, b) => a[0] - b[0]).map(([g, n]) => ({ grade: g, gradeLabel: GRADE_LABELS[g] ?? String(g), count: n })),
      pointsBySource: [...bySource.entries()].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).map(([source, amount]) => ({ source, amount })),
      wars: Object.values(st.wars)
        .sort((a, b) => a.week - b.week)
        .flatMap((w) => {
          const res = w.results?.find((x) => x.teamId === teamId);
          if (!res) return [];
          const pair = w.pairs.find((p) => p.includes(teamId));
          const opp = pair ? (pair[0] === teamId ? pair[1] : pair[0]) : null;
          return [{ week: w.week, opponent: opp ? (st.teams[opp]?.name ?? "") : null, outcome: res.outcome, points: res.points }];
        }),
      works: (await this.showcase(serverId, { teamId })).works,
    };
  }

  async servers() {
    const rows = await this.db
      .select({ id: servers.id, name: servers.name, season: seasons.name, status: seasons.status })
      .from(servers)
      .innerJoin(seasons, eq(servers.seasonId, seasons.id))
      .where(inArray(seasons.status, ["running", "big_battle", "final_pending", "ended"]));
    return { servers: rows };
  }

  private async watchable(serverId: string) {
    const [r] = await this.db.select({ status: seasons.status, name: servers.name, season: seasons }).from(servers).innerJoin(seasons, eq(servers.seasonId, seasons.id)).where(eq(servers.id, serverId));
    if (!r || !WATCHABLE.includes(r.status) || r.status === "grouped") fail(404, "not_found");
    return r!;
  }

  /** A context with no team: every "mine" flag is false and team-only lines are left out. */
  private async watcher(serverId: string): Promise<PlayCtx> {
    const r = await this.watchable(serverId);
    return { childId: "", season: r.season, serverId, serverName: r.name, teamId: "" };
  }

  async map(serverId: string) {
    return this.play.map(await this.watcher(serverId));
  }

  async ranking(serverId: string) {
    return this.play.ranking(await this.watcher(serverId));
  }

  async broadcasts(serverId: string) {
    return this.reports.broadcasts(await this.watcher(serverId));
  }

  // ---- 内容安全队列 (part 7 §8) -------------------------------------------------------------------------

  async queue() {
    const rows = await this.db.select().from(safetyQueue).orderBy(desc(safetyQueue.createdAt)).limit(200);
    // what was held back, so the admin can decide without opening anything else (part 7 §8)
    const cardIds = rows.filter((r) => r.objectKind === "card").map((r) => r.objectId);
    const cards = cardIds.length ? await this.db.select().from(knowledgeCards).where(inArray(knowledgeCards.id, cardIds)) : [];
    const summaryIds = rows.filter((r) => r.objectKind === "summary").map((r) => r.objectId);
    const summaries = summaryIds.length ? await this.db.select().from(childSummaries).where(inArray(childSummaries.id, summaryIds)) : [];
    const preview = (r: (typeof rows)[number]): string | null => {
      if (r.objectKind === "summary") {
        const c = summaries.find((x) => x.id === r.objectId)?.content as { heldText?: string } | undefined;
        return c?.heldText ? `周小结 / 月报告：${c.heldText}` : null;
      }
      if (r.objectKind === "card") {
        const c = cards.find((x) => x.id === r.objectId);
        return c ? `知识卡片「${c.title}」：${c.summary}` : null;
      }
      return null;
    };
    return {
      items: rows.map((r) => ({
        ...r,
        preview: preview(r),
        link: r.objectKind === "work" ? `/reviews/works/${r.objectId}` : null,
        createdAt: r.createdAt.toISOString(),
        handledAt: r.handledAt?.toISOString() ?? null,
      })),
    };
  }

  async handle(id: string, decision: "pass" | "remove", by: string) {
    const [q] = await this.db.select().from(safetyQueue).where(eq(safetyQueue.id, id));
    if (!q) fail(404, "not_found");
    await this.db.update(safetyQueue).set({ status: decision === "pass" ? "passed" : "removed", handledBy: by, handledAt: this.clock.now() }).where(eq(safetyQueue.id, id));
    if (q!.objectKind === "work") await this.db.update(works).set({ safety: decision === "pass" ? "pass" : "block" }).where(eq(works.id, q!.objectId));
    // a knowledge card held back by the check appears in the journal once passed (part 6 §7)
    if (q!.objectKind === "card") await this.db.update(knowledgeCards).set({ visible: decision === "pass" }).where(eq(knowledgeCards.id, q!.objectId));
    // a summary whose AI text was held back: passing it puts the text in (the numbers stay either way)
    if (q!.objectKind === "summary" && decision === "pass") {
      const [row] = await this.db.select().from(childSummaries).where(eq(childSummaries.id, q!.objectId));
      const c = row?.content as { text: string; heldText?: string } | undefined;
      if (row && c?.heldText) await this.db.update(childSummaries).set({ content: { ...c, text: c.heldText, heldText: undefined } }).where(eq(childSummaries.id, row.id));
    }
    return { ok: true };
  }

  /**
   * 举报 (PRD part 8 §2.5): any logged-in child can report a published work;
   * it goes (back) into the safety queue with the reason and the admins hear
   * once per work. The work stays up until an admin decides.
   */
  async report(serverId: string, workId: string, childId: string, reason: string) {
    const [w] = await this.db.select().from(works).where(and(eq(works.id, workId), eq(works.serverId, serverId), eq(works.safety, "pass")));
    if (!w) fail(404, "not_found");
    const note = `孩子举报：${reason}`;
    await this.db
      .insert(safetyQueue)
      .values({ objectKind: "work", objectId: workId, labels: ["举报"], status: "pending", forwardNote: note, forwardedBy: `child:${childId}`, createdAt: this.clock.now() })
      .onConflictDoUpdate({ target: [safetyQueue.objectKind, safetyQueue.objectId], set: { status: "pending", forwardNote: note, forwardedBy: `child:${childId}`, handledAt: null, handledBy: null } });
    await this.notifier.notifyAdmins({ kind: "work_reported", title: "有作品被举报了", body: note, link: "/safety", dedupeKey: `work_reported:${workId}`, roles: ["admin"] });
    return { ok: true };
  }

  /** A reviewer hands an item to the admins with one sentence. */
  async forward(id: string, note: string, by: string) {
    const [q] = await this.db.update(safetyQueue).set({ forwardNote: note, forwardedBy: by }).where(eq(safetyQueue.id, id)).returning();
    if (!q) fail(404, "not_found");
    await this.notifier.notifyAdmins({ kind: "safety_forward", title: "复核员转来一条内容安全问题", body: note, link: `/safety`, dedupeKey: `safety_forward:${id}:${+this.clock.now()}`, roles: ["admin"] });
    return { ok: true };
  }
}
