/**
 * Timed reminders (PRD part 8 §1.2): "还没提交" a few hours before a deadline.
 * - Preference rounds (D1 blind auction, D2 starter items, D8 center lands, D15
 *   rare items) and the big-battle line-up: leader and deputy of every team
 *   that has not submitted, 3 hours before (message center only).
 * - Team works (contest, weekly war, big-battle line, main field) not handed in
 *   6 hours (message + SMS) and 2 hours (message) before the deadline: leader
 *   and deputy.
 * - Gift-week cards not chosen, 3 hours before Friday morning: leader and deputy.
 * (Supply tasks remind each member themselves, see season/supply.ts.)
 *
 * The worker calls `runDue` every tick; each reminder is sent once (dedupe key).
 */

import { and, eq, inArray } from "drizzle-orm";
import { plannedEvents, works, type Db } from "@zhiyouji/db";
import { campOf, type SeasonState } from "@zhiyouji/engine";
import { formatBeijing } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import type { SeasonStore } from "../seasonStore.js";
import type { Notifier } from "./notifier.js";
import { ROUNDS, type RoundName } from "../season/play.js";
import { teamSlots } from "../season/works.js";
import type { WarWords } from "../season/warWords.js";
import type { Debates } from "../season/debates.js";

const HOUR = 3_600_000;
export const SUBMIT_REMINDER_HOURS = 3;

const ROUND_TEXT: Record<RoundName, string> = {
  blind_auction: "第 1 批选地（盲拍）的出价和偏好",
  starter_items: "开营法宝的选择",
  center_round: "中心地的购买偏好",
  rare_round: "灵品的偏好",
};

export class Reminders {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly notifier: Notifier,
    private readonly warWords?: WarWords,
    private readonly debates?: Debates,
  ) {}

  private leaders(st: SeasonState, teamId: string): string[] {
    const t = st.teams[teamId];
    if (!t) return [];
    const ids = [t.leader, t.deputy].filter((x): x is string => !!x);
    return ids.length ? ids : t.members.filter((m) => m.active).map((m) => m.childId);
  }

  async runDue(serverId: string): Promise<number> {
    const now = +this.clock.now();
    const st = await this.store.state(serverId);
    let sent = 0;
    sent += await this.workReminders(serverId, st, now);
    const keys = [...Object.values(ROUNDS).map((r) => r.deadline), "lines_deadline", ...[1, 2, 3, 4, 5].map((w) => `gift_deadline:${w}`)];
    const rows = await this.db
      .select()
      .from(plannedEvents)
      .where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.status, "pending"), inArray(plannedEvents.key, keys)));
    for (const row of rows) {
      const due = +row.runAt;
      if (now < due - SUBMIT_REMINDER_HOURS * HOUR || now >= due) continue;
      if (row.key === "lines_deadline") {
        sent += await this.linesReminder(serverId, st, due);
        continue;
      }
      if (row.key.startsWith("gift_deadline:")) {
        const week = Number(row.key.slice("gift_deadline:".length));
        for (const teamId of (await this.warWords?.unchosen(serverId, week)) ?? []) {
          const r = await this.notifier.notify({
            kind: "submit_due",
            childIds: this.leaders(st, teamId),
            serverId,
            title: "还没选送给对手的词条",
            body: `第 ${week} 周的词条还没选，${formatBeijing(due)} 截止，没选的由系统随机选。`,
            link: `/season/wars/${week}`,
            dedupeKey: `submit_due:${serverId}:gift:${week}`,
          });
          sent += r.messages;
        }
        continue;
      }
      const round = (Object.keys(ROUNDS) as RoundName[]).find((r) => ROUNDS[r].deadline === row.key)!;
      // The round must be open (e.g. starter items only after the auction).
      const open = await this.db
        .select()
        .from(plannedEvents)
        .where(and(eq(plannedEvents.serverId, serverId), eq(plannedEvents.key, ROUNDS[round].open)));
      if (!open[0] || +open[0].runAt > now) continue;
      const subs = new Set((await this.store.submissions(serverId, round)).map((x) => x.teamId));
      for (const teamId of st.teamOrder) {
        if (subs.has(teamId)) continue;
        const r = await this.notifier.notify({
          kind: "submit_due",
          childIds: this.leaders(st, teamId),
          serverId,
          title: "还没提交",
          body: `本组还没提交${ROUND_TEXT[round]}，${formatBeijing(due)} 截止。`,
          link: `/season/rounds/${round}`,
          dedupeKey: `submit_due:${serverId}:${round}`,
        });
        sent += r.messages;
      }
    }
    return sent;
  }

  /** 本组的作品还没交: 6 hours before (with SMS) and 2 hours before. */
  private async workReminders(serverId: string, st: SeasonState, now: number): Promise<number> {
    let sent = 0;
    const debateDeadlines = this.debates ? await this.debates.openingDeadlines(serverId) : new Map();
    for (const teamId of st.teamOrder) {
      const due = teamSlots(st, teamId, now, debateDeadlines).filter((s) => s.open && s.deadline - now <= 6 * HOUR);
      if (due.length === 0) continue;
      const handed = await this.db
        .select({ slot: works.slot })
        .from(works)
        .where(and(eq(works.serverId, serverId), eq(works.teamId, teamId), inArray(works.slot, due.map((s) => s.slot))));
      const done = new Set(handed.map((h) => h.slot));
      for (const s of due) {
        if (done.has(s.slot)) continue;
        // The main field is one work per camp: any team of the camp handing it in is enough.
        if (s.kind === "main") {
          const camp = await this.db.select({ id: works.id }).from(works).where(and(eq(works.serverId, serverId), eq(works.slot, s.slot)));
          if (camp.length > 0) continue;
        }
        const two = s.deadline - now <= 2 * HOUR;
        const r = await this.notifier.notify({
          kind: two ? "work_due_2h" : "work_due_6h",
          childIds: this.leaders(st, teamId),
          serverId,
          title: "本组的作品还没交",
          body: `离截止不到 ${two ? 2 : 6} 小时（${formatBeijing(s.deadline)}），本组的作品还没交。`,
          link: `/season/works`,
          dedupeKey: `${two ? "work_due_2h" : "work_due_6h"}:${serverId}:${s.slot}`,
        });
        sent += r.messages;
      }
    }
    return sent;
  }

  private async linesReminder(serverId: string, st: SeasonState, due: number): Promise<number> {
    const bb = st.bigBattle;
    if (!bb) return 0;
    let sent = 0;
    for (const camp of ["a", "b"] as const) {
      if (bb.submitted[camp]) continue;
      for (const teamId of bb.camps[camp]) {
        if (campOf(bb, teamId) !== camp) continue;
        const r = await this.notifier.notify({
          kind: "submit_due",
          childIds: this.leaders(st, teamId),
          serverId,
          title: "战线分配还没提交",
          body: `你们阵营还没提交大团战的战线分配，${formatBeijing(due)} 截止。没交的会由系统随机分配。`,
          link: `/season/big-battle`,
          dedupeKey: `submit_due:${serverId}:lines`,
        });
        sent += r.messages;
      }
    }
    return sent;
  }
}
