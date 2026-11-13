/**
 * Timed reminders (PRD part 8 §1.2): "还没提交" a few hours before a deadline.
 * - Preference rounds (D1 blind auction, D2 starter items, D8 center lands, D15
 *   rare items) and the big-battle line-up: leader and deputy of every team
 *   that has not submitted, 3 hours before (message center only).
 * Work and supply reminders follow once works are stored.
 *
 * The worker calls `runDue` every tick; each reminder is sent once (dedupe key).
 */

import { and, eq, inArray } from "drizzle-orm";
import { plannedEvents, type Db } from "@zhiyouji/db";
import { campOf, type SeasonState } from "@zhiyouji/engine";
import { formatBeijing } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import type { SeasonStore } from "../seasonStore.js";
import type { Notifier } from "./notifier.js";
import { ROUNDS, type RoundName } from "../season/play.js";

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
    const keys = [...Object.values(ROUNDS).map((r) => r.deadline), "lines_deadline"];
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
