/**
 * The season for a child (PRD part 5 D–F; part 3): who am I in the season,
 * the map, the ranking, my team, the ledger, and every team action. Actions
 * are engine events applied through the season store with the child as the
 * actor; the engine checks the rules (leader / deputy, grain, windows) and the
 * server checks what the engine cannot know (time windows of submission
 * rounds, who is asking).
 *
 * What other teams hold (items, frozen grain, submissions) is never shown to
 * children (part 7 §7: 孩子之间保密).
 */

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { children, lands as landRows, plannedEvents, roleTransfers, seasonPlayers, seasons, servers, teamMembers, teams, type Db } from "@zhiyouji/db";
import {
  ITEMS,
  REGULAR_COMMON_ITEMS,
  activeContestOnLand,
  baseOutput,
  campOf,
  effectActive,
  frozenGrain,
  grainOf,
  isItemEnabled,
  itemDef,
  landZeroed,
  pointsOf,
  quoteAttack,
  rankingAt,
  seasonDayOf,
  spendableGrain,
  type Role,
  type SeasonEvent,
  type SeasonState,
} from "@zhiyouji/engine";
import { GRADE_LABELS, SEASON_STATUS_LABELS, type SeasonStatus } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import { fail, HttpError } from "../http/errors.js";
import type { SeasonStore } from "../seasonStore.js";
import { refusalText } from "./refusals.js";

type SeasonRow = typeof seasons.$inferSelect;

/** A child placed in a confirmed season. */
export interface PlayCtx {
  childId: string;
  season: SeasonRow;
  serverId: string;
  serverName: string;
  teamId: string;
}

export type PlayLookup =
  | { kind: "none" }
  /** Enabled, but the groups are not published yet (before D0 evening). */
  | { kind: "waiting"; season: SeasonRow }
  | { kind: "playing"; ctx: PlayCtx };

/** Rounds where teams submit a bid and/or preferences before a deadline (part 4 §5.2). */
export const ROUNDS = {
  blind_auction: { open: "auction_open", deadline: "blind_auction" },
  starter_items: { open: "starter_items_open", deadline: "starter_items" },
  center_round: { open: "center_open", deadline: "center_round" },
  rare_round: { open: "shop_open", deadline: "rare_round" },
} as const;
export type RoundName = keyof typeof ROUNDS;

/** States in which children see the season (after the D0 evening publication). */
const VISIBLE: readonly SeasonStatus[] = ["running", "big_battle", "final_pending", "ended", "archived"];
/** States in which teams can act. */
const ACTIVE: readonly SeasonStatus[] = ["running", "big_battle"];

export function refuse(code: string, detail?: string): never {
  throw new HttpError(409, code, { message: refusalText(code), ...(detail ? { detail } : {}) });
}

const shortId = (prefix: string) => `${prefix}${randomBytes(5).toString("hex")}`;

export class SeasonPlay {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  // ---- who am I ------------------------------------------------------------------------

  async lookup(childId: string): Promise<PlayLookup> {
    const [row] = await this.db
      .select({ season: seasons, serverId: servers.id, serverName: servers.name, teamId: teams.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .innerJoin(servers, eq(teams.serverId, servers.id))
      .innerJoin(seasons, eq(servers.seasonId, seasons.id))
      .where(eq(teamMembers.childId, childId))
      .orderBy(desc(seasons.createdAt))
      .limit(1);
    if (row && VISIBLE.includes(row.season.status as SeasonStatus))
      return { kind: "playing", ctx: { childId, season: row.season, serverId: row.serverId, serverName: row.serverName, teamId: row.teamId } };
    if (row) return { kind: "waiting", season: row.season };
    const [enrolled] = await this.db
      .select({ season: seasons })
      .from(seasonPlayers)
      .innerJoin(seasons, eq(seasonPlayers.seasonId, seasons.id))
      .where(and(eq(seasonPlayers.childId, childId), eq(seasonPlayers.status, "enrolled")))
      .orderBy(desc(seasons.createdAt))
      .limit(1);
    if (enrolled && !["ended", "archived"].includes(enrolled.season.status)) return { kind: "waiting", season: enrolled.season };
    return { kind: "none" };
  }

  /** The child's season, or 404 `no_season`. */
  async ctx(childId: string): Promise<PlayCtx> {
    const l = await this.lookup(childId);
    if (l.kind !== "playing") fail(404, "no_season");
    return (l as { ctx: PlayCtx }).ctx;
  }

  private async state(ctx: PlayCtx): Promise<SeasonState> {
    return this.store.state(ctx.serverId);
  }

  private async nicknames(ids: string[]): Promise<Map<string, { nickname: string; avatar: string; lastActiveAt: Date | null; createdAt: Date }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.select().from(children).where(inArray(children.id, ids));
    return new Map(rows.map((r) => [r.id, { nickname: r.nickname, avatar: r.avatar, lastActiveAt: r.lastActiveAt, createdAt: r.createdAt }]));
  }

  private async landNames(serverId: string): Promise<Map<string, string>> {
    const rows = await this.db.select().from(landRows).where(eq(landRows.serverId, serverId));
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  private roleOf(s: SeasonState, teamId: string, childId: string): Role | "member" {
    const t = s.teams[teamId]!;
    return t.leader === childId ? "leader" : t.deputy === childId ? "deputy" : "member";
  }

  async me(childId: string) {
    const l = await this.lookup(childId);
    if (l.kind === "none") return { status: "none" as const };
    const seasonView = (s: SeasonRow) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      statusLabel: SEASON_STATUS_LABELS[s.status as SeasonStatus] ?? s.status,
      opening: s.openingDate,
    });
    if (l.kind === "waiting") return { status: "waiting" as const, season: seasonView(l.season) };
    const { ctx } = l;
    const s = await this.state(ctx);
    const t = s.teams[ctx.teamId]!;
    const names = await this.nicknames(t.members.map((m) => m.childId));
    const role = this.roleOf(s, ctx.teamId, childId);
    const me = t.members.find((m) => m.childId === childId);
    const [qr] = await this.db.select({ qrImage: teams.qrImage }).from(teams).where(eq(teams.id, ctx.teamId));
    return {
      status: "playing" as const,
      season: { ...seasonView(ctx.season), day: seasonDayOf(s.opening, this.now()), paused: s.paused },
      server: { id: ctx.serverId, name: ctx.serverName },
      team: { id: t.id, name: t.name, wechatQr: qr?.qrImage ?? null },
      role,
      active: me?.active ?? false,
      canAct: (role === "leader" || role === "deputy") && !!me?.active && ACTIVE.includes(ctx.season.status as SeasonStatus),
      members: t.members.map((m) => ({
        childId: m.childId,
        nickname: names.get(m.childId)?.nickname ?? "",
        avatar: names.get(m.childId)?.avatar ?? "a1",
        gradeLabel: GRADE_LABELS[m.grade] ?? String(m.grade),
        role: this.roleOf(s, ctx.teamId, m.childId),
        active: m.active,
        me: m.childId === childId,
      })),
    };
  }

  // ---- map and ranking (D1, F3) ---------------------------------------------------------------

  async map(ctx: PlayCtx) {
    const s = await this.state(ctx);
    const now = this.now();
    const names = await this.landNames(ctx.serverId);
    const teamName = (id: string | null) => (id ? { id, name: s.teams[id]?.name ?? "" } : null);
    return {
      lands: s.landOrder.map((id) => {
        const l = s.lands[id]!;
        const c = activeContestOnLand(s, id);
        const effects = s.effects
          .filter((e) => "landId" in e && e.landId === id && effectActive(e as { from: number; until?: number }, now) && !("endedAt" in e && e.endedAt !== undefined && e.endedAt <= now))
          .map((e) => ({ kind: e.kind, until: "until" in e ? (e.until as number) : null }));
        return {
          id,
          name: names.get(id) ?? id,
          kind: l.kind,
          output: baseOutput(l.kind, s.params),
          zeroed: landZeroed(s, id, now),
          owner: teamName(l.owner),
          ownedSince: l.ownedSince,
          mine: l.owner === ctx.teamId,
          contest: c
            ? { id: c.id, defender: teamName(c.defender), attackers: c.attackers.map((a) => teamName(a.teamId)), joinDeadline: c.joinDeadline, deadline: c.deadline }
            : null,
          effects,
        };
      }),
      teams: s.teamOrder.map((id) => ({ id, name: s.teams[id]!.name, mine: id === ctx.teamId })),
    };
  }

  async ranking(ctx: PlayCtx) {
    const s = await this.state(ctx);
    const r = rankingAt(s, this.now());
    return {
      ranking: r.map((x) => ({
        rank: x.rank,
        teamId: x.teamId,
        name: s.teams[x.teamId]!.name,
        points: x.points,
        warWins: x.warWins,
        lands: s.landOrder.filter((l) => s.lands[l]!.owner === x.teamId).length,
        mine: x.teamId === ctx.teamId,
      })),
    };
  }

  // ---- my team (E1, E5, E6) ----------------------------------------------------------------------

  async team(ctx: PlayCtx) {
    const s = await this.state(ctx);
    const now = this.now();
    const t = s.teams[ctx.teamId]!;
    const rank = rankingAt(s, now).find((r) => r.teamId === ctx.teamId)?.rank ?? null;
    return {
      id: t.id,
      name: t.name,
      rank,
      points: pointsOf(s, t.id),
      grain: grainOf(s, t.id),
      frozenGrain: frozenGrain(s, t.id),
      spendableGrain: spendableGrain(s, t.id),
      lands: s.landOrder.filter((l) => s.lands[l]!.owner === t.id),
      items: t.items.map((i) => {
        const d = itemDef(i.itemId);
        return { uid: i.uid, itemId: i.itemId, name: d.name, tier: d.tier, passive: d.passive, bigBattle: d.bigBattle, negative: d.negative, source: i.source, acquiredAt: i.acquiredAt };
      }),
      effects: s.effects
        .filter((e) => ("teamId" in e && e.teamId === t.id) || ("victim" in e && (e.victim === t.id || e.beneficiary === t.id)))
        .filter((e) => !("until" in e) || (e.until as number) > now)
        .map((e) => ({ ...e })),
      contests: s.contestOrder
        .map((id) => s.contests[id]!)
        .filter((c) => c.defender === t.id || c.attackers.some((a) => a.teamId === t.id))
        .map((c) => ({
          id: c.id,
          landId: c.landId,
          role: c.defender === t.id ? "defender" : "attacker",
          status: c.status,
          deadline: c.deadline,
          joinDeadline: c.joinDeadline,
          promptId: c.promptId,
          outcome: c.outcome ?? null,
        })),
      warWins: t.warWins,
    };
  }

  async ledger(ctx: PlayCtx, currency: "grain" | "points") {
    const s = await this.state(ctx);
    return {
      currency,
      balance: currency === "grain" ? grainOf(s, ctx.teamId) : pointsOf(s, ctx.teamId),
      entries: s.ledger
        .filter((e) => e.teamId === ctx.teamId && e.currency === currency)
        .map((e) => ({ id: e.id, amount: e.amount, source: e.source, refId: e.refId ?? null, note: e.note ?? null, at: e.at, reverses: e.reverses ?? null }))
        .reverse(),
    };
  }

  /** Item catalogue (E5 法宝图鉴): every item enabled this season. */
  async catalogue(ctx: PlayCtx) {
    const s = await this.state(ctx);
    return {
      items: ITEMS.filter((i) => isItemEnabled(i.id, s.params)).map((i) => ({
        id: i.id,
        name: i.name,
        tier: i.tier,
        passive: i.passive,
        negative: i.negative,
        bigBattle: i.bigBattle,
      })),
    };
  }

  // ---- acting -------------------------------------------------------------------------------------

  private async active(ctx: PlayCtx): Promise<SeasonState> {
    if (!ACTIVE.includes(ctx.season.status as SeasonStatus)) fail(409, "season_not_active");
    const s = await this.state(ctx);
    const me = s.teams[ctx.teamId]!.members.find((m) => m.childId === ctx.childId);
    if (!me?.active) fail(403, "withdrawn");
    return s;
  }

  private async leaderOnly(ctx: PlayCtx): Promise<SeasonState> {
    const s = await this.active(ctx);
    if (this.roleOf(s, ctx.teamId, ctx.childId) === "member") refuse("not_leader");
    return s;
  }

  /** Apply an engine event as this child; refusals become 409 with a Chinese message. */
  async act(ctx: PlayCtx, event: SeasonEvent) {
    const r = await this.store.apply(ctx.serverId, event, `child:${ctx.childId}`);
    if (!r.ok) refuse(r.refusal, r.detail);
    return r as Extract<typeof r, { ok: true }>;
  }

  // roles (E3)

  async claimRole(ctx: PlayCtx, role: Role) {
    await this.active(ctx);
    await this.act(ctx, { type: "claim_role", teamId: ctx.teamId, role, childId: ctx.childId, at: this.now() });
    return this.me(ctx.childId);
  }

  /** Start a hand-over; it takes effect when the receiver accepts. */
  async offerRole(ctx: PlayCtx, role: Role, to: string) {
    const s = await this.active(ctx);
    const t = s.teams[ctx.teamId]!;
    if ((role === "leader" ? t.leader : t.deputy) !== ctx.childId) refuse("not_holder");
    if (to === ctx.childId) refuse("same_person");
    if (!t.members.some((m) => m.childId === to && m.active)) refuse("not_member");
    await this.db
      .update(roleTransfers)
      .set({ status: "cancelled", decidedAt: this.clock.now() })
      .where(and(eq(roleTransfers.teamId, ctx.teamId), eq(roleTransfers.role, role), eq(roleTransfers.status, "pending")));
    const [row] = await this.db
      .insert(roleTransfers)
      .values({ serverId: ctx.serverId, teamId: ctx.teamId, role, fromChild: ctx.childId, toChild: to, createdAt: this.clock.now() })
      .returning();
    return { transfer: { id: row!.id, role, to, status: "pending" } };
  }

  async pendingTransfers(ctx: PlayCtx) {
    const rows = await this.db
      .select()
      .from(roleTransfers)
      .where(and(eq(roleTransfers.teamId, ctx.teamId), eq(roleTransfers.status, "pending")))
      .orderBy(asc(roleTransfers.createdAt));
    return rows.map((r) => ({ id: r.id, role: r.role, from: r.fromChild, to: r.toChild, createdAt: r.createdAt.toISOString(), forMe: r.toChild === ctx.childId }));
  }

  /** The receiver accepts or declines. */
  async answerTransfer(ctx: PlayCtx, id: string, accept: boolean) {
    await this.active(ctx);
    const [row] = await this.db
      .select()
      .from(roleTransfers)
      .where(and(eq(roleTransfers.id, id), eq(roleTransfers.teamId, ctx.teamId), eq(roleTransfers.status, "pending")));
    if (!row || row.toChild !== ctx.childId) fail(404, "not_found");
    const now = this.clock.now();
    if (!accept) {
      await this.db.update(roleTransfers).set({ status: "declined", decidedAt: now }).where(eq(roleTransfers.id, id));
      return this.me(ctx.childId);
    }
    const r = await this.store.apply(
      ctx.serverId,
      { type: "transfer_role", teamId: ctx.teamId, role: row!.role as Role, from: row!.fromChild, to: ctx.childId, at: +now },
      `child:${ctx.childId}`,
    );
    await this.db.update(roleTransfers).set({ status: r.ok ? "accepted" : "failed", decidedAt: now }).where(eq(roleTransfers.id, id));
    if (!r.ok) refuse(r.refusal, r.detail);
    return this.me(ctx.childId);
  }

  /** Deputy takes over after the leader has been away `leaderInactiveDays` (part 3 §5). */
  async takeOver(ctx: PlayCtx) {
    const s = await this.active(ctx);
    const leader = s.teams[ctx.teamId]!.leader;
    const info = leader ? (await this.nicknames([leader])).get(leader) : undefined;
    const last = info ? +(info.lastActiveAt ?? info.createdAt) : 0;
    await this.act(ctx, { type: "take_over_leader", teamId: ctx.teamId, deputyId: ctx.childId, leaderLastLoginAt: last, at: this.now() });
    return this.me(ctx.childId);
  }

  // contests (D3)

  /** Cost preview for attacking a land (or joining its contest). */
  async quote(ctx: PlayCtx, landId: string) {
    const s = await this.state(ctx);
    const l = s.lands[landId];
    if (!l) refuse("unknown_land");
    const c = activeContestOnLand(s, landId);
    const defender = c?.defender ?? l!.owner;
    if (!defender) refuse("unowned_land");
    const q = quoteAttack(s, ctx.teamId, defender!, this.now());
    return { landId, contestId: c?.id ?? null, defender, ...q, grain: spendableGrain(s, ctx.teamId) };
  }

  async startContest(ctx: PlayCtx, landId: string) {
    await this.leaderOnly(ctx);
    const contestId = shortId("K");
    const r = await this.act(ctx, { type: "start_contest", contestId, teamId: ctx.teamId, landId, at: this.now(), by: ctx.childId });
    const c = r.state.contests[contestId]!;
    return { contest: { id: c.id, landId: c.landId, promptId: c.promptId, joinDeadline: c.joinDeadline, deadline: c.deadline, paid: c.attackers[0]!.paid } };
  }

  async joinContest(ctx: PlayCtx, contestId: string) {
    await this.leaderOnly(ctx);
    const r = await this.act(ctx, { type: "join_contest", contestId, teamId: ctx.teamId, at: this.now(), by: ctx.childId });
    const c = r.state.contests[contestId]!;
    return { contest: { id: c.id, landId: c.landId, promptId: c.promptId, deadline: c.deadline, paid: c.attackers.find((a) => a.teamId === ctx.teamId)!.paid } };
  }

  async contest(ctx: PlayCtx, contestId: string) {
    const s = await this.state(ctx);
    const c = s.contests[contestId];
    if (!c) refuse("unknown_contest");
    const name = (id: string) => s.teams[id]?.name ?? "";
    const involved = c!.defender === ctx.teamId || c!.attackers.some((a) => a.teamId === ctx.teamId);
    return {
      id: c!.id,
      landId: c!.landId,
      status: c!.status,
      // The prompt is drawn at start and shown to everyone (the broadcast names it); fine for the map.
      promptId: c!.promptId,
      defender: { id: c!.defender, name: name(c!.defender) },
      attackers: c!.attackers.map((a) => ({ id: a.teamId, name: name(a.teamId), order: a.order, joinedAt: a.joinedAt, ...(a.teamId === ctx.teamId ? { paid: a.paid } : {}) })),
      startedAt: c!.startedAt,
      joinDeadline: c!.joinDeadline,
      deadline: c!.deadline,
      involved,
      outcome: c!.outcome ?? null,
      settledAt: c!.settledAt ?? null,
    };
  }

  // items (E5)

  async useItem(
    ctx: PlayCtx,
    b: { itemId: string; uid?: string; targetTeamId?: string; landId?: string; contestId?: string; week?: number; line?: number },
  ) {
    const s = await this.leaderOnly(ctx);
    const def = ITEMS.find((i) => i.id === b.itemId);
    if (!def) refuse("unknown_item");
    const at = this.now();
    if (def!.bigBattle) {
      await this.act(ctx, { type: "use_battle_item", teamId: ctx.teamId, itemId: b.itemId as "zhencha", at, by: ctx.childId, uid: b.uid, line: b.line } as SeasonEvent);
    } else {
      await this.act(ctx, {
        type: "use_item",
        teamId: ctx.teamId,
        itemId: b.itemId,
        at,
        by: ctx.childId,
        uid: b.uid,
        targetTeamId: b.targetTeamId,
        landId: b.landId,
        contestId: b.contestId,
        week: b.week,
      } as SeasonEvent);
    }
    void s;
    return this.team(ctx);
  }

  // center land after D8 (D2), shop (E10), epic auctions (E11)

  async buyCenterLand(ctx: PlayCtx, landId: string) {
    await this.leaderOnly(ctx);
    await this.act(ctx, { type: "buy_center_land", teamId: ctx.teamId, landId, at: this.now(), by: ctx.childId });
    return this.team(ctx);
  }

  async buyShopItem(ctx: PlayCtx, itemId: string) {
    await this.leaderOnly(ctx);
    await this.act(ctx, { type: "buy_shop_item", teamId: ctx.teamId, itemId, at: this.now(), by: ctx.childId });
    return this.team(ctx);
  }

  async bidEpic(ctx: PlayCtx, itemId: string, amount: number) {
    await this.leaderOnly(ctx);
    await this.act(ctx, { type: "bid_epic", teamId: ctx.teamId, itemId, amount, at: this.now(), by: ctx.childId });
    return this.shop(ctx);
  }

  async shop(ctx: PlayCtx) {
    const s = await this.state(ctx);
    const name = (id: string | null) => (id ? (s.teams[id]?.name ?? "") : null);
    return {
      bought: s.shop.bought[ctx.teamId] ?? [],
      rareStock: s.shop.rareStock,
      spendableGrain: spendableGrain(s, ctx.teamId),
      frozenGrain: frozenGrain(s, ctx.teamId),
      auctions: s.shop.auctions.map((a) => {
        const lead = a.bids.length ? a.bids[a.bids.length - 1]! : null;
        return {
          itemId: a.itemId,
          name: itemDef(a.itemId).name,
          startAt: a.startAt,
          endAt: a.endAt,
          closed: a.closed,
          leader: lead ? { teamId: lead.teamId, name: name(lead.teamId), amount: lead.amount, mine: lead.teamId === ctx.teamId } : null,
          winner: a.winner ? { teamId: a.winner, name: name(a.winner) } : null,
          bids: a.bids.map((x) => ({ team: name(x.teamId), amount: x.amount, at: x.at, mine: x.teamId === ctx.teamId })),
        };
      }),
    };
  }

  // submission rounds (D4, E10: blind auction, starter items, D8 center lands, rare items)

  /** The round's window from the planned events (moves with pauses and admin edits). */
  async roundWindow(serverId: string, round: RoundName): Promise<{ opensAt: Date | null; deadline: Date | null; open: boolean; closed: boolean }> {
    const keys = [ROUNDS[round].open, ROUNDS[round].deadline];
    const rows = await this.db
      .select()
      .from(plannedEvents)
      .where(and(eq(plannedEvents.serverId, serverId), inArray(plannedEvents.key, keys)));
    const open = rows.find((r) => r.key === ROUNDS[round].open);
    const dl = rows.find((r) => r.key === ROUNDS[round].deadline);
    const now = this.now();
    const closed = !dl || dl.status !== "pending" || +dl.runAt <= now;
    return { opensAt: open?.runAt ?? null, deadline: dl?.runAt ?? null, open: !!open && +open.runAt <= now && !closed, closed };
  }

  async submitRound(ctx: PlayCtx, round: RoundName, b: { bid?: number; prefs: string[] }) {
    const s = await this.leaderOnly(ctx);
    const w = await this.roundWindow(ctx.serverId, round);
    if (w.closed) refuse("too_late");
    if (!w.open) refuse("too_early");
    const prefs = [...new Set(b.prefs)];
    if (round === "blind_auction" || round === "center_round") {
      const kind = round === "blind_auction" ? "edge" : "center";
      if (prefs.some((l) => s.lands[l]?.kind !== kind)) fail(400, "bad_prefs");
    } else {
      const allowed = (i: string) =>
        round === "starter_items" ? (REGULAR_COMMON_ITEMS as readonly string[]).includes(i) : ITEMS.some((d) => d.id === i && d.tier === "rare");
      if (prefs.some((i) => !allowed(i) || !isItemEnabled(i, s.params))) fail(400, "bad_prefs");
    }
    let bid: number | null = null;
    if (round === "blind_auction") {
      bid = b.bid ?? 0;
      if (!Number.isInteger(bid) || bid < 0) fail(400, "bad_request");
      if (bid > grainOf(s, ctx.teamId)) refuse("not_enough_grain");
    }
    await this.store.submitAllocation({ serverId: ctx.serverId, round, teamId: ctx.teamId, bid, prefs, by: ctx.childId, at: this.clock.now() });
    return this.roundView(ctx, round);
  }

  /** Own submission and the window; after processing, the results come from the report. */
  async roundView(ctx: PlayCtx, round: RoundName) {
    const w = await this.roundWindow(ctx.serverId, round);
    const subs = await this.store.submissions(ctx.serverId, round);
    const mine = subs.find((x) => x.teamId === ctx.teamId);
    return {
      round,
      opensAt: w.opensAt?.toISOString() ?? null,
      deadline: w.deadline?.toISOString() ?? null,
      open: w.open,
      closed: w.closed,
      submission: mine ? { bid: mine.bid, prefs: mine.prefs as string[], by: mine.submittedBy, at: mine.submittedAt.toISOString() } : null,
    };
  }

  // big battle (E12)

  async bigBattle(ctx: PlayCtx) {
    const s = await this.state(ctx);
    const bb = s.bigBattle;
    if (!bb) return { formed: false as const };
    const camp = campOf(bb, ctx.teamId);
    const name = (id: string) => s.teams[id]?.name ?? "";
    const now = this.now();
    const published = bb.lockedAt !== null && bb.final !== null && now >= (bb.lockedAt ?? 0);
    return {
      formed: true as const,
      myCamp: camp,
      camps: { a: bb.camps.a.map((id) => ({ id, name: name(id) })), b: bb.camps.b.map((id) => ({ id, name: name(id) })) },
      lineValues: bb.lineValues,
      // Own camp's latest board; the other camp's lines only once both are locked and published.
      myLines: camp ? (bb.submitted[camp] ? { lines: bb.submitted[camp]!.lines, by: bb.submitted[camp]!.by, at: bb.submitted[camp]!.at } : null) : null,
      final: published ? bb.final : null,
      settled: bb.settled,
    };
  }

  async submitLines(ctx: PlayCtx, lines: string[]) {
    await this.leaderOnly(ctx);
    await this.act(ctx, { type: "submit_lines", teamId: ctx.teamId, lines, at: this.now(), by: ctx.childId });
    return this.bigBattle(ctx);
  }

  // weekly wars (E8): pairing and results

  async wars(ctx: PlayCtx) {
    const s = await this.state(ctx);
    const name = (id: string | null) => (id ? (s.teams[id]?.name ?? "") : null);
    return {
      weeks: Object.values(s.wars)
        .sort((a, b) => a.week - b.week)
        .map((w) => {
          const pair = w.pairs.find((p) => p.includes(ctx.teamId));
          const opponent = pair ? (pair[0] === ctx.teamId ? pair[1] : pair[0]) : null;
          const mine = w.results?.find((r) => r.teamId === ctx.teamId);
          return {
            week: w.week,
            pairedAt: w.pairedAt,
            opponent: opponent ? { id: opponent, name: name(opponent) } : null,
            bye: w.bye === ctx.teamId,
            settled: w.settled,
            result: mine ? { outcome: mine.outcome, points: mine.points, chestItem: mine.chestItem } : null,
          };
        }),
    };
  }
}
