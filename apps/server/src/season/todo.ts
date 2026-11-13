/**
 * 首页 (PRD part 5 §4) and 组长待办 (E2): what the child sees first.
 *
 * - 战况: rank, points (and the change in the last 24 hours), grain, lands,
 *   the team's contests with deadlines — being attacked is urgent;
 * - 今天要做的事: sorted by deadline — the daily task, the team's works, the
 *   child's own part of the supply task, and for leaders and deputies the
 *   preferences, the card to send, the big-battle lines, usable items;
 * - the next publication and the latest report's first three lines;
 * - the season calendar strip: today's day and the next three events.
 *
 * Children who are not season players get only the daily task.
 */

import { and, asc, eq, gt } from "drizzle-orm";
import { children, dailySubmissions, plannedEvents, type Db } from "@zhiyouji/db";
import { beijingDate, DAY, frozenGrain, grainOf, itemDef, nextPublicationAfter, pointsOf, rankingAt, seasonDayOf, shopClosesAt, shopOpensAt, seasonWeekOf, spendableGrain } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import type { SeasonStore } from "../seasonStore.js";
import type { SeasonPlay } from "./play.js";
import { ROUNDS, type RoundName } from "./play.js";
import type { Reports } from "./reports.js";
import type { Supply } from "./supply.js";
import type { WarWords } from "./warWords.js";
import type { Works } from "./works.js";

export interface TodoItem {
  kind: "daily" | "work" | "supply" | "supply_summary" | "round" | "card" | "lines" | "items";
  title: string;
  /** Epoch ms; null = no deadline. */
  deadline: number | null;
  done: boolean;
  /** Only leaders and deputies get this one (组长待办). */
  leaderOnly: boolean;
  link: string;
}

const ROUND_TITLES: Record<RoundName, string> = {
  blind_auction: "盲拍：出价和边缘地顺序",
  starter_items: "选开营法宝",
  center_round: "排中心地顺序",
  rare_round: "排灵品顺序",
};

/** Calendar strip labels for planned events (part 5 §4 item 5); others are not shown. */
const EVENT_LABELS: Partial<Record<string, string>> = {
  blind_auction: "盲拍截止",
  starter_items: "开营法宝截止",
  contests_open: "可以发起进攻",
  supply_publish: "军需任务发布",
  supply_deadline: "军需任务截止",
  war_pairing: "周战争配对",
  war_start: "周战争开始",
  gift_deadline: "词条公布",
  war_deadline: "周战争作品截止",
  center_round: "中心地分配",
  shop_open: "商店开门",
  rare_round: "灵品分配",
  epic_open: "仙品竞价开始",
  shop_close: "商店关门",
  contests_close: "区域争夺结束",
  form_big_battle: "大团战分阵营",
  lines_deadline: "战线分配截止",
  lines_publish: "战线公布",
  battle_deadline: "大团战作品截止",
};

export class Home {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly play: SeasonPlay,
    private readonly works: Works,
    private readonly supply: Supply,
    private readonly warWords: WarWords,
    private readonly reports: Reports,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  /** End of today in Beijing (the daily task counts per Beijing day). */
  private endOfToday(now: number): number {
    const d = beijingDate(now);
    return Date.parse(`${d}T00:00:00+08:00`) + DAY;
  }

  async home(childId: string) {
    const now = this.now();
    const l = await this.play.lookup(childId);
    const today = beijingDate(now);
    const subs = await this.db.select().from(dailySubmissions).where(and(eq(dailySubmissions.childId, childId), eq(dailySubmissions.day, today)));
    if (l.kind !== "playing") {
      const passed = subs.some((s) => s.status === "passed");
      return {
        status: l.kind,
        todo: [{ kind: "daily", title: "每日任务", deadline: this.endOfToday(now), done: passed, leaderOnly: false, link: "/daily" }] as TodoItem[],
      };
    }
    const ctx = l.ctx;
    const st = await this.store.state(ctx.serverId);
    const me = (await this.play.me(childId)) as Extract<Awaited<ReturnType<SeasonPlay["me"]>>, { status: "playing" }>;
    const lead = me.canAct;
    const team = st.teams[ctx.teamId]!;
    const landName = await this.landNames(ctx.serverId);
    const todo: TodoItem[] = [];

    // the daily task: counted today out of the cap
    const week = seasonWeekOf(seasonDayOf(st.opening, now));
    const counted = st.taskPasses.filter((t) => t.childId === childId && t.counted);
    const countedToday = counted.filter((t) => t.date === today).length;
    const cap = st.params.dailyTask.capPerDay;
    todo.push({ kind: "daily", title: `每日任务（今天已计 ${countedToday}/${cap}）`, deadline: this.endOfToday(now), done: countedToday >= cap, leaderOnly: false, link: "/daily" });

    // the team's works
    for (const s of (await this.works.slots(ctx)).slots) {
      if (!s.open) continue;
      let title = s.kind === "war" ? `第 ${s.slot.split(":")[1]} 周周战争作品` : s.kind === "line" ? "大团战战线作品" : s.kind === "main" ? "大团战主战场作品" : "";
      if (s.kind === "contest") {
        const c = st.contests[s.slot.split(":")[1]!];
        title = `${landName.get(c?.landId ?? "") ?? ""}争夺作品（${s.role === "defender" ? "守方" : "进攻方"}${s.stage === "opening" ? " · 立论" : s.stage === "rebuttal" ? " · 驳论" : ""}）`;
      }
      todo.push({ kind: "work", title: s.submitted ? `${title}：已交第 ${s.submitted.version} 版` : title, deadline: s.deadline, done: !!s.submitted, leaderOnly: false, link: `/season/works/${encodeURIComponent(s.slot)}` });
    }

    // the supply task: my own part; the summary for leaders
    if (me.active)
      for (const t of (await this.supply.list(ctx)).tasks) {
        if (!t.open) continue;
        const dl = Date.parse(t.deadline);
        todo.push({ kind: "supply", title: `军需任务「${t.title}」：我的那份`, deadline: dl, done: !!t.mine, leaderOnly: false, link: "/season/supply" });
        if (lead) todo.push({ kind: "supply_summary", title: `军需任务「${t.title}」：小组小结`, deadline: dl, done: !!t.summary, leaderOnly: true, link: "/season/supply" });
      }

    if (lead) {
      // preference rounds open now
      for (const r of Object.keys(ROUNDS) as RoundName[]) {
        const v = await this.play.roundView(ctx, r);
        if (!v.open || !v.deadline) continue;
        todo.push({ kind: "round", title: ROUND_TITLES[r], deadline: Date.parse(v.deadline), done: !!v.submission, leaderOnly: true, link: `/season/rounds/${r}` });
      }
      // the card to send in a gift week
      for (const w of Object.values(st.wars)) {
        if (w.settled || !w.pairs.some((p) => p.includes(ctx.teamId))) continue;
        const v = await this.warWords.view(ctx, w.week);
        if (!v.gift || v.received || v.offered.length === 0 || !v.giftDeadline || Date.parse(v.giftDeadline) <= now) continue;
        todo.push({ kind: "card", title: `第 ${w.week} 周：选一张词条送给对手`, deadline: Date.parse(v.giftDeadline), done: !!v.chosen, leaderOnly: true, link: `/season/wars/${w.week}` });
      }
      // the big-battle lines
      const bb = await this.play.bigBattle(ctx);
      if (bb.formed && bb.myCamp && now < bb.linesDeadline)
        todo.push({ kind: "lines", title: "分配大团战战线", deadline: bb.linesDeadline, done: !!bb.myLines, leaderOnly: true, link: "/season/big-battle" });
      // items that can be used by hand
      const usable = team.items.filter((i) => !itemDef(i.itemId).passive).length;
      if (usable > 0) todo.push({ kind: "items", title: `法宝囊里有 ${usable} 件可以用的法宝`, deadline: null, done: false, leaderOnly: true, link: "/season/items" });
    }

    todo.sort((a, b) => Number(a.done) - Number(b.done) || (a.deadline ?? Infinity) - (b.deadline ?? Infinity));

    // 战况
    const rank = rankingAt(st, now).find((r) => r.teamId === ctx.teamId)?.rank ?? null;
    const pts = pointsOf(st, ctx.teamId);
    const change = st.ledger.filter((e) => e.teamId === ctx.teamId && e.currency === "points" && e.at > now - DAY && e.at <= now).reduce((sum, e) => sum + e.amount, 0);
    const contests = st.contestOrder
      .map((id) => st.contests[id]!)
      .filter((c) => c.status === "active" && (c.defender === ctx.teamId || c.attackers.some((a) => a.teamId === ctx.teamId)))
      .map((c) => {
        const defending = c.defender === ctx.teamId;
        const attackers = c.attackers.map((a) => st.teams[a.teamId]?.name ?? "").join("、");
        return {
          id: c.id,
          land: landName.get(c.landId) ?? c.landId,
          role: defending ? ("defender" as const) : ("attacker" as const),
          text: defending ? `${attackers}向${landName.get(c.landId) ?? c.landId}发起了进攻` : `本组进攻${st.teams[c.defender]?.name ?? ""}的${landName.get(c.landId) ?? c.landId}`,
          deadline: c.deadline,
          urgent: defending,
        };
      })
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.deadline - b.deadline);

    // the latest report's first three lines
    const list = (await this.reports.list(ctx, 1)).reports;
    const latest = list[0] ? await this.reports.get(ctx, list[0].id) : null;

    // the calendar strip: the next three planned events of the server
    const next = await this.db
      .select()
      .from(plannedEvents)
      .where(and(eq(plannedEvents.serverId, ctx.serverId), eq(plannedEvents.status, "pending"), gt(plannedEvents.runAt, new Date(now))))
      .orderBy(asc(plannedEvents.runAt))
      .limit(40);
    const upcoming = next
      .map((r) => ({ at: +r.runAt, label: EVENT_LABELS[r.kind] ?? null }))
      .filter((x): x is { at: number; label: string } => x.label !== null)
      .slice(0, 3);

    const child = await this.db.query.children.findFirst({ where: eq(children.id, childId) });
    return {
      status: "playing" as const,
      nickname: child?.nickname ?? "",
      season: { day: seasonDayOf(st.opening, now), week, days: st.params.time.seasonDays, paused: st.paused },
      battle: {
        rank,
        points: pts,
        pointsChange: change,
        grain: grainOf(st, ctx.teamId),
        spendableGrain: spendableGrain(st, ctx.teamId),
        frozenGrain: frozenGrain(st, ctx.teamId),
        lands: st.landOrder.filter((id) => st.lands[id]!.owner === ctx.teamId).map((id) => ({ id, name: landName.get(id) ?? id })),
        contests,
      },
      // The shop entry only while it is open (D15–D17), the big battle once the camps exist (part 5 §4).
      entries: { shop: now >= shopOpensAt(st) && now <= shopClosesAt(st), bigBattle: !!st.bigBattle },
      counts: {
        dailyCounted: countedToday,
        dailyCap: cap,
        worksPending: todo.filter((t) => t.kind === "work" && !t.done).length,
      },
      todo,
      nextPublication: nextPublicationAfter(now, st.params, st.calendar),
      latestReport: latest ? { id: latest.id, title: latest.title, lines: latest.lines.slice(0, 3).map((x) => x.text) } : null,
      upcoming,
    };
  }

  private landNames(serverId: string) {
    return this.play.landNames(serverId);
  }
}
