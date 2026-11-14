/**
 * Weekly war themes and constraint cards (PRD part 3 §11; part 5 E8, §3.5):
 * - At the Thursday pairing, fixed weeks (W1, W3) give every team the week's
 *   fixed card; gift weeks (W2, W4) show each team 3 cards from the week's
 *   whitelist, and the leader or deputy picks one to send to the opponent.
 * - Friday morning the choices are revealed at the same time; teams that did
 *   not choose send a random one of their three.
 * - The choosing page shows "对手情报": the opponent's grade spread.
 */

import { and, eq } from "drizzle-orm";
import { plannedEvents, warCards, type Db } from "@zhiyouji/db";
import { ITEMS, REGULAR_COMMON_ITEMS, createRng, seedFromString, warDeadline, type SeasonState } from "@zhiyouji/engine";
import { rubricWithGuide, workRequirements } from "./rubrics.js";
import { GRADE_LABELS, WAR_CARDS, WAR_THEMES } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import { refuse, type PlayCtx } from "./play.js";

const OFFERED = 3;

const cardText = (id: string | null) => {
  if (!id) return null;
  if (id.startsWith("fixed:")) {
    const w = Number(id.slice(6));
    return { id, kind: "固定", text: WAR_THEMES[w]?.fixedCard ?? "" };
  }
  const c = WAR_CARDS.find((x) => x.id === id);
  return c ? { id: c.id, kind: c.kind, text: c.text } : { id, kind: "", text: id };
};

export class WarWords {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly notifier: Notifier,
  ) {}

  private isGift(st: SeasonState, week: number): boolean {
    return st.params.war.giftWeeks.includes(week);
  }

  private rng(st: SeasonState, week: number, teamId: string) {
    return createRng(seedFromString(`${st.seed}|war-cards|${week}|${teamId}`));
  }

  /** After the pairing: cards for every paired team. Idempotent. */
  async onPaired(serverId: string, week: number): Promise<void> {
    const st = await this.store.state(serverId);
    const w = st.wars[week];
    if (!w) return;
    const now = this.clock.now();
    const gift = this.isGift(st, week);
    const whitelist = WAR_CARDS.filter((c) => c.weeks.includes(week)).map((c) => c.id);
    for (const teamId of w.pairs.flat()) {
      const offered = gift ? this.rng(st, week, teamId).shuffle(whitelist).slice(0, OFFERED) : [];
      const fixed = !gift && WAR_THEMES[week]?.fixedCard ? `fixed:${week}` : null;
      await this.db
        .insert(warCards)
        .values({ serverId, week, teamId, offered, received: fixed, revealedAt: gift ? null : now })
        .onConflictDoNothing();
    }
  }

  private async giftDeadline(serverId: string, week: number) {
    const [row] = await this.db.select().from(plannedEvents).where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, `gift_deadline:${week}`)));
    return row ?? null;
  }

  async choose(ctx: PlayCtx, week: number, card: string) {
    const st = await this.store.state(ctx.serverId);
    const t = st.teams[ctx.teamId]!;
    if (t.leader !== ctx.childId && t.deputy !== ctx.childId) refuse("not_leader");
    if (!this.isGift(st, week)) fail(409, "not_gift_week");
    const dl = await this.giftDeadline(ctx.serverId, week);
    if (!dl || dl.status !== "pending" || +dl.runAt <= +this.clock.now()) refuse("too_late");
    const [row] = await this.db.select().from(warCards).where(and(eq(warCards.serverId, ctx.serverId), eq(warCards.week, week), eq(warCards.teamId, ctx.teamId)));
    if (!row) refuse("not_paired");
    if (!(row!.offered as string[]).includes(card)) fail(400, "bad_card");
    await this.db.update(warCards).set({ chosen: card, chosenBy: ctx.childId, chosenAt: this.clock.now() }).where(eq(warCards.id, row!.id));
    return this.view(ctx, week);
  }

  /** Friday morning: every team receives the opponent's card (random if none was chosen). */
  async reveal(serverId: string, week: number): Promise<void> {
    const st = await this.store.state(serverId);
    const w = st.wars[week];
    if (!w || !this.isGift(st, week)) return;
    const rows = await this.db.select().from(warCards).where(and(eq(warCards.serverId, serverId), eq(warCards.week, week)));
    const by = new Map(rows.map((r) => [r.teamId, r]));
    const now = this.clock.now();
    for (const r of rows) {
      if (r.chosen || (r.offered as string[]).length === 0) continue;
      const pick = this.rng(st, week, `${r.teamId}|auto`).pick(r.offered as string[]);
      await this.db.update(warCards).set({ chosen: pick, chosenBy: "system", chosenAt: now }).where(eq(warCards.id, r.id));
      by.set(r.teamId, { ...r, chosen: pick });
    }
    for (const [a, b] of w.pairs) {
      for (const [me, opp] of [
        [a, b],
        [b, a],
      ] as const) {
        const mine = by.get(me);
        if (!mine || mine.revealedAt) continue;
        const received = by.get(opp)?.chosen ?? null;
        await this.db.update(warCards).set({ received, revealedAt: now }).where(eq(warCards.id, mine.id));
        await this.notifier.notify({
          kind: "system",
          childIds: st.teams[me]!.members.filter((m) => m.active).map((m) => m.childId),
          serverId,
          title: "本周收到的词条",
          body: `第 ${week} 周对手送给你们的词条：${cardText(received)?.text ?? ""}`,
          link: `/season/wars/${week}`,
          dedupeKey: `war_card:${serverId}:${week}`,
        });
      }
    }
  }

  async view(ctx: PlayCtx, week: number) {
    const st = await this.store.state(ctx.serverId);
    const w = st.wars[week];
    if (!w) fail(404, "not_found");
    const pair = w!.pairs.find((p) => p.includes(ctx.teamId));
    const opponent = pair ? (pair[0] === ctx.teamId ? pair[1] : pair[0]) : null;
    const [row] = await this.db.select().from(warCards).where(and(eq(warCards.serverId, ctx.serverId), eq(warCards.week, week), eq(warCards.teamId, ctx.teamId)));
    const dl = await this.giftDeadline(ctx.serverId, week);
    const grades = (teamId: string) => {
      const counts = new Map<number, number>();
      for (const m of st.teams[teamId]!.members.filter((x) => x.active)) counts.set(m.grade, (counts.get(m.grade) ?? 0) + 1);
      return [...counts.entries()].sort((x, y) => x[0] - y[0]).map(([g, n]) => ({ grade: g, gradeLabel: GRADE_LABELS[g] ?? String(g), count: n }));
    };
    return {
      week,
      theme: WAR_THEMES[week] ? { title: WAR_THEMES[week].title, task: WAR_THEMES[week].task } : null,
      gift: this.isGift(st, week),
      giftDeadline: dl?.runAt.toISOString() ?? null,
      opponent: opponent ? { id: opponent, name: st.teams[opponent]!.name, grades: grades(opponent) } : null,
      bye: w!.bye === ctx.teamId,
      offered: ((row?.offered as string[]) ?? []).map(cardText),
      chosen: cardText(row?.chosen ?? null),
      received: row?.revealedAt ? cardText(row.received) : null,
      settled: w!.settled,
      /** What winning and losing are worth, with the loser chest's odds (constitution 5: every random mechanism shows its odds). */
      stakes: warStakes(st),
      deadline: warDeadline(st, week),
      rubric: rubricWithGuide("C"),
      requirements: workRequirements("war"),
    };
  }

  /** Teams that have not chosen yet (for the 3-hour reminder). */
  async unchosen(serverId: string, week: number): Promise<string[]> {
    const rows = await this.db.select().from(warCards).where(and(eq(warCards.serverId, serverId), eq(warCards.week, week)));
    return rows.filter((r) => !r.chosen && (r.offered as string[]).length > 0).map((r) => r.teamId);
  }
}

/** Plain-words stakes of a weekly war (part 3 §11; loser chest odds published). */
export function warStakes(st: SeasonState): string {
  const p = st.params;
  const chest = p.items.loserChestEnabled ? `，再开一个败者宝箱：从 ${REGULAR_COMMON_ITEMS.length} 件常规凡品（${REGULAR_COMMON_ITEMS.map((id) => ITEMS.find((i) => i.id === id)?.name ?? id).join("、")}）里随机得 1 件，每件的机会都是 ${Math.round(100 / REGULAR_COMMON_ITEMS.length)}%。宝箱远不如赢一场` : "";
  return `赢了 +${p.war.win} 分；输了 ${p.war.lose} 分${chest}。同分时双方各 +${p.war.tie}；一方没交作品，交了的一方赢；轮空的组 +${p.war.bye}。`;
}
