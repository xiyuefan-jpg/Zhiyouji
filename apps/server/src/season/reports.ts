/**
 * 战报 (PRD part 5 F1, F2; part 3 §1.1–1.2): three reports a day at the
 * publication times. A report holds every feed line between the previous
 * publication time and this one, seen through the team's eyes (feedView), plus
 * the ranking at that moment. Broadcasts (F2) are visible at once; the team
 * feed (E1) is the team's own lines.
 *
 * The worker calls `runDue` for every live server; it creates the reports
 * whose time has passed (idempotent: one per server and publication time) and
 * puts a message in every player's message center.
 */

import { and, asc, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { children, feed, lands, reports, type Db } from "@zhiyouji/db";
import { campOf, nextPublicationAfter, publicationTime, dateOfSeasonDay, rankingAt, type SeasonState } from "@zhiyouji/engine";
import { formatBeijing } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import { describe, viewFor, type FeedLine, type FeedNames } from "./feedView.js";
import type { PlayCtx } from "./play.js";

type FeedRow = typeof feed.$inferSelect;

export class Reports {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly notifier: Notifier,
  ) {}

  /** Create every report whose publication time has passed (from D0 evening on, until the season's last day + 2). */
  async runDue(serverId: string): Promise<number> {
    const st = await this.store.state(serverId);
    const now = +this.clock.now();
    const [last] = await this.db.select().from(reports).where(eq(reports.serverId, serverId)).orderBy(desc(reports.publishAt)).limit(1);
    const first = publicationTime(st.opening, "evening", st.params, st.calendar);
    const end = publicationTime(dateOfSeasonDay(st.opening, st.params.time.seasonDays + 2), "evening", st.params, st.calendar);
    let prev: number | null = last ? +last.publishAt : null;
    let made = 0;
    for (let guard = 0; guard < 200; guard++) {
      const at = prev === null ? first : nextPublicationAfter(prev, st.params, st.calendar);
      if (at > now || at > end) break;
      // The first report covers everything since the groups were confirmed.
      const from = prev ?? first - 7 * 24 * 3_600_000;
      const ranking = rankingAt(st, at).map((r) => ({ teamId: r.teamId, rank: r.rank, points: r.points }));
      const [row] = await this.db
        .insert(reports)
        .values({ serverId, fromAt: new Date(from), publishAt: new Date(at), ranking, createdAt: new Date(now) })
        .onConflictDoNothing()
        .returning();
      if (row) {
        made++;
        const lines = await this.rows(serverId, from, at);
        if (lines.length > 0) {
          const kids = st.teamOrder.flatMap((t) => st.teams[t]!.members.filter((m) => m.active).map((m) => m.childId));
          await this.notifier.notify({
            kind: "report",
            childIds: kids,
            serverId,
            title: `战报 · ${formatBeijing(at)}`,
            body: `这一期有 ${lines.length} 条新消息，点开看看。`,
            link: `/season/reports/${row.id}`,
            dedupeKey: `report:${serverId}:${at}`,
          });
        }
      }
      prev = at;
    }
    return made;
  }

  private async rows(serverId: string, from: number, to: number): Promise<FeedRow[]> {
    return this.db
      .select()
      .from(feed)
      .where(and(eq(feed.serverId, serverId), gt(feed.at, new Date(from)), lte(feed.at, new Date(to)), isNull(feed.hiddenAt)))
      .orderBy(asc(feed.at), asc(feed.eventSeq));
  }

  private async names(serverId: string, st: SeasonState): Promise<FeedNames> {
    const landRows = await this.db.select().from(lands).where(eq(lands.serverId, serverId));
    const land = new Map(landRows.map((l) => [l.code, l.name]));
    const kidIds = st.teamOrder.flatMap((t) => st.teams[t]!.members.map((m) => m.childId));
    const kids = kidIds.length ? await this.db.select({ id: children.id, nickname: children.nickname }).from(children).where(inArray(children.id, kidIds)) : [];
    const kid = new Map(kids.map((k) => [k.id, k.nickname]));
    return {
      team: (id) => (id ? (st.teams[id]?.name ?? "") : ""),
      land: (id) => (id ? (land.get(id) ?? id) : ""),
      child: (id) => (id ? (kid.get(id) ?? "一位组员") : ""),
    };
  }

  private campTeams(st: SeasonState, teamId: string): string[] {
    const bb = st.bigBattle;
    const camp = bb ? campOf(bb, teamId) : null;
    return bb && camp ? bb.camps[camp] : [];
  }

  private lines(rows: FeedRow[], st: SeasonState, teamId: string, names: FeedNames, scope?: "server" | "team"): FeedLine[] {
    const camp = this.campTeams(st, teamId);
    const out: FeedLine[] = [];
    for (const r of rows) {
      const v = viewFor({ kind: r.kind, data: r.data as Record<string, unknown>, broadcast: r.broadcast }, teamId, camp);
      if (!v || (scope && v.scope !== scope)) continue;
      out.push({ kind: r.kind, at: +r.at, scope: v.scope, text: describe(r.kind, v.data, names, teamId), data: v.data });
    }
    return out;
  }

  async list(ctx: PlayCtx, limit = 30) {
    const rows = await this.db
      .select()
      .from(reports)
      .where(and(eq(reports.serverId, ctx.serverId), lte(reports.publishAt, this.clock.now())))
      .orderBy(desc(reports.publishAt))
      .limit(limit);
    return { reports: rows.map((r) => ({ id: r.id, publishAt: r.publishAt.toISOString(), title: `战报 · ${formatBeijing(+r.publishAt)}` })) };
  }

  async get(ctx: PlayCtx, id: string) {
    const [r] = await this.db.select().from(reports).where(and(eq(reports.id, id), eq(reports.serverId, ctx.serverId)));
    if (!r) fail(404, "not_found");
    const st = await this.store.state(ctx.serverId);
    const names = await this.names(ctx.serverId, st);
    const rows = await this.rows(ctx.serverId, +r!.fromAt, +r!.publishAt);
    const ranking = (r!.ranking as { teamId: string; rank: number; points: number }[]).map((x) => ({ ...x, name: st.teams[x.teamId]?.name ?? "", mine: x.teamId === ctx.teamId }));
    return {
      id: r!.id,
      publishAt: r!.publishAt.toISOString(),
      title: `战报 · ${formatBeijing(+r!.publishAt)}`,
      lines: this.lines(rows, st, ctx.teamId, names),
      ranking,
    };
  }

  /** 全服广播 (F2): broadcasts, newest first, at once. */
  async broadcasts(ctx: PlayCtx, before?: Date, limit = 50) {
    const st = await this.store.state(ctx.serverId);
    const names = await this.names(ctx.serverId, st);
    const rows = await this.db
      .select()
      .from(feed)
      .where(and(eq(feed.serverId, ctx.serverId), eq(feed.broadcast, true), isNull(feed.hiddenAt), lte(feed.at, before ?? this.clock.now())))
      .orderBy(desc(feed.at), desc(feed.eventSeq))
      .limit(limit);
    return { lines: this.lines(rows, st, ctx.teamId, names, "server") };
  }

  /** 组内动态 (E1): the team's own lines (roles, tasks counted, items received…), newest first. */
  async teamFeed(ctx: PlayCtx, limit = 50) {
    const st = await this.store.state(ctx.serverId);
    const names = await this.names(ctx.serverId, st);
    const rows = await this.db
      .select()
      .from(feed)
      .where(and(eq(feed.serverId, ctx.serverId), isNull(feed.hiddenAt), lte(feed.at, this.clock.now())))
      .orderBy(desc(feed.at), desc(feed.eventSeq))
      .limit(500);
    return { lines: this.lines(rows, st, ctx.teamId, names, "team").slice(0, limit) };
  }
}
