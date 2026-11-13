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
import type { Reports } from "./season/reports.js";
import type { Reminders } from "./notify/reminders.js";
import type { Scoring } from "./season/scoring.js";
import type { DataRights } from "./accounts/dataRights.js";
import type { DailyTasks } from "./daily/daily.js";
import type { Supply } from "./season/supply.js";
import type { Debates } from "./season/debates.js";
import type { Operations } from "./season/operations.js";
import type { Showcase } from "./season/showcase.js";
import type { Summaries } from "./daily/summaries.js";
import type { MediaPipeline } from "./media.js";
import type { TagSuggestions } from "./daily/tagSuggestions.js";

/** Season states in which planned events run (part 4 §4). */
export const LIVE_SEASON_STATES = ["grouped", "running", "big_battle", "final_pending"];

export interface TickReport {
  servers: number;
  ran: number;
  failed: string[];
  /** 战报 created this tick. */
  reports: number;
  /** Reminder messages sent this tick. */
  reminders: number;
  /** Scoring rounds closed / settled and reviews timed out this tick. */
  scoring: { closed: number; settled: number; timeouts: number };
  /** Accounts deleted (requests and 2-year clean-up) and inactivity notices sent. */
  dataRights: { deleted: number; noticed: number };
  /** Daily tasks reviewed on retry, and sent to the exception queue. */
  daily: { reviewed: number; errors: number };
  sms: { sent: number; dropped: number; failed: number; deferred: number };
}

export class Worker {
  private busy = false;

  constructor(
    private readonly db: Db,
    private readonly scheduler: Scheduler,
    private readonly sms: SmsDispatcher,
    private readonly notifier: Notifier,
    private readonly reports?: Reports,
    private readonly reminders?: Reminders,
    private readonly scoring?: Scoring,
    private readonly dataRights?: DataRights,
    private readonly daily?: DailyTasks,
    private readonly supply?: Supply,
    private readonly debates?: Debates,
    private readonly ops?: Operations,
    private readonly showcase?: Showcase,
    private readonly summaries?: Summaries,
    private readonly media?: MediaPipeline,
    private readonly tagSuggestions?: TagSuggestions,
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
      const report: TickReport = { servers: ids.length, ran: 0, failed: [], reports: 0, reminders: 0, scoring: { closed: 0, settled: 0, timeouts: 0 }, dataRights: { deleted: 0, noticed: 0 }, daily: { reviewed: 0, errors: 0 }, sms: { sent: 0, dropped: 0, failed: 0, deferred: 0 } };
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
      for (const serverId of ids) {
        try {
          await this.debates?.runDue(serverId);
          const sc = await this.scoring?.runDue(serverId);
          if (sc) report.scoring = { closed: report.scoring.closed + sc.closed, settled: report.scoring.settled + sc.settled, timeouts: report.scoring.timeouts + sc.timeouts };
          const sp = await this.supply?.runDue(serverId);
          if (sp) report.reminders += sp.reminded;
          await this.showcase?.runDue(serverId);
          report.reports += (await this.reports?.runDue(serverId)) ?? 0;
          report.reminders += (await this.reminders?.runDue(serverId)) ?? 0;
        } catch (err) {
          console.error("report failed", serverId, err);
        }
      }
      try {
        await this.ops?.publishDue();
        await this.summaries?.runDue();
        await this.tagSuggestions?.runDue();
        await this.ops?.qrReminders();
      } catch (err) {
        console.error("announcements / QR reminders failed", err);
      }
      try {
        // new uploads: speech-to-text, key frames, document text (before the AI needs them)
        await this.media?.runDue();
      } catch (err) {
        console.error("media processing failed", err);
      }
      try {
        report.daily = (await this.daily?.runDue()) ?? report.daily;
      } catch (err) {
        console.error("daily reviews failed", err);
      }
      try {
        report.dataRights = (await this.dataRights?.runDue()) ?? report.dataRights;
      } catch (err) {
        console.error("data rights failed", err);
      }
      report.sms = await this.sms.runDue();
      return report;
    } finally {
      this.busy = false;
    }
  }
}
