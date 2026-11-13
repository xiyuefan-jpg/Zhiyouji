/**
 * Parents' data rights and retention (PRD part 5 G4; part 8 §4; part 4 §12):
 *
 * - Export: the parent asks for a child's data; the server writes one JSON
 *   file (profile, grade history, seasons, works the child signed, messages)
 *   to storage and the parent downloads it with a short-lived link.
 * - Delete: the parent asks to delete a child (or the whole family account).
 *   It waits `deleteWaitDays` so the parent can cancel, then the worker
 *   removes the personal data: nickname and avatar replaced, uploaded files
 *   deleted, works the child signed anonymized as a whole (scores and the
 *   team's ledger stay, without the child's name), messages and sessions gone.
 * - 2 years without login: the parent gets an SMS 30 days before; logging in
 *   once keeps the account; otherwise the family is deleted the same way.
 */

import { and, eq, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import {
  children,
  consentRecords,
  dataRequests,
  families,
  files,
  gradeChanges,
  materials,
  messages,
  seasonPlayers,
  sessions,
  smsOutbox,
  works,
  type Db,
} from "@zhiyouji/db";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { ObjectStorage } from "../storage.js";

const DAY = 24 * 3_600_000;

/** Works whose signature list (jsonb array) has this child. */
const signedBy = (childId: string) => sql`${works.members} @> ${JSON.stringify([childId])}::jsonb`;

export interface RetentionConfig {
  /** Days a deletion waits (the parent may cancel). */
  deleteWaitDays: number;
  /** Days without login before an account is deleted (2 years). */
  inactiveDays: number;
  /** Days of notice before that deletion. */
  inactiveNoticeDays: number;
}

export const DEFAULT_RETENTION: RetentionConfig = { deleteWaitDays: 7, inactiveDays: 730, inactiveNoticeDays: 30 };

export class DataRights {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly storage: ObjectStorage,
    private readonly notifier: Notifier,
    private readonly cfg: RetentionConfig = DEFAULT_RETENTION,
  ) {}

  private async ownChild(familyId: string, childId: string) {
    const [c] = await this.db.select().from(children).where(and(eq(children.id, childId), eq(children.familyId, familyId), eq(children.status, "active")));
    if (!c) fail(404, "child_not_found");
    return c!;
  }

  private view(r: typeof dataRequests.$inferSelect) {
    return {
      id: r.id,
      kind: r.kind,
      childId: r.childId,
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      dueAt: r.dueAt.toISOString(),
      doneAt: r.doneAt?.toISOString() ?? null,
    };
  }

  async list(familyId: string) {
    const rows = await this.db.select().from(dataRequests).where(eq(dataRequests.familyId, familyId));
    return { requests: rows.sort((a, b) => +b.requestedAt - +a.requestedAt).map((r) => this.view(r)) };
  }

  // ---- export -------------------------------------------------------------------------------------

  async requestExport(familyId: string, childId: string) {
    const child = await this.ownChild(familyId, childId);
    const now = this.clock.now();
    const data = await this.collect(familyId, child.id);
    const key = `exports/${familyId}/${child.id}/${+now}.json`;
    await this.storage.put(key, Buffer.from(JSON.stringify(data, null, 2)), "application/json");
    const [row] = await this.db
      .insert(dataRequests)
      .values({ familyId, childId: child.id, kind: "export", status: "done", requestedAt: now, dueAt: now, doneAt: now, resultKey: key })
      .returning();
    return { request: this.view(row!) };
  }

  async downloadUrl(familyId: string, requestId: string) {
    const [r] = await this.db.select().from(dataRequests).where(and(eq(dataRequests.id, requestId), eq(dataRequests.familyId, familyId)));
    if (!r || r.kind !== "export" || !r.resultKey) fail(404, "not_found");
    return { url: await this.storage.downloadUrl(r!.resultKey!, +this.clock.now()) };
  }

  /** Everything stored about one child, in plain JSON. */
  private async collect(familyId: string, childId: string) {
    const [family] = await this.db.select().from(families).where(eq(families.id, familyId));
    const [child] = await this.db.select().from(children).where(eq(children.id, childId));
    return {
      exportedAt: this.clock.now().toISOString(),
      family: { phone: family!.phone, createdAt: family!.createdAt, consent: await this.db.select().from(consentRecords).where(eq(consentRecords.familyId, familyId)) },
      child: { nickname: child!.nickname, avatar: child!.avatar, grade: child!.grade, explainPref: child!.explainPref, createdAt: child!.createdAt },
      gradeChanges: await this.db.select().from(gradeChanges).where(eq(gradeChanges.childId, childId)),
      seasons: await this.db.select().from(seasonPlayers).where(eq(seasonPlayers.childId, childId)),
      works: (await this.db.select().from(works).where(signedBy(childId))).map((w) => ({
        kind: w.kind,
        version: w.version,
        submittedAt: w.submittedAt,
        mediaKind: w.mediaKind,
        text: w.text,
        aiNote: w.aiNote,
        files: w.fileIds,
      })),
      uploads: (await this.db.select().from(files).where(eq(files.childId, childId))).map((f) => ({ id: f.id, kind: f.kind, filename: f.filename, size: f.size, createdAt: f.createdAt })),
      messages: await this.db.select().from(messages).where(and(eq(messages.recipientKind, "child"), eq(messages.recipientId, childId))),
    };
  }

  // ---- delete -------------------------------------------------------------------------------------

  async requestDelete(familyId: string, childId: string | null) {
    if (childId) await this.ownChild(familyId, childId);
    const now = +this.clock.now();
    const [open] = await this.db
      .select()
      .from(dataRequests)
      .where(and(eq(dataRequests.familyId, familyId), eq(dataRequests.kind, "delete"), eq(dataRequests.status, "pending"), childId ? eq(dataRequests.childId, childId) : isNull(dataRequests.childId)));
    if (open) return { request: this.view(open) };
    const [row] = await this.db
      .insert(dataRequests)
      .values({ familyId, childId, kind: "delete", requestedAt: new Date(now), dueAt: new Date(now + this.cfg.deleteWaitDays * DAY) })
      .returning();
    await this.notifier.notifyAdmins({
      kind: "data_delete_requested",
      title: "家长申请删除数据",
      body: `一位家长申请删除${childId ? "一个孩子" : "整个家庭账号"}的数据，${this.cfg.deleteWaitDays} 天后自动执行（家长可以在这之前撤回）。`,
      link: `/data-requests`,
      dedupeKey: `data_delete:${row!.id}`,
      roles: ["admin"],
    });
    return { request: this.view(row!) };
  }

  async cancel(familyId: string, requestId: string) {
    const [r] = await this.db
      .update(dataRequests)
      .set({ status: "cancelled", doneAt: this.clock.now() })
      .where(and(eq(dataRequests.id, requestId), eq(dataRequests.familyId, familyId), eq(dataRequests.status, "pending")))
      .returning();
    if (!r) fail(404, "not_found");
    return { request: this.view(r!) };
  }

  /** Worker: carry out deletions that are due, and the 2-year clean-up. */
  async runDue(): Promise<{ deleted: number; noticed: number }> {
    const now = +this.clock.now();
    let deleted = 0;
    const due = await this.db.select().from(dataRequests).where(and(eq(dataRequests.kind, "delete"), eq(dataRequests.status, "pending"), lte(dataRequests.dueAt, new Date(now))));
    for (const r of due) {
      if (r.childId) await this.deleteChild(r.childId);
      else await this.deleteFamily(r.familyId);
      await this.db.update(dataRequests).set({ status: "done", doneAt: new Date(now) }).where(eq(dataRequests.id, r.id));
      deleted++;
    }
    const r = await this.inactive(now);
    return { deleted: deleted + r.deleted, noticed: r.noticed };
  }

  private async inactive(now: number): Promise<{ deleted: number; noticed: number }> {
    // Logging in after the notice keeps the account.
    await this.db.update(families).set({ inactiveNoticeAt: null }).where(sql`${families.inactiveNoticeAt} < ${families.lastLoginAt}`);
    const noticeBefore = new Date(now - (this.cfg.inactiveDays - this.cfg.inactiveNoticeDays) * DAY);
    const rows = await this.db
      .select()
      .from(families)
      .where(and(eq(families.status, "active"), or(lt(families.lastLoginAt, noticeBefore), and(isNull(families.lastLoginAt), lt(families.createdAt, noticeBefore)))));
    let deleted = 0;
    let noticed = 0;
    for (const f of rows) {
      const last = +(f.lastLoginAt ?? f.createdAt);
      if (!f.inactiveNoticeAt) {
        await this.notifier.smsToPhone(f.phone, "inactive", `inactive:${f.id}:${last}`);
        await this.db.update(families).set({ inactiveNoticeAt: new Date(now) }).where(eq(families.id, f.id));
        noticed++;
      } else if (now - last >= this.cfg.inactiveDays * DAY && now - +f.inactiveNoticeAt >= this.cfg.inactiveNoticeDays * DAY) {
        await this.deleteFamily(f.id);
        deleted++;
      }
    }
    return { deleted, noticed };
  }

  /** Remove one child's personal data (part 4 §12). */
  async deleteChild(childId: string): Promise<void> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const own = await tx.select().from(files).where(eq(files.childId, childId));
      // Works the child signed are anonymized as a whole (other children are in them too).
      const signed = await tx.select().from(works).where(signedBy(childId));
      const workFiles = signed.flatMap((w) => (w.fileIds as string[]) ?? []);
      const fileIds = [...new Set([...own.map((f) => f.id), ...workFiles])];
      const gone = fileIds.length ? await tx.select().from(files).where(inArray(files.id, fileIds)) : [];
      for (const f of gone) await this.storage.delete(f.storageKey);
      if (fileIds.length) await tx.update(files).set({ status: "deleted", filename: null, transcript: null }).where(inArray(files.id, fileIds));
      if (fileIds.length) await tx.update(materials).set({ removedAt: now, text: null }).where(inArray(materials.fileId, fileIds));
      await tx.update(materials).set({ removedAt: now, text: null }).where(eq(materials.addedBy, childId));
      if (signed.length) await tx.update(works).set({ text: null, aiNote: null, fileIds: [], members: [] }).where(inArray(works.id, signed.map((w) => w.id)));
      await tx.delete(messages).where(and(eq(messages.recipientKind, "child"), eq(messages.recipientId, childId)));
      await tx.update(sessions).set({ childId: null }).where(eq(sessions.childId, childId));
      await tx.update(children).set({ nickname: "已注销", avatar: "a1", status: "deleted" }).where(eq(children.id, childId));
    });
  }

  /** Remove a whole family: every child, then the phone number and the sessions. */
  async deleteFamily(familyId: string): Promise<void> {
    const kids = await this.db.select().from(children).where(eq(children.familyId, familyId));
    for (const k of kids) if (k.status !== "deleted") await this.deleteChild(k.id);
    const [f] = await this.db.select().from(families).where(eq(families.id, familyId));
    if (!f) return;
    await this.db.update(sessions).set({ revokedAt: this.clock.now() }).where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
    await this.db.delete(messages).where(and(eq(messages.recipientKind, "family"), eq(messages.recipientId, familyId)));
    await this.db.delete(smsOutbox).where(and(eq(smsOutbox.phone, f.phone), eq(smsOutbox.status, "pending")));
    // The phone number is the identifying field: replaced so the number can register again.
    await this.db.update(families).set({ phone: `deleted:${familyId}`, status: "deleted", consentVersion: null }).where(eq(families.id, familyId));
  }
}
