/**
 * Background worker loop (PRD part 2 §2): every tick, run due planned events
 * for every live server, tell admins about failures, and send due SMS.
 * Same code as the API, a different entry point; in season 1 both run in one
 * process (main.ts).
 */

import { eq, inArray } from "drizzle-orm";
import { seasons, servers, type Db } from "@zhiyouji/db";
import type { Notifier, SmsDispatcher } from "./notify/notifier.js";
import type { Scheduler } from "./scheduler.js";

/** Season states in which planned events run (part 4 §4). */
export const LIVE_SEASON_STATES = ["grouped", "running", "big_battle", "final_pending"];

export interface TickReport {
  servers: number;
  ran: number;
  failed: string[];
  sms: { sent: number; dropped: number; failed: number; deferred: number };
}

export class Worker {
  private busy = false;

  constructor(
    private readonly db: Db,
    private readonly scheduler: Scheduler,
    private readonly sms: SmsDispatcher,
    private readonly notifier: Notifier,
  ) {}

  /** One pass. Skips if the previous pass is still running. */
  async tick(): Promise<TickReport | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const live = await this.db
        .select({ id: servers.id })
        .from(servers)
        .innerJoin(seasons, eq(servers.seasonId, seasons.id))
        .where(inArray(seasons.status, LIVE_SEASON_STATES));
      const ids = live.map((s) => s.id);
      const report: TickReport = { servers: ids.length, ran: 0, failed: [], sms: { sent: 0, dropped: 0, failed: 0, deferred: 0 } };
      for (const serverId of ids) {
        const r = await this.scheduler.runDue(serverId);
        report.ran += r.ran.length;
        for (const x of r.ran.filter((x) => !x.ok)) {
          report.failed.push(x.key);
          await this.notifier.notifyAdmins({
            kind: "planned_event_failed",
            title: "计划事件失败",
            body: `${x.key}（${x.engineEvent ?? ""}）：${x.refusal ?? "未知原因"}。请在管理端查看并处理。`,
            link: `/servers/${serverId}/planned`,
            dedupeKey: `planned_failed:${serverId}:${x.key}`,
            roles: ["admin"],
          });
        }
      }
      report.sms = await this.sms.runDue();
      return report;
    } finally {
      this.busy = false;
    }
  }
}
