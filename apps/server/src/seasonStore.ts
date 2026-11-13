/**
 * Season store: the engine state of each server, kept in memory and backed
 * by the database (PRD part 2 §4.1–4.4).
 *
 * - Every accepted engine event is written to `season_events` in order, in
 *   the same transaction as its ledger entries and feed items; refused events
 *   change nothing and are not stored.
 * - The state is rebuilt from the latest snapshot plus the events after it.
 * - Events of one server are applied one at a time (first come, first served
 *   by the time the server received them).
 */

import { and, asc, desc, eq, gt } from "drizzle-orm";
import {
  allocationSubmissions,
  calendarDays,
  feed,
  grainLedger,
  lands,
  paramVersions,
  plannedEvents,
  pointsLedger,
  seasonEvents,
  seasonSnapshots,
  seasons,
  servers,
  teamMembers,
  teams,
  type Db,
} from "@zhiyouji/db";
import {
  DEFAULT_PARAMS,
  applyEvent,
  assertOpeningDate,
  createSeasonState,
  planSeason,
  standardLands,
  type DayKindOverrides,
  type Notice,
  type SeasonEvent,
  type SeasonParams,
  type SeasonState,
} from "@zhiyouji/engine";

export interface CreateSeasonInput {
  name: string;
  /** D0, a Sunday (Beijing date). */
  opening: string;
  seed: number;
  params?: SeasonParams;
  createdBy: string;
  serverName?: string;
  teams: { name: string; members: { childId: string; grade: number }[] }[];
  landNames?: Record<string, string>;
  /** Enabled prompt ids per land code (from the question bank). */
  prompts?: Record<string, string[]>;
  /** When the opening grain is credited (default: D0 evening is up to the caller; here the creation time). */
  at: Date;
}

export type ApplyResult =
  | { ok: true; seq: number; state: SeasonState; notices: Notice[] }
  | { ok: false; refusal: string; detail?: string };

const SNAPSHOT_EVERY = 50;

/** Called after an event was stored (notifications). Errors are logged, never fail the event. */
export type AppliedListener = (serverId: string, seq: number, notices: Notice[], state: SeasonState) => Promise<void>;

export class SeasonStore {
  private cache = new Map<string, { state: SeasonState; seq: number; paramVersion: number }>();
  private locks = new Map<string, Promise<unknown>>();
  private listeners: AppliedListener[] = [];

  constructor(private readonly db: Db) {}

  /** Admin calendar (school day / rest day overrides). */
  async calendar(): Promise<DayKindOverrides> {
    const rows = await this.db.select().from(calendarDays);
    return Object.fromEntries(rows.map((r) => [r.day, r.kind as "school" | "rest"]));
  }

  async createSeason(i: CreateSeasonInput): Promise<{ seasonId: string; serverId: string; teamIds: string[] }> {
    assertOpeningDate(i.opening);
    const params = i.params ?? DEFAULT_PARAMS;
    const calendar = await this.calendar();
    return this.db.transaction(async (tx) => {
      const [season] = await tx
        .insert(seasons)
        .values({ name: i.name, openingDate: i.opening, seed: i.seed, status: "grouped", groupingLockedAt: i.at })
        .returning();
      await tx.insert(paramVersions).values({ seasonId: season!.id, version: 1, params, createdBy: i.createdBy, note: "初始参数" });
      const r = await this.createServerIn(tx as unknown as Db, {
        seasonId: season!.id,
        name: i.serverName ?? "一服",
        opening: i.opening,
        seed: i.seed,
        params,
        paramVersion: 1,
        calendar,
        teams: i.teams,
        landNames: i.landNames,
        prompts: i.prompts,
        createdBy: i.createdBy,
        at: i.at,
      });
      return { seasonId: season!.id, ...r };
    });
  }

  /**
   * One server of a season (inside the caller's transaction): teams, members,
   * lands, the initial engine state (opening grain) and the planned events.
   */
  async createServerIn(
    tx: Db,
    i: {
      seasonId: string;
      name: string;
      opening: string;
      seed: number;
      params: SeasonParams;
      paramVersion: number;
      calendar: DayKindOverrides;
      teams: { name: string; members: { childId: string; grade: number }[] }[];
      landNames?: Record<string, string>;
      prompts?: Record<string, string[]>;
      createdBy: string;
      at: Date;
    },
  ): Promise<{ serverId: string; teamIds: string[] }> {
    const [server] = await tx.insert(servers).values({ seasonId: i.seasonId, name: i.name }).returning();
    const teamRows = await tx
      .insert(teams)
      .values(i.teams.map((t) => ({ serverId: server!.id, name: t.name })))
      .returning();
    const members = i.teams.flatMap((t, k) =>
      t.members.map((m) => ({ teamId: teamRows[k]!.id, childId: m.childId, grade: m.grade, enabledBy: i.createdBy, enabledAt: i.at })),
    );
    if (members.length) await tx.insert(teamMembers).values(members);
    const map = standardLands(i.teams.length);
    await tx.insert(lands).values(map.map((l) => ({ serverId: server!.id, code: l.id, kind: l.kind, name: i.landNames?.[l.id] ?? l.id })));
    const state = createSeasonState({
      seasonId: i.seasonId,
      seed: i.seed,
      opening: i.opening,
      params: i.params,
      calendar: i.calendar,
      teams: i.teams.map((t, k) => ({ id: teamRows[k]!.id, name: t.name, members: t.members })),
      lands: map,
      prompts: i.prompts,
      at: +i.at,
    });
    await tx.insert(seasonSnapshots).values({ serverId: server!.id, seq: 0, state });
    await this.writeLedger(tx, server!.id, state, 0, 0, i.paramVersion);
    const plan = planSeason(i.opening, i.params, i.calendar);
    await tx.insert(plannedEvents).values(
      plan.map((r) => ({
        serverId: server!.id,
        key: r.key,
        kind: r.kind,
        runAt: new Date(r.at),
        params: { ...r.data, engineEvent: r.engineEvent, day: r.day },
        shiftable: r.shiftable,
      })),
    );
    this.cache.set(server!.id, { state, seq: 0, paramVersion: i.paramVersion });
    return { serverId: server!.id, teamIds: teamRows.map((t) => t.id) };
  }

  /** Current state of a server (from memory, or rebuilt from the database). */
  async state(serverId: string): Promise<SeasonState> {
    return (await this.load(serverId)).state;
  }

  private async load(serverId: string) {
    const hit = this.cache.get(serverId);
    if (hit) return hit;
    const [snap] = await this.db
      .select()
      .from(seasonSnapshots)
      .where(eq(seasonSnapshots.serverId, serverId))
      .orderBy(desc(seasonSnapshots.seq))
      .limit(1);
    if (!snap) throw new Error(`no snapshot for server ${serverId}`);
    let state = snap.state as SeasonState;
    let seq = snap.seq;
    let paramVersion = 1;
    const rows = await this.db
      .select()
      .from(seasonEvents)
      .where(and(eq(seasonEvents.serverId, serverId), gt(seasonEvents.seq, snap.seq)))
      .orderBy(asc(seasonEvents.seq));
    for (const r of rows) {
      const res = applyEvent(state, r.payload as SeasonEvent);
      if (!res.ok) throw new Error(`event ${r.seq} (${r.type}) no longer applies: ${res.refusal}`);
      state = res.state;
      seq = r.seq;
      paramVersion = r.paramVersion;
    }
    const [last] = await this.db
      .select({ paramVersion: seasonEvents.paramVersion })
      .from(seasonEvents)
      .where(eq(seasonEvents.serverId, serverId))
      .orderBy(desc(seasonEvents.seq))
      .limit(1);
    if (last) paramVersion = last.paramVersion;
    const entry = { state, seq, paramVersion };
    this.cache.set(serverId, entry);
    return entry;
  }

  /** Forget the in-memory copy (tests: prove the database alone rebuilds the state). */
  evict(serverId: string): void {
    this.cache.delete(serverId);
  }

  onApplied(fn: AppliedListener): void {
    this.listeners.push(fn);
  }

  /** Apply one engine event for a server; serialised per server. Listeners run after it is stored. */
  async apply(serverId: string, event: SeasonEvent, actor: string): Promise<ApplyResult> {
    const r = await this.applyLocked(serverId, event, actor);
    if (r.ok && r.notices.length)
      for (const fn of this.listeners) {
        try {
          await fn(serverId, r.seq, r.notices, r.state);
        } catch (err) {
          console.error("season listener failed", err);
        }
      }
    return r;
  }

  private applyLocked(serverId: string, event: SeasonEvent, actor: string): Promise<ApplyResult> {
    return this.withLock(serverId, async () => {
      const cur = await this.load(serverId);
      const r = applyEvent(cur.state, event);
      if (!r.ok) return { ok: false, refusal: r.refusal, detail: r.detail };
      const seq = cur.seq + 1;
      // Ledger entries record the parameter version they were made under (part 4 §7).
      const pv = event.type === "set_params" ? event.version : cur.paramVersion;
      const prevLedger = cur.state.ledger.length;
      await this.db.transaction(async (tx) => {
        await tx.insert(seasonEvents).values({ serverId, seq, type: event.type, payload: event, actor, paramVersion: pv });
        await this.writeLedger(tx as unknown as Db, serverId, r.state, prevLedger, seq, pv);
        if (r.notices.length)
          await tx.insert(feed).values(
            r.notices.map((n) => ({ serverId, eventSeq: seq, kind: n.kind, broadcast: n.broadcast, data: n.data, at: new Date(n.at) })),
          );
        if (seq % SNAPSHOT_EVERY === 0) await tx.insert(seasonSnapshots).values({ serverId, seq, state: r.state });
      });
      this.cache.set(serverId, { state: r.state, seq, paramVersion: pv });
      return { ok: true, seq, state: r.state, notices: r.notices };
    });
  }

  private async writeLedger(db: Db, serverId: string, state: SeasonState, from: number, eventSeq: number, paramVersion: number): Promise<void> {
    const fresh = state.ledger.slice(from);
    const row = (e: (typeof fresh)[number]) => ({
      entryId: e.id,
      serverId,
      teamId: e.teamId,
      amount: e.amount,
      source: e.source,
      refId: e.refId ?? null,
      note: e.note ?? null,
      at: new Date(e.at),
      reverses: e.reverses ?? null,
      paramVersion,
      eventSeq,
    });
    const grain = fresh.filter((e) => e.currency === "grain").map(row);
    const points = fresh.filter((e) => e.currency === "points").map(row);
    if (grain.length) await db.insert(grainLedger).values(grain);
    if (points.length) await db.insert(pointsLedger).values(points);
  }

  /** Latest allocation submissions for a round (one per team, latest wins). */
  async submissions(serverId: string, round: string) {
    return this.db
      .select()
      .from(allocationSubmissions)
      .where(and(eq(allocationSubmissions.serverId, serverId), eq(allocationSubmissions.round, round)));
  }

  /** Submit or replace a team's bid and preferences for a round (before its deadline; the caller checks the time). */
  async submitAllocation(i: { serverId: string; round: string; teamId: string; bid?: number | null; prefs: string[]; by: string; at: Date }) {
    await this.db
      .insert(allocationSubmissions)
      .values({ serverId: i.serverId, round: i.round, teamId: i.teamId, bid: i.bid ?? null, prefs: i.prefs, submittedBy: i.by, submittedAt: i.at })
      .onConflictDoUpdate({
        target: [allocationSubmissions.serverId, allocationSubmissions.round, allocationSubmissions.teamId],
        set: { bid: i.bid ?? null, prefs: i.prefs, submittedBy: i.by, submittedAt: i.at },
      });
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}
