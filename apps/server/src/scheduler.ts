/**
 * Planned-event runner (PRD part 2 §4.2, part 3 §16).
 *
 * The worker picks up planned events whose time has passed and runs them, in
 * order, idempotently (the `key` is unique per server and the engine event
 * carries its own idempotency, so a second run changes nothing). Events that
 * need submissions (the D1 auction, D8 center round, …) collect them from the
 * database first. Pauses shift every later shiftable event by the paused time.
 */

import { and, asc, eq, lte } from "drizzle-orm";
import { plannedEvents, seasons, servers, type Db } from "@zhiyouji/db";
import type { AuctionBid, SeasonEvent } from "@zhiyouji/engine";
import type { Clock } from "./clock.js";
import type { SeasonStore } from "./seasonStore.js";

const STATUS_STEPS: Record<string, { from: string; to: string }> = {
  publish_groups: { from: "grouped", to: "running" },
  form_big_battle: { from: "running", to: "big_battle" },
};

export interface RunReport {
  ran: { key: string; engineEvent: string | null; ok: boolean; refusal?: string }[];
}

export type RowDoneListener = (serverId: string, kind: string, key: string) => Promise<void>;

export class Scheduler {
  private listeners: RowDoneListener[] = [];

  /** Called after a planned row is done (e.g. "publish_groups" → notify every player). */
  onRowDone(fn: RowDoneListener): void {
    this.listeners.push(fn);
  }

  private async rowDone(serverId: string, kind: string, key: string): Promise<void> {
    for (const fn of this.listeners) {
      try {
        await fn(serverId, kind, key);
      } catch (err) {
        console.error("planned-row listener failed", err);
      }
    }
  }

  constructor(
    private readonly db: Db,
    private readonly store: SeasonStore,
    private readonly clock: Clock,
  ) {}

  /** Run every due planned event of a server, oldest first. Safe to call repeatedly. */
  async runDue(serverId: string): Promise<RunReport> {
    const now = this.clock.now();
    const due = await this.db
      .select()
      .from(plannedEvents)
      .where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.status, "pending"), lte(plannedEvents.runAt, now)))
      .orderBy(asc(plannedEvents.runAt), asc(plannedEvents.key));
    const report: RunReport = { ran: [] };
    for (const row of due) {
      await this.advanceSeasonStatus(serverId, row.kind);
      const engineEvent = (row.params as { engineEvent: string | null }).engineEvent;
      if (!engineEvent) {
        await this.db.update(plannedEvents).set({ status: "done", doneAt: now }).where(eq(plannedEvents.id, row.id));
        report.ran.push({ key: row.key, engineEvent: null, ok: true });
        await this.rowDone(serverId, row.kind, row.key);
        continue;
      }
      if (engineEvent === "close_epic_auction") {
        report.ran.push(await this.closeEpicAuctions(serverId, row));
        continue;
      }
      const event = await this.buildEvent(serverId, engineEvent, row.params as Record<string, unknown>, +row.runAt);
      const res = await this.store.apply(serverId, event, "system");
      if (res.ok || res.refusal === "already_settled" || res.refusal === "already_done") {
        await this.db.update(plannedEvents).set({ status: "done", doneAt: now, attempts: row.attempts + 1 }).where(eq(plannedEvents.id, row.id));
        report.ran.push({ key: row.key, engineEvent, ok: true });
        await this.rowDone(serverId, row.kind, row.key);
      } else {
        await this.db.update(plannedEvents).set({ status: "failed", attempts: row.attempts + 1, error: res.refusal }).where(eq(plannedEvents.id, row.id));
        report.ran.push({ key: row.key, engineEvent, ok: false, refusal: res.refusal });
      }
    }
    return report;
  }

  /**
   * Epic auctions all start together but anti-sniping extends each on its own
   * (§13.3): close every auction that has ended; if some are still running,
   * keep the row pending and move it to the earliest remaining end.
   */
  private async closeEpicAuctions(serverId: string, row: typeof plannedEvents.$inferSelect): Promise<RunReport["ran"][number]> {
    const now = +this.clock.now();
    let state = await this.store.state(serverId);
    for (const a of state.shop.auctions.filter((x) => !x.closed && x.endAt <= now)) {
      const res = await this.store.apply(serverId, { type: "close_epic_auction", itemId: a.itemId, at: Math.max(a.endAt, Math.min(+row.runAt, now)) }, "system");
      if (!res.ok && res.refusal !== "already_done") {
        await this.db.update(plannedEvents).set({ status: "failed", attempts: row.attempts + 1, error: res.refusal }).where(eq(plannedEvents.id, row.id));
        return { key: row.key, engineEvent: "close_epic_auction", ok: false, refusal: res.refusal };
      }
    }
    state = await this.store.state(serverId);
    const open = state.shop.auctions.filter((x) => !x.closed);
    if (open.length > 0) {
      const next = Math.min(...open.map((x) => x.endAt));
      await this.db.update(plannedEvents).set({ runAt: new Date(next), attempts: row.attempts + 1 }).where(eq(plannedEvents.id, row.id));
      return { key: row.key, engineEvent: "close_epic_auction", ok: true };
    }
    await this.db.update(plannedEvents).set({ status: "done", doneAt: new Date(now), attempts: row.attempts + 1 }).where(eq(plannedEvents.id, row.id));
    await this.rowDone(serverId, row.kind, row.key);
    return { key: row.key, engineEvent: "close_epic_auction", ok: true };
  }

  /**
   * Season states that follow the calendar (part 3 §2): D0 evening → 进行中,
   * D29 forming the camps → 大团战. Only moves forward from the expected state.
   */
  private async advanceSeasonStatus(serverId: string, kind: string): Promise<void> {
    const step = STATUS_STEPS[kind];
    if (!step) return;
    const [row] = await this.db.select({ seasonId: servers.seasonId }).from(servers).where(eq(servers.id, serverId));
    if (!row) return;
    await this.db
      .update(seasons)
      .set({ status: step.to })
      .where(and(eq(seasons.id, row.seasonId), eq(seasons.status, step.from)));
  }

  /** Turn a planned row into the engine event, pulling in submissions and scores the row needs. */
  private async buildEvent(serverId: string, engineEvent: string, params: Record<string, unknown>, runAt: number): Promise<SeasonEvent> {
    // The event happens at its planned time (a late worker does not move results into a later report).
    const at = Math.min(runAt, +this.clock.now());
    switch (engineEvent) {
      case "settle_day":
        return { type: "settle_day", day: params.day as number };
      case "assign_leaders":
        return { type: "assign_leaders", at };
      case "blind_auction": {
        const subs = await this.store.submissions(serverId, "blind_auction");
        const bids: AuctionBid[] = subs.map((s) => ({ teamId: s.teamId, bid: s.bid ?? 0, prefs: s.prefs as string[], submittedAt: +s.submittedAt }));
        return { type: "blind_auction", at, bids };
      }
      case "starter_items":
        return { type: "starter_items", at, prefs: await this.prefsByTeam(serverId, "starter_items") };
      case "center_round": {
        const subs = await this.store.submissions(serverId, "center_round");
        return { type: "center_round", at, requests: subs.map((s) => ({ teamId: s.teamId, prefs: s.prefs as string[] })) };
      }
      case "rare_round":
        return { type: "rare_round", at, prefs: await this.prefsByTeam(serverId, "rare_round") };
      case "open_epic_auctions":
        return { type: "open_epic_auctions", at };
      case "pair_war":
        return { type: "pair_war", week: params.week as number, at };
      case "form_big_battle":
        return { type: "form_big_battle", at };
      case "lock_lines":
        return { type: "lock_lines", at };
      case "participation_award":
        return { type: "participation_award", week: params.week as number, at };
      default:
        throw new Error(`no builder for planned engine event ${engineEvent}`);
    }
  }

  private async prefsByTeam(serverId: string, round: string): Promise<Record<string, string[]>> {
    const subs = await this.store.submissions(serverId, round);
    return Object.fromEntries(subs.map((s) => [s.teamId, s.prefs as string[]]));
  }

  /** Admin re-run of a failed event (idempotent): put it back in the queue and run what is due. */
  async rerun(serverId: string, key: string): Promise<RunReport> {
    await this.db
      .update(plannedEvents)
      .set({ status: "pending", error: null })
      .where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, key), eq(plannedEvents.status, "failed")));
    return this.runDue(serverId);
  }

  /** Push every later shiftable planned event back by `ms` (called on resume, §16). */
  async shiftAfter(serverId: string, from: Date, ms: number): Promise<void> {
    const rows = await this.db
      .select()
      .from(plannedEvents)
      .where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.status, "pending"), eq(plannedEvents.shiftable, true)));
    for (const r of rows) {
      if (+r.runAt >= +from) await this.db.update(plannedEvents).set({ runAt: new Date(+r.runAt + ms) }).where(eq(plannedEvents.id, r.id));
    }
  }
}
