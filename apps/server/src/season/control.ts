/**
 * Running a season from the admin console (PRD part 7 §2, §7, §9; part 3
 * §16): the live map with everything visible, parameters (every change a new
 * version), the calendar, planned events (move, re-run), pause / resume, and
 * the interventions — ledger adjustment and reversal, land owner, items,
 * cancelling a contest, roles, a child leaving — and the final settlement.
 *
 * Every action needs a reason where the PRD asks for one and is written to the
 * operation log.
 */

import { formatBeijing } from "@zhiyouji/shared";
import type { Notifier } from "../notify/notifier.js";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { calendarDays, children, debates, feed, lands as landRows, opLog, paramVersions, plannedEvents, seasonPlayers, seasons, servers, teamMembers, type Db } from "@zhiyouji/db";
import {
  activeContestOnLand,
  finalizeSeason,
  frozenGrain,
  grainOf,
  itemDef,
  pointsOf,
  rankingAt,
  seasonDayOf,
  paramsProblems,
  withParams,
  type DeepPartial,
  type Role,
  type SeasonEvent,
  type SeasonParams,
  type SeasonState,
} from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import { fail, HttpError } from "../http/errors.js";
import type { Scheduler } from "../scheduler.js";
import type { SeasonStore } from "../seasonStore.js";
import { refusalText } from "./refusals.js";
import { describe, type FeedNames } from "./feedView.js";
import type { SeasonAdmin } from "./seasons.js";

export type Intervention =
  | { action: "adjust_ledger"; teamId: string; currency: "grain" | "points"; amount: number; reason: string }
  | { action: "reverse_entry"; entryId: string; reason: string }
  | { action: "set_land_owner"; landId: string; teamId: string | null; reason: string }
  | { action: "give_item"; teamId: string; itemId: string; reason: string }
  | { action: "remove_item"; teamId: string; uid: string; reason: string }
  | { action: "cancel_contest"; contestId: string; refund: boolean; reason: string }
  | { action: "set_role"; teamId: string; role: Role; childId: string | null; reason: string }
  | { action: "withdraw"; childId: string; reason: string }
  | { action: "set_deadline"; target: string; deadline: Date; reason: string };

/** Flattened differences between two parameter sets: "dailyTask.grainPerTask": [3, 5]. */
export function paramsDiff(a: unknown, b: unknown, path = ""): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  const isObj = (x: unknown) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) Object.assign(out, paramsDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out[path] = [a ?? null, b ?? null];
  return out;
}

export class SeasonControl {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly scheduler: Scheduler,
    private readonly seasons: SeasonAdmin,
    private readonly notifier?: Notifier,
  ) {}

  private async log(actor: string, action: string, object: string, before: unknown, after: unknown, reason?: string | null): Promise<void> {
    await this.db.insert(opLog).values({ actor, action, object, before: before ?? null, after: after ?? null, reason: reason ?? null, at: this.clock.now() });
  }

  private async apply(serverId: string, event: SeasonEvent, by: string) {
    const r = await this.store.apply(serverId, event, by);
    if (!r.ok) throw new HttpError(409, r.refusal, { message: refusalText(r.refusal), ...(r.detail ? { detail: r.detail } : {}) });
    return r as Extract<typeof r, { ok: true }>;
  }

  private async server(serverId: string) {
    const [row] = await this.db.select().from(servers).where(eq(servers.id, serverId));
    if (!row) fail(404, "not_found");
    return row!;
  }

  // ---- live view (part 7 §7 实时地图; items visible to admins) -------------------------------

  async overview(serverId: string) {
    const server = await this.server(serverId);
    const season = await this.seasons.season(server.seasonId);
    const st = await this.store.state(serverId);
    const now = +this.clock.now();
    const ids = st.teamOrder.flatMap((t) => st.teams[t]!.members.map((m) => m.childId));
    const kids = ids.length ? await this.db.select({ id: children.id, nickname: children.nickname, grade: children.grade }).from(children).where(inArray(children.id, ids)) : [];
    const kid = new Map(kids.map((k) => [k.id, k]));
    const names = new Map((await this.db.select().from(landRows).where(eq(landRows.serverId, serverId))).map((l) => [l.code, l.name]));
    const ranking = rankingAt(st, now);
    return {
      season: { id: season.id, name: season.name, status: season.status, opening: season.openingDate },
      server: { id: server.id, name: server.name },
      day: seasonDayOf(st.opening, now),
      paused: st.paused,
      pauses: st.pauses,
      teams: st.teamOrder.map((id) => {
        const t = st.teams[id]!;
        return {
          id,
          name: t.name,
          rank: ranking.find((r) => r.teamId === id)?.rank ?? null,
          points: pointsOf(st, id),
          grain: grainOf(st, id),
          frozenGrain: frozenGrain(st, id),
          leader: t.leader,
          deputy: t.deputy,
          members: t.members.map((m) => ({ childId: m.childId, nickname: kid.get(m.childId)?.nickname ?? "", grade: m.grade, active: m.active })),
          items: t.items.map((i) => ({ uid: i.uid, itemId: i.itemId, name: itemDef(i.itemId).name, source: i.source, acquiredAt: i.acquiredAt })),
          lands: st.landOrder.filter((l) => st.lands[l]!.owner === id),
          warWins: t.warWins,
        };
      }),
      lands: st.landOrder.map((id) => {
        const l = st.lands[id]!;
        const c = activeContestOnLand(st, id);
        return { id, name: names.get(id) ?? id, kind: l.kind, owner: l.owner, ownedSince: l.ownedSince, contestId: c?.id ?? null };
      }),
      contests: st.contestOrder.map((id) => st.contests[id]!),
      // part 7 §7 法宝使用记录: who used what on whom, and when (passive ones that triggered too)
      itemUses: (await this.db.select().from(feed).where(and(eq(feed.serverId, serverId), eq(feed.kind, "item_used"))).orderBy(desc(feed.at))).map((r) => {
        const d = r.data as { teamId?: string; itemId?: string; targetTeamId?: string; landId?: string; contestId?: string; triggered?: boolean };
        return {
          at: +r.at,
          team: d.teamId ? (st.teams[d.teamId]?.name ?? "") : "",
          item: d.itemId ? itemDef(d.itemId).name : "",
          target: d.targetTeamId ? (st.teams[d.targetTeamId]?.name ?? "") : null,
          land: d.landId ? (names.get(d.landId) ?? d.landId) : null,
          broadcast: r.broadcast,
        };
      }),
      // part 7 §7 团队分来源: each team's points by source
      pointsBySource: Object.fromEntries(
        st.teamOrder.map((id) => {
          const by: Record<string, number> = {};
          for (const e of st.ledger) if (e.teamId === id && e.currency === "points") by[e.source] = (by[e.source] ?? 0) + e.amount;
          return [id, by];
        }),
      ),
      effects: st.effects,
      shop: st.shop,
      wars: st.wars,
      bigBattle: st.bigBattle,
      final: st.final,
    };
  }

  async ledger(serverId: string, f: { teamId?: string; currency?: "grain" | "points" }) {
    const st = await this.store.state(serverId);
    return {
      entries: st.ledger
        .filter((e) => (!f.teamId || e.teamId === f.teamId) && (!f.currency || e.currency === f.currency))
        .map((e) => ({ ...e, team: st.teams[e.teamId]?.name ?? "" }))
        .reverse(),
    };
  }

  // ---- parameters (part 7 §2; part 3 §2) ----------------------------------------------------------

  async paramVersions(seasonId: string) {
    await this.seasons.season(seasonId);
    const rows = await this.db.select().from(paramVersions).where(eq(paramVersions.seasonId, seasonId)).orderBy(desc(paramVersions.version));
    return {
      current: rows[0] ? { version: rows[0].version, params: rows[0].params } : null,
      versions: rows.map((r, i) => ({
        version: r.version,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        note: r.note,
        changes: rows[i + 1] ? paramsDiff(rows[i + 1]!.params, r.params) : {},
      })),
    };
  }

  /** Save a new parameter version; running servers get it for every later event. */
  async setParams(seasonId: string, patch: DeepPartial<SeasonParams>, note: string, by: string) {
    const season = await this.seasons.season(seasonId);
    if (["ended", "archived"].includes(season.status)) fail(409, "wrong_season_status", { status: season.status });
    const cur = await this.seasons.params(seasonId);
    const next = withParams(patch, cur.params);
    const problems = paramsProblems(next);
    if (problems.length) fail(400, "bad_params", { problems, message: problems.join("；") });
    const changes = paramsDiff(cur.params, next);
    if (Object.keys(changes).length === 0) return { version: cur.version, changes };
    const version = cur.version + 1;
    await this.db.insert(paramVersions).values({ seasonId, version, params: next, createdBy: by, note });
    await this.db.update(seasons).set({ currentParamVersion: version }).where(eq(seasons.id, seasonId));
    for (const sv of await this.seasons.servers(seasonId))
      await this.apply(sv.id, { type: "set_params", params: next, version, at: +this.clock.now(), by, reason: note }, by);
    await this.log(by, "params_set", `season:${seasonId}`, { version: cur.version }, { version, changes }, note);
    return { version, changes };
  }

  // ---- calendar (part 7 §2) ------------------------------------------------------------------------

  async calendar(from: string, to: string) {
    const rows = await this.db.select().from(calendarDays).where(and(gte(calendarDays.day, from), lte(calendarDays.day, to))).orderBy(asc(calendarDays.day));
    return { days: rows };
  }

  /**
   * Mark a day as school day or rest day (null removes the override). Only
   * affects servers created later and the publication times computed from now
   * on; planned events of running servers are moved by hand.
   */
  async setCalendarDay(day: string, kind: "school" | "rest" | null, note: string | null, by: string) {
    const [before] = await this.db.select().from(calendarDays).where(eq(calendarDays.day, day));
    if (kind === null) await this.db.delete(calendarDays).where(eq(calendarDays.day, day));
    else
      await this.db
        .insert(calendarDays)
        .values({ day, kind, source: "admin", note })
        .onConflictDoUpdate({ target: calendarDays.day, set: { kind, source: "admin", note } });
    await this.log(by, "calendar_set", `day:${day}`, before ? { kind: before.kind } : null, { kind });
    return { day, kind };
  }

  // ---- planned events (part 7 §2) --------------------------------------------------------------------

  async planned(serverId: string) {
    await this.server(serverId);
    const rows = await this.db.select().from(plannedEvents).where(eq(plannedEvents.serverId, serverId)).orderBy(asc(plannedEvents.runAt), asc(plannedEvents.key));
    return {
      events: rows.map((r) => ({
        key: r.key,
        kind: r.kind,
        runAt: r.runAt.toISOString(),
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        errorText: r.error ? refusalText(r.error) : null,
        doneAt: r.doneAt?.toISOString() ?? null,
        shiftable: r.shiftable,
        day: (r.params as { day?: number }).day ?? null,
      })),
    };
  }

  async reschedule(serverId: string, key: string, runAt: Date, reason: string, by: string) {
    const [row] = await this.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, key)));
    if (!row) fail(404, "not_found");
    if (row!.status !== "pending") fail(409, "not_pending");
    // the war and big-battle deadlines live in the season state; moving their rows moves them (§16)
    const target = row!.kind === "war_deadline" ? `war:${(row!.params as { week?: number }).week ?? key.split(":")[1]}` : row!.kind === "battle_deadline" ? "battle" : null;
    const st = target ? await this.store.state(serverId) : null;
    if (target && st && (target === "battle" ? st.bigBattle : st.wars[Number(target.slice(4))])) {
      const r = await this.apply(serverId, { type: "set_deadline", target, deadline: +runAt, at: +this.clock.now(), by, reason }, by);
      await this.afterDeadlineMoved(serverId, r.state, target, +runAt);
    }
    await this.db.update(plannedEvents).set({ runAt }).where(eq(plannedEvents.id, row!.id));
    await this.log(by, "planned_move", `server:${serverId}/planned:${key}`, { runAt: row!.runAt.toISOString() }, { runAt: runAt.toISOString() }, reason);
    return { key, runAt: runAt.toISOString() };
  }

  async rerun(serverId: string, key: string, by: string) {
    const [row] = await this.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, key)));
    if (!row) fail(404, "not_found");
    if (row!.status !== "failed") fail(409, "not_failed");
    const r = await this.scheduler.rerun(serverId, key);
    await this.log(by, "planned_rerun", `server:${serverId}/planned:${key}`, { status: "failed", error: row!.error }, r.ran.find((x) => x.key === key) ?? null);
    return r;
  }

  // ---- pause and resume (part 3 §16) --------------------------------------------------------------------

  async pause(serverId: string, reason: string, by: string) {
    await this.server(serverId);
    await this.apply(serverId, { type: "pause", at: +this.clock.now(), reason }, by);
    await this.log(by, "season_pause", `server:${serverId}`, null, null, reason);
    return { paused: true };
  }

  /** Resume: every later shiftable planned event moves back by the paused time. */
  async resume(serverId: string, by: string) {
    const st = await this.store.state(serverId);
    const open = st.pauses[st.pauses.length - 1];
    const at = +this.clock.now();
    await this.apply(serverId, { type: "resume", at }, by);
    if (open && open.until === null) {
      await this.scheduler.shiftAfter(serverId, new Date(open.from), at - open.from);
      // §18: the debate deadlines kept by the server move with the contest deadlines (the engine moves those)
      const d = at - open.from;
      const from = new Date(open.from);
      for (const x of await this.db.select().from(debates).where(eq(debates.serverId, serverId))) {
        const side = !x.defenderSide && +x.sideDeadline > +from ? new Date(+x.sideDeadline + d) : x.sideDeadline;
        const opening = !x.openingsSharedAt && +x.openingDeadline > +from ? new Date(+x.openingDeadline + d) : x.openingDeadline;
        if (side !== x.sideDeadline || opening !== x.openingDeadline) await this.db.update(debates).set({ sideDeadline: side, openingDeadline: opening }).where(eq(debates.id, x.id));
      }
    }
    await this.log(by, "season_resume", `server:${serverId}`, null, { pausedMs: open ? at - open.from : 0 });
    return { paused: false, pausedMs: open ? at - open.from : 0 };
  }

  // ---- interventions (part 7 §7; part 3 §16) ------------------------------------------------------------

  async intervene(serverId: string, i: Intervention, by: string) {
    await this.server(serverId);
    const at = +this.clock.now();
    if (!i.reason?.trim()) fail(400, "needs_reason");
    let event: SeasonEvent;
    switch (i.action) {
      case "adjust_ledger":
        event = { type: "adjust_ledger", teamId: i.teamId, currency: i.currency, amount: i.amount, at, by, reason: i.reason };
        break;
      case "reverse_entry":
        event = { type: "reverse_entry", entryId: i.entryId, at, by, reason: i.reason };
        break;
      case "set_land_owner":
        event = { type: "set_land_owner", landId: i.landId, teamId: i.teamId, at, by, reason: i.reason };
        break;
      case "give_item":
        event = { type: "give_item", teamId: i.teamId, itemId: i.itemId, at, by, reason: i.reason };
        break;
      case "remove_item":
        event = { type: "remove_item", teamId: i.teamId, uid: i.uid, at, by, reason: i.reason };
        break;
      case "cancel_contest":
        event = { type: "cancel_contest", contestId: i.contestId, refund: i.refund, at, reason: i.reason };
        break;
      case "set_role":
        event = { type: "admin_set_role", teamId: i.teamId, role: i.role, childId: i.childId, at, by, reason: i.reason };
        break;
      case "withdraw":
        event = { type: "member_leaves", childId: i.childId, at };
        break;
      case "set_deadline":
        event = { type: "set_deadline", target: i.target, deadline: +i.deadline, at, by, reason: i.reason };
        break;
    }
    const r = await this.apply(serverId, event!, by);
    if (i.action === "set_deadline") await this.afterDeadlineMoved(serverId, r.state, i.target, +i.deadline);
    if (i.action === "withdraw") {
      const server = await this.server(serverId);
      await this.db
        .update(seasonPlayers)
        .set({ status: "withdrawn" })
        .where(and(eq(seasonPlayers.seasonId, server.seasonId), eq(seasonPlayers.childId, i.childId)));
      const teamId = Object.values(r.state.teams).find((t) => t.members.some((m) => m.childId === i.childId))?.id;
      if (teamId) await this.db.update(teamMembers).set({ active: false }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.childId, i.childId)));
    }
    const { reason, action, ...detail } = i;
    await this.log(by, `intervene_${action}`, `server:${serverId}`, null, detail, reason);
    return { ok: true, seq: r.seq };
  }

  /**
   * A moved deadline: the planned row that shows it follows, and the children who have to hand
   * something in are told (part 8 §1.2 "截止时间变了").
   */
  private async afterDeadlineMoved(serverId: string, st: SeasonState, target: string, deadline: number): Promise<void> {
    const rowKey = target.startsWith("war:") ? `war_deadline:${target.slice(4)}` : target === "battle" ? "battle_deadline" : null;
    if (rowKey)
      await this.db
        .update(plannedEvents)
        .set({ runAt: new Date(deadline) })
        .where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, rowKey), eq(plannedEvents.status, "pending")));
    let teams: string[] = [];
    let what = "";
    if (target.startsWith("contest:")) {
      const c = st.contests[target.slice(8)];
      if (c) teams = [c.defender, ...c.attackers.map((a) => a.teamId)];
      what = "区域争夺的作品";
    } else if (target.startsWith("war:")) {
      teams = (st.wars[Number(target.slice(4))]?.pairs ?? []).flat();
      what = `第 ${target.slice(4)} 周周战争的作品`;
    } else {
      teams = st.bigBattle ? [...st.bigBattle.camps.a, ...st.bigBattle.camps.b] : [];
      what = "大团战的作品";
    }
    const childIds = teams.flatMap((t) => st.teams[t]?.members.filter((m) => m.active).map((m) => m.childId) ?? []);
    if (childIds.length)
      await this.notifier?.notify({
        kind: "system",
        childIds,
        serverId,
        title: "截止时间改了",
        body: `${what}截止时间改到 ${formatBeijing(deadline)}（北京时间）。`,
        link: target.startsWith("contest:") ? `/season/contests/${target.slice(8)}` : "/team/works",
        dedupeKey: `deadline_moved:${serverId}:${target}:${deadline}`,
      });
  }

  // ---- final settlement (part 3 §15; part 7 §9) --------------------------------------------------------

  /** Confirm the final settlement of one server with its scholarship pool; the season ends when every server is final. */
  async finalize(serverId: string, poolYuan: number, by: string) {
    const server = await this.server(serverId);
    const r = await this.apply(serverId, { type: "finalize", at: +this.clock.now(), poolYuan }, by);
    await this.log(by, "finalize", `server:${serverId}`, null, { poolYuan, ranking: r.state.final?.ranking }, null);
    const all = await this.seasons.servers(server.seasonId);
    let allFinal = true;
    for (const sv of all) if (!(await this.store.state(sv.id)).final) allFinal = false;
    if (allFinal) await this.db.update(seasons).set({ status: "ended" }).where(eq(seasons.id, server.seasonId));
    return { final: r.state.final, seasonEnded: allFinal };
  }

  /** §2 / §15 "已归档 自动（结束 30 天后）": ended seasons become read-only archives. Returns how many. */
  async archiveDue(): Promise<number> {
    const now = +this.clock.now();
    let n = 0;
    for (const season of await this.db.select().from(seasons).where(eq(seasons.status, "ended"))) {
      const all = await this.seasons.servers(season.id);
      let last = 0;
      let days = 0;
      for (const sv of all) {
        const st = await this.store.state(sv.id);
        if (!st.final) {
          last = Infinity;
          break;
        }
        last = Math.max(last, st.final.at);
        days = Math.max(days, st.params.final.archiveAfterDays);
      }
      if (all.length && last + days * 86_400_000 <= now) {
        await this.db.update(seasons).set({ status: "archived" }).where(and(eq(seasons.id, season.id), eq(seasons.status, "ended")));
        n++;
      }
    }
    return n;
  }

  /**
   * 终局结算预览 (part 7 §9): a dry run of the final settlement with the pool the
   * admin typed — each team's points by source, the grain conversion, the
   * ranking and the scholarship — so it can be checked before it is published.
   */
  async finalPreview(serverId: string, poolYuan: number) {
    await this.server(serverId);
    const st = await this.store.state(serverId);
    const r = st.final ? null : finalizeSeason(st, { at: +this.clock.now(), poolYuan });
    if (r && !r.ok) throw new HttpError(409, r.refusal, { message: refusalText(r.refusal) });
    const after = r?.ok ? r.state : st;
    const fin = after.final!;
    return {
      done: !!st.final,
      poolYuan: fin.poolYuan,
      teams: fin.ranking.map((x) => {
        const bySource: Record<string, number> = {};
        for (const e of after.ledger) if (e.teamId === x.teamId && e.currency === "points") bySource[e.source] = (bySource[e.source] ?? 0) + e.amount;
        return {
          teamId: x.teamId,
          name: after.teams[x.teamId]?.name ?? "",
          rank: x.rank,
          points: x.points,
          grain: grainOf(st, x.teamId),
          bySource,
          yuan: fin.scholarship.find((y) => y.teamId === x.teamId)?.yuan ?? 0,
        };
      }),
    };
  }

  /** 奖学金发放表 (part 7 §9): team, rank, points, yuan, members. */
  async scholarshipRows(serverId: string) {
    const st = await this.store.state(serverId);
    if (!st.final) fail(409, "not_final");
    const ids = st.teamOrder.flatMap((t) => st.teams[t]!.members.map((m) => m.childId));
    const kids = ids.length ? await this.db.select({ id: children.id, nickname: children.nickname }).from(children).where(inArray(children.id, ids)) : [];
    const kid = new Map(kids.map((k) => [k.id, k.nickname]));
    return st.final!.ranking.map((r) => ({
      team: st.teams[r.teamId]!.name,
      rank: r.rank,
      points: r.points,
      yuan: st.final!.scholarship.find((x) => x.teamId === r.teamId)?.yuan ?? 0,
      members: st.teams[r.teamId]!.members.filter((m) => m.active).map((m) => kid.get(m.childId) ?? m.childId),
    }));
  }

  // ---- feed and operation log ----------------------------------------------------------------------------

  /** Hide one line from the reports (part 7 §8 战报预览). */
  async hideFeed(feedId: string, reason: string, by: string) {
    const [row] = await this.db.update(feed).set({ hiddenAt: this.clock.now(), hiddenBy: by }).where(eq(feed.id, feedId)).returning();
    if (!row) fail(404, "not_found");
    await this.log(by, "feed_hide", `feed:${feedId}`, { kind: row!.kind }, null, reason);
    return { ok: true };
  }

  /** Lines for the next report of a server (preview), with their ids so one can be hidden. */
  async feedSince(serverId: string, since: Date) {
    const rows = await this.db.select().from(feed).where(and(eq(feed.serverId, serverId), gte(feed.at, since))).orderBy(asc(feed.at), asc(feed.eventSeq));
    // The text as the whole server would read it (no team's own view), for the preview.
    const st = await this.store.state(serverId);
    const land = new Map((await this.db.select().from(landRows).where(eq(landRows.serverId, serverId))).map((l) => [l.code, l.name]));
    const kidIds = st.teamOrder.flatMap((t) => st.teams[t]!.members.map((m) => m.childId));
    const kids = kidIds.length ? await this.db.select({ id: children.id, nickname: children.nickname }).from(children).where(inArray(children.id, kidIds)) : [];
    const kid = new Map(kids.map((k) => [k.id, k.nickname]));
    const names = {
      team: (id: string | null | undefined) => (id ? (st.teams[id]?.name ?? "") : ""),
      land: (id: string | null | undefined) => (id ? (land.get(id) ?? id) : ""),
      child: (id: string | null | undefined) => (id ? (kid.get(id) ?? "一位组员") : ""),
    };
    return {
      lines: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        broadcast: r.broadcast,
        at: r.at.toISOString(),
        data: r.data,
        text: describe(r.kind, r.data as Record<string, unknown>, names as FeedNames, ""),
        hidden: !!r.hiddenAt,
      })),
    };
  }

  async opLog(f: { actor?: string; action?: string; object?: string; from?: Date; to?: Date; limit?: number }) {
    const conds = [];
    if (f.actor) conds.push(eq(opLog.actor, f.actor));
    if (f.action) conds.push(eq(opLog.action, f.action));
    if (f.object) conds.push(sql`${opLog.object} like ${f.object + "%"}`);
    if (f.from) conds.push(gte(opLog.at, f.from));
    if (f.to) conds.push(lte(opLog.at, f.to));
    const rows = await this.db
      .select()
      .from(opLog)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(opLog.at))
      .limit(f.limit ?? 200);
    return { entries: rows.map((r) => ({ ...r, at: r.at.toISOString() })) };
  }
}
