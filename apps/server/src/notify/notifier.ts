/**
 * Notifications (PRD part 8 §1, round 30): the message center gets every
 * notification; the four urgent kinds also queue an SMS to the parent phone.
 *
 * SMS rules:
 * - quiet hours 21:30–07:00 Beijing: the SMS waits until 07:00;
 * - merging: while a reminder of the same template is still waiting for a
 *   phone, a new one is folded into it (siblings in an attacked team, two teams
 *   joining the same attack, everything that came up overnight → one SMS);
 * - at most `remindersPerDay` reminders per phone per Beijing day; the rest
 *   are dropped (they are still in the message center);
 * - families that have not agreed to the documents get nothing.
 */

import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { adminUsers, children, families, messages, smsOutbox, type Db } from "@zhiyouji/db";
import { SMS_TEMPLATE_OF, type MessageView, type NotifyKind, type SmsTemplate } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import type { SmsProvider } from "../providers.js";
import { beijingDayStart, isQuiet, quietRelease } from "./quiet.js";

export interface NotifyInput {
  kind: NotifyKind;
  /** Children to notify (season players of a team, one child, …). */
  childIds: string[];
  title: string;
  body: string;
  /** Page in the site, e.g. "/contest/K12". */
  link?: string | null;
  serverId?: string | null;
  /** The same event is never notified twice (e.g. "attacked:K12"). */
  dedupeKey: string;
}

export interface Recipient {
  kind: "child" | "family" | "admin";
  id: string;
}

export interface NotifyResult {
  messages: number;
  /** New SMS queued (merged or skipped ones not counted). */
  smsQueued: number;
}

const RETRY_MS = 2 * 60_000;
const MAX_SMS_ATTEMPTS = 3;

export class Notifier {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: ServerConfig,
  ) {}

  async notify(i: NotifyInput): Promise<NotifyResult> {
    if (i.childIds.length === 0) return { messages: 0, smsQueued: 0 };
    const now = this.clock.now();
    const inserted = await this.db
      .insert(messages)
      .values(
        [...new Set(i.childIds)].map((childId) => ({
          recipientKind: "child",
          recipientId: childId,
          serverId: i.serverId ?? null,
          type: i.kind,
          title: i.title,
          body: i.body,
          link: i.link ?? null,
          dedupeKey: i.dedupeKey,
          createdAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning({ recipientId: messages.recipientId });

    const template = SMS_TEMPLATE_OF[i.kind];
    if (!template || inserted.length === 0) return { messages: inserted.length, smsQueued: 0 };
    // Only children who got a new message (a repeated event sends nothing).
    const phones = await this.phonesOf(inserted.map((r) => r.recipientId));
    let smsQueued = 0;
    for (const phone of phones) if (await this.queueSms(phone, template, i.dedupeKey, +now)) smsQueued++;
    return { messages: inserted.length, smsQueued };
  }

  /** Message for every active admin console user (part 7 notification center); `roles` narrows it. */
  async notifyAdmins(i: { kind: string; title: string; body: string; link?: string | null; dedupeKey: string; roles?: string[]; userIds?: string[] }): Promise<number> {
    const users = await this.db.select().from(adminUsers).where(eq(adminUsers.status, "active"));
    const to = users.filter((u) => (!i.roles || i.roles.includes(u.role)) && (!i.userIds || i.userIds.includes(u.id)));
    if (to.length === 0) return 0;
    const now = this.clock.now();
    const rows = await this.db
      .insert(messages)
      .values(to.map((u) => ({ recipientKind: "admin", recipientId: u.id, type: i.kind, title: i.title, body: i.body, link: i.link ?? null, dedupeKey: i.dedupeKey, createdAt: now })))
      .onConflictDoNothing()
      .returning({ id: messages.id });
    return rows.length;
  }

  private async phonesOf(childIds: string[]): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ phone: families.phone })
      .from(children)
      .innerJoin(families, eq(children.familyId, families.id))
      .where(
        and(
          inArray(children.id, childIds),
          eq(children.status, "active"),
          eq(families.status, "active"),
          eq(families.consentVersion, this.cfg.policyVersion),
        ),
      );
    return rows.map((r) => r.phone);
  }

  /** An SMS straight to a parent phone (account notices, not tied to a child's message). */
  async smsToPhone(phone: string, template: SmsTemplate, dedupeKey: string): Promise<boolean> {
    return this.queueSms(phone, template, dedupeKey, +this.clock.now());
  }

  /** Queue one reminder unless one of the same template is already waiting for this phone. */
  private async queueSms(phone: string, template: SmsTemplate, dedupeKey: string, now: number): Promise<boolean> {
    const [waiting] = await this.db
      .select({ id: smsOutbox.id })
      .from(smsOutbox)
      .where(and(eq(smsOutbox.phone, phone), eq(smsOutbox.kind, template), eq(smsOutbox.status, "pending")))
      .limit(1);
    if (waiting) return false;
    const rows = await this.db
      .insert(smsOutbox)
      .values({ phone, kind: template, mergeKey: `${template}:${dedupeKey}`, sendAfter: new Date(quietRelease(now)), createdAt: new Date(now) })
      .onConflictDoNothing()
      .returning({ id: smsOutbox.id });
    return rows.length > 0;
  }

  // ---- message center -----------------------------------------------------------

  private recipientWhere(rs: Recipient[]): SQL {
    return or(...rs.map((r) => and(eq(messages.recipientKind, r.kind), eq(messages.recipientId, r.id))))!;
  }

  async list(rs: Recipient[], opts: { before?: Date; limit?: number } = {}): Promise<MessageView[]> {
    const conds = [this.recipientWhere(rs)];
    if (opts.before) conds.push(lt(messages.createdAt, opts.before));
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conds))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(Math.min(opts.limit ?? 30, 100));
    return rows.map((m) => ({
      id: m.id,
      type: m.type,
      title: m.title,
      body: m.body,
      link: m.link,
      createdAt: m.createdAt.toISOString(),
      read: m.readAt !== null,
      childId: m.recipientKind === "child" ? m.recipientId : null,
    }));
  }

  async unreadCount(rs: Recipient[]): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(this.recipientWhere(rs), isNull(messages.readAt)));
    return r?.n ?? 0;
  }

  /** Mark one message (or all, when `id` is omitted) as read; only the recipients' own messages. */
  async markRead(rs: Recipient[], id?: string): Promise<number> {
    const conds = [this.recipientWhere(rs), isNull(messages.readAt)];
    if (id) conds.push(eq(messages.id, id));
    const rows = await this.db.update(messages).set({ readAt: this.clock.now() }).where(and(...conds)).returning({ id: messages.id });
    return rows.length;
  }
}

/** Sends due reminder SMS from the outbox (run by the worker every minute). */
export class SmsDispatcher {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: ServerConfig,
    private readonly sms: SmsProvider,
  ) {}

  async runDue(): Promise<{ sent: number; dropped: number; failed: number; deferred: number }> {
    const now = +this.clock.now();
    const out = { sent: 0, dropped: 0, failed: 0, deferred: 0 };
    const due = await this.db
      .select()
      .from(smsOutbox)
      .where(and(eq(smsOutbox.status, "pending"), lte(smsOutbox.sendAfter, new Date(now))))
      .orderBy(asc(smsOutbox.sendAfter), asc(smsOutbox.createdAt));
    for (const r of due) {
      if (isQuiet(now)) {
        await this.db.update(smsOutbox).set({ sendAfter: new Date(quietRelease(now)) }).where(eq(smsOutbox.id, r.id));
        out.deferred++;
        continue;
      }
      const [{ n } = { n: 0 }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(smsOutbox)
        .where(and(eq(smsOutbox.phone, r.phone), eq(smsOutbox.status, "sent"), sql`${smsOutbox.sentAt} >= ${new Date(beijingDayStart(now))}`));
      if (n >= this.cfg.sms.remindersPerDay) {
        await this.db.update(smsOutbox).set({ status: "dropped", error: "daily_cap" }).where(eq(smsOutbox.id, r.id));
        out.dropped++;
        continue;
      }
      const res = await this.sms.sendReminder(r.phone, r.kind as SmsTemplate);
      if (res.ok) {
        await this.db.update(smsOutbox).set({ status: "sent", sentAt: new Date(now), providerId: res.id ?? null, attempts: r.attempts + 1 }).where(eq(smsOutbox.id, r.id));
        out.sent++;
      } else {
        const attempts = r.attempts + 1;
        const give = attempts >= MAX_SMS_ATTEMPTS;
        await this.db
          .update(smsOutbox)
          .set({ attempts, error: res.error ?? "send failed", status: give ? "failed" : "pending", sendAfter: new Date(now + RETRY_MS) })
          .where(eq(smsOutbox.id, r.id));
        if (give) out.failed++;
      }
    }
    return out;
  }
}
