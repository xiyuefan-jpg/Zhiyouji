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
import { files, lands, safetyQueue, scoringRounds, seasons, servers, settledScores, works, type Db } from "@zhiyouji/db";
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

  async showcase(serverId: string, f: { kind?: string; landId?: string; week?: number }) {
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
    return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), handledAt: r.handledAt?.toISOString() ?? null })) };
  }

  async handle(id: string, decision: "pass" | "remove", by: string) {
    const [q] = await this.db.select().from(safetyQueue).where(eq(safetyQueue.id, id));
    if (!q) fail(404, "not_found");
    await this.db.update(safetyQueue).set({ status: decision === "pass" ? "passed" : "removed", handledBy: by, handledAt: this.clock.now() }).where(eq(safetyQueue.id, id));
    if (q!.objectKind === "work") await this.db.update(works).set({ safety: decision === "pass" ? "pass" : "block" }).where(eq(works.id, q!.objectId));
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
