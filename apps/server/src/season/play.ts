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

import { battlePrompts, contestTask, landInfo } from "./taskInfo.js";
import { rubricFor, rubricWithGuide, workRequirements } from "./rubrics.js";
import { itemGuide } from "./itemGuide.js";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { children, feed, landTemplates, lands as landRows, plannedEvents, prompts as promptRows, roleTransfers, seasonPlayers, seasons, servers, teamMembers, teams, type Db } from "@zhiyouji/db";
import {
  ITEMS,
  REGULAR_COMMON_ITEMS,
  openingStockPerKind,
  activeContestOnLand,
  baseOutput,
  campOf,
  effectActive,
  frozenGrain,
  grainOf,
  isItemEnabled,
  itemDef,
  taixuCopyTarget,
  shopOpensAt,
  linesDeadline,
  linesPublishedAt,
  battleDeadline,
  shopClosesAt,
  rareRoundAt,
  epicAuctionsStartAt,
  shopPrice,
  minimumBid,
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
import type { Notifier } from "../notify/notifier.js";
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
    private readonly notifier?: Notifier,
  ) {}

  /**
   * 异常提醒 (PRD part 8 §3.4): the child who starts or joins an attack has a
   * brother or sister on another side of the same contest — tell the admins
   * (nothing is blocked; siblings are placed apart, so this can happen).
   */
  private async siblingAlert(ctx: PlayCtx, st: SeasonState, contestId: string): Promise<void> {
    const c = st.contests[contestId];
    if (!c || !this.notifier) return;
    const others = [c.defender, ...c.attackers.map((a) => a.teamId)].filter((t) => t !== ctx.teamId);
    const otherKids = others.flatMap((t) => st.teams[t]!.members.filter((m) => m.active).map((m) => ({ teamId: t, childId: m.childId })));
    if (otherKids.length === 0) return;
    const [me] = await this.db.select({ familyId: children.familyId }).from(children).where(eq(children.id, ctx.childId));
    if (!me) return;
    const sibs = await this.db
      .select({ id: children.id, nickname: children.nickname })
      .from(children)
      .where(and(eq(children.familyId, me.familyId), inArray(children.id, otherKids.map((k) => k.childId))));
    if (sibs.length === 0) return;
    const team = (id: string) => st.teams[id]?.name ?? "";
    const where = sibs.map((x) => `${x.nickname}（${team(otherKids.find((k) => k.childId === x.id)!.teamId)}）`).join("、");
    await this.notifier.notifyAdmins({
      kind: "sibling_contest",
      title: "同一家庭的孩子在同一场争夺的两边",
      body: `${team(ctx.teamId)}发起或加入了一场争夺，同一家庭的孩子在对面：${where}。请留意是否有串通。`,
      link: `/servers/${ctx.serverId}`,
      dedupeKey: `sibling_contest:${contestId}:${ctx.childId}`,
      roles: ["admin"],
    });
  }

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

  /** Each land's subject and question type (one query for the whole map). */
  async landSubjects(serverId: string): Promise<Map<string, { subject: string | null; questionType: string | null }>> {
    const rows = await this.db
      .select({ code: landRows.code, subject: landTemplates.subject, questionType: landTemplates.questionType })
      .from(landRows)
      .leftJoin(landTemplates, sql`${landTemplates.id}::text = ${landRows.templateId}`)
      .where(eq(landRows.serverId, serverId));
    return new Map(rows.map((r) => [r.code, { subject: r.subject ?? null, questionType: r.questionType ?? null }]));
  }

  async landNames(serverId: string): Promise<Map<string, string>> {
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
      season: {
        ...seasonView(ctx.season),
        day: seasonDayOf(s.opening, this.now()),
        paused: s.paused,
        // Season days of the shop and the big battle (the website shows those entries only then).
        days: { shopOpen: s.params.time.shopOpenDay, shopClose: s.params.time.shopCloseDay, bigBattle: s.params.time.bigBattleStartDay, end: s.params.time.seasonDays },
      },
      server: { id: ctx.serverId, name: ctx.serverName },
      team: { id: t.id, name: t.name, hasWechatQr: !!qr?.qrImage },
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
    const subjects = await this.landSubjects(ctx.serverId);
    const teamName = (id: string | null) => (id ? { id, name: s.teams[id]?.name ?? "" } : null);
    return {
      lands: s.landOrder.map((id) => {
        const l = s.lands[id]!;
        const c = activeContestOnLand(s, id);
        const effects = s.effects
          .filter((e) => "landId" in e && e.landId === id && effectActive(e as { from: number; until?: number }, now) && !("endedAt" in e && e.endedAt !== undefined && e.endedAt <= now))
          .map((e) => ({ kind: e.kind, name: ITEMS.find((i) => i.id === e.kind)?.name ?? e.kind, until: "until" in e ? (e.until as number) : null }));
        return {
          id,
          name: names.get(id) ?? id,
          subject: subjects.get(id)?.subject ?? null,
          questionType: subjects.get(id)?.questionType ?? null,
          kind: l.kind,
          output: baseOutput(l.kind, s.params),
          zeroed: landZeroed(s, id, now),
          owner: teamName(l.owner),
          ownedSince: l.ownedSince,
          mine: l.owner === ctx.teamId,
          contest: c
            ? {
                id: c.id,
                defender: teamName(c.defender),
                attackers: c.attackers.map((a) => teamName(a.teamId)),
                joinDeadline: c.joinDeadline,
                deadline: c.deadline,
                /** My team is already attacking this land (no "加入进攻" for it). */
                involved: c.defender === ctx.teamId || c.attackers.some((a) => a.teamId === ctx.teamId),
              }
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
        ...itemGuide(i.id, s.params),
      })),
      punchDownFactor: s.params.items.punchDownFactor,
      // 太虚幻镜 would copy this right now (its target is then that item's target).
      taixuCopies: taixuCopyTarget([...s.usedItems].reverse().map((u) => u.itemId)),
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
    await this.siblingAlert(ctx, r.state, contestId);
    return { contest: { id: c.id, landId: c.landId, promptId: c.promptId, joinDeadline: c.joinDeadline, deadline: c.deadline, paid: c.attackers[0]!.paid } };
  }

  async joinContest(ctx: PlayCtx, contestId: string) {
    await this.leaderOnly(ctx);
    const r = await this.act(ctx, { type: "join_contest", contestId, teamId: ctx.teamId, at: this.now(), by: ctx.childId });
    const c = r.state.contests[contestId]!;
    await this.siblingAlert(ctx, r.state, contestId);
    return { contest: { id: c.id, landId: c.landId, promptId: c.promptId, deadline: c.deadline, paid: c.attackers.find((a) => a.teamId === ctx.teamId)!.paid } };
  }

  async contest(ctx: PlayCtx, contestId: string) {
    const s = await this.state(ctx);
    const c = s.contests[contestId];
    if (!c) refuse("unknown_contest");
    const name = (id: string) => s.teams[id]?.name ?? "";
    const involved = c!.defender === ctx.teamId || c!.attackers.some((a) => a.teamId === ctx.teamId);
    const [p] = /^[0-9a-f-]{36}$/i.test(c!.promptId) ? await this.db.select().from(promptRows).where(eq(promptRows.id, c!.promptId)) : [];
    const task = await contestTask(this.db, ctx.serverId, s, contestId);
    const rubricId = rubricFor("contest", task.landName);
    return {
      prompt: p ? { title: p.title, body: p.body, audience: p.audience, questionType: p.questionType } : null,
      /** The question, the audience, the land's subject and question type, what little teammates can do. */
      task,
      /** How the work is judged: dimensions with what they look at, and the 50 / 75 point lines. */
      rubric: rubricWithGuide(rubricId),
      requirements: workRequirements("contest", /辩论/.test(task.questionType ?? "") ? "opening" : null),
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
    await this.leaderOnly(ctx);
    const def = ITEMS.find((i) => i.id === b.itemId);
    if (!def) refuse("unknown_item");
    const at = this.now();
    const r = def!.bigBattle
      ? await this.act(ctx, { type: "use_battle_item", teamId: ctx.teamId, itemId: b.itemId as "zhencha", at, by: ctx.childId, uid: b.uid, line: b.line } as SeasonEvent)
      : await this.act(ctx, {
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
    // What happened to each target (§3.4 step 4: "被挡下了" / reflected), and what 太虚幻镜 copied.
    const name = (id: string) => r.state.teams[id]?.name ?? "";
    const used = r.notices.find((n) => n.kind === "item_used");
    const outcomes: { teamId: string; team: string; outcome: "hit" | "blocked" | "reflected" }[] = [];
    for (const n of r.notices.filter((x) => x.kind === "item_outcome")) {
      const d = n.data as { targetTeamId?: string; outcome?: string; results?: { teamId: string; outcome: string }[] };
      if (d.targetTeamId && d.outcome) outcomes.push({ teamId: d.targetTeamId, team: name(d.targetTeamId), outcome: d.outcome as "hit" });
      for (const x of d.results ?? []) outcomes.push({ teamId: x.teamId, team: name(x.teamId), outcome: x.outcome as "hit" });
    }
    const copied = (used?.data as { copied?: string | null } | undefined)?.copied ?? null;
    // 侦察令: who the other camp has put on our line right now (only this team learns it).
    const ud = (used?.data ?? {}) as { line?: number; opponent?: string | null };
    const scouted = b.itemId === "zhencha" && typeof ud.line === "number" ? { line: ud.line, opponent: ud.opponent ? { id: ud.opponent, name: name(ud.opponent) } : null } : null;
    return { ...(await this.team(ctx)), used: { itemId: b.itemId, copied: copied ? { id: copied, name: itemDef(copied).name } : null, outcomes, scouted } };
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
    const p = s.params;
    const now = this.now();
    const name = (id: string | null) => (id ? (s.teams[id]?.name ?? "") : null);
    const opensAt = shopOpensAt(s);
    const closesAt = shopClosesAt(s);
    const bought = s.shop.bought[ctx.teamId] ?? [];
    return {
      opensAt,
      closesAt,
      open: now >= opensAt && now <= closesAt,
      rareRoundAt: rareRoundAt(s),
      rareRoundDone: s.done.includes("rare_round"),
      epicStartAt: epicAuctionsStartAt(s),
      maxItems: p.items.shopMaxItems,
      maxEpic: p.items.shopMaxEpic,
      antiSnipeMinutes: p.items.antiSnipeMinutes,
      bought,
      rareStock: s.shop.rareStock,
      spendableGrain: spendableGrain(s, ctx.teamId),
      frozenGrain: frozenGrain(s, ctx.teamId),
      // Common items (unlimited, one per kind) and rare items (stock per kind) on sale (§13.2).
      goods: ITEMS.filter((i) => i.tier !== "epic" && !i.bigBattle && isItemEnabled(i.id, p)).map((i) => ({
        id: i.id,
        name: i.name,
        tier: i.tier,
        price: shopPrice(i.id, p),
        stock: i.tier === "rare" ? (s.shop.rareStock[i.id] ?? 0) : null,
        mine: bought.includes(i.id),
      })),
      auctions: s.shop.auctions.map((a) => {
        const lead = a.bids.length ? a.bids[a.bids.length - 1]! : null;
        return {
          itemId: a.itemId,
          name: itemDef(a.itemId).name,
          startAt: a.startAt,
          endAt: a.endAt,
          closed: a.closed,
          minBid: minimumBid(a, p),
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
    const s = await this.state(ctx);
    const p = s.params;
    const teams = s.teamOrder.length;
    // What each choice is: a land's subject and question type, an item's effect (the decision needs it).
    let options: { id: string; name: string; detail: string }[] = [];
    if (round === "blind_auction" || round === "center_round") {
      const kind = round === "blind_auction" ? "edge" : "center";
      for (const id of s.landOrder.filter((l) => s.lands[l]!.kind === kind)) {
        const li = await landInfo(this.db, ctx.serverId, id);
        options.push({ id, name: li.name ?? id, detail: [li.subject, li.questionType].filter(Boolean).join(" · ") });
      }
    } else {
      const ids = round === "starter_items" ? [...REGULAR_COMMON_ITEMS] : ITEMS.filter((i) => i.tier === "rare" && !i.bigBattle).map((i) => i.id);
      options = ids.map((id) => ({ id, name: ITEMS.find((i) => i.id === id)?.name ?? id, detail: itemGuide(id, p).effect }));
    }
    const rules: Record<RoundName, string> = {
      blind_auction: `每组都会分到一块边缘地，出价一定会从粮草里扣掉。出价高的组先挑地；反过来，出价低的组在开营法宝里先挑。出价一样时先提交的先挑；没提交的组出价算 0、顺序随机、最后分。`,
      starter_items: `每组免费拿 ${p.opening.freeItems} 件，同一种不能拿 2 件，每种只有 ${openingStockPerKind(teams, p)} 件。按盲拍顺位反过来挑：盲拍出价低的组先挑。没提交的组系统随机发。`,
      center_round: `按当前排名从后往前分：落后的组先买。每组买到偏好里还没卖出、排得最靠前的那块，付 ${p.centerLand.price} 粮草；粮草不够的跳过。`,
      rare_round: `按当前排名从后往前分：落后的组先拿，每件 ${p.items.rarePrice} 粮草，每种只有 ${p.items.rareStockPerKind} 件。`,
    };
    // After the blind auction: every team's bid and land, published to everyone (part 3 §8.6).
    let result: { team: string; land: string; paid: number; mine: boolean }[] | null = null;
    if (round === "blind_auction" && w.closed && s.done.includes("auction")) {
      const names = await this.landNames(ctx.serverId);
      const paid = new Map<string, { land: string; paid: number }>();
      for (const e of s.ledger) if (e.currency === "grain" && e.source === "auction_bid") paid.set(e.teamId, { land: e.note ?? "", paid: -e.amount });
      result = (s.auctionOrder ?? s.teamOrder).map((t) => ({
        team: s.teams[t]?.name ?? "",
        land: names.get(paid.get(t)?.land ?? "") ?? paid.get(t)?.land ?? "",
        paid: paid.get(t)?.paid ?? 0,
        mine: t === ctx.teamId,
      }));
    }
    return {
      round,
      opensAt: w.opensAt?.toISOString() ?? null,
      deadline: w.deadline?.toISOString() ?? null,
      open: w.open,
      closed: w.closed,
      submission: mine ? { bid: mine.bid, prefs: mine.prefs as string[], by: mine.submittedBy, at: mine.submittedAt.toISOString() } : null,
      options,
      rules: rules[round],
      result,
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
    const publishAt = linesPublishedAt(s);
    const published = bb.final !== null && now >= publishAt;
    const sub = camp ? bb.submitted[camp] : null;
    const by = sub?.by ? (await this.nicknames([sub.by])).get(sub.by)?.nickname ?? null : null;
    const bp = await battlePrompts(this.db);
    const p = s.params;
    const [res] = bb.settled
      ? await this.db
          .select()
          .from(feed)
          .where(and(eq(feed.serverId, ctx.serverId), eq(feed.kind, "big_battle_result")))
          .orderBy(desc(feed.at))
          .limit(1)
      : [];
    type Side = { teamId: string; outcome: string; linePoints: number; seized: number; compensation: boolean };
    const rd = res?.data as { lines: { line: number; value: number; a: Side; b: Side }[]; main: { winner: "a" | "b" | "tie"; scores: Record<"a" | "b", number | null> } } | undefined;
    return {
      formed: true as const,
      // What each line and the main battlefield ask (titles; the full task is in the workshop).
      lineTasks: bb.lineValues.map((_, i) => (bp.lines[i] ? { title: bp.lines[i]!.title, body: bp.lines[i]!.body } : null)),
      mainTask: bp.main ? { title: bp.main.title, body: bp.main.body } : null,
      stakes:
        `每个组派到一条战线，和对方阵营派到同一条线的组比作品分数。赢的组得这条线的分，再夺走输的组产出最高的一块地 ${p.bigBattle.seizeDays} 天的产出（输的组没有地时，改拿 ${p.bigBattle.seizeDays * p.bigBattle.noLandCompFactor} 分补偿）；同分时双方各得一半，不夺产出。` +
        `两边阵营都看不到对方怎么派，截止后同时公布。主战场由各组的使者一起做一份作品，分数高的阵营每组 +${p.bigBattle.mainWin}。`,
      mainWin: p.bigBattle.mainWin,
      result: rd
        ? {
            lines: rd.lines.map((l) => ({ line: l.line, value: l.value, sides: [l.a, l.b].map((x) => ({ teamId: x.teamId, name: name(x.teamId), outcome: x.outcome, points: x.linePoints + x.seized, mine: x.teamId === ctx.teamId })) })),
            main: rd.main.winner,
          }
        : null,
      myCamp: camp,
      camps: { a: bb.camps.a.map((id) => ({ id, name: name(id) })), b: bb.camps.b.map((id) => ({ id, name: name(id) })) },
      lineValues: bb.lineValues,
      linesDeadline: linesDeadline(s),
      publishAt,
      battleDeadline: battleDeadline(s),
      // Own camp's latest board; the other camp's lines only once both are locked and published.
      myLines: sub ? { lines: sub.lines, by: sub.by, byName: by, at: sub.at } : null,
      final: published ? bb.final : null,
      flags: bb.flags[ctx.teamId] ?? {},
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
