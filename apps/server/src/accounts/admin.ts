/**
 * Admin console accounts (PRD part 7 §0, part 8 §3.1, part 2 §4.8):
 * email + password + two-step code; admins and reviewers; new users join by a
 * one-time invite link (set a password, scan the two-step QR code, confirm one
 * code). Every view or download of a child's data is written to the view log.
 */

import { and, desc, eq, gte, isNull, lte, type SQL } from "drizzle-orm";
import { adminInvites, adminUsers, opLog, viewLog, type Db } from "@zhiyouji/db";
import type { AdminMe, AdminRole } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import { fail } from "../http/errors.js";
import { hashPassword, newTotpSecret, otpauthUrl, randomToken, sha256, verifyPassword, verifyTotp } from "../security.js";
import type { Sessions } from "./sessions.js";

export type AdminRow = typeof adminUsers.$inferSelect;

const DAY = 86_400_000;

export function adminMe(u: AdminRow): AdminMe {
  return { id: u.id, email: u.email, name: u.name, role: u.role as AdminRole, timezone: u.timezone };
}

export interface ViewRecord {
  childId?: string | null;
  /** work | recording | daily_task | survey | child_profile … */
  contentKind: string;
  objectId?: string | null;
  action: "view" | "download";
}

export class AdminAccounts {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: ServerConfig,
    private readonly sessions: Sessions,
  ) {}

  async user(id: string): Promise<AdminRow | undefined> {
    const [u] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return u;
  }

  async login(email: string, password: string, code: string): Promise<{ token: string; expiresAt: Date; user: AdminRow }> {
    const now = this.clock.now();
    const [u] = await this.db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    if (!u || u.status !== "active") {
      // Same work as a real check so the answer time does not reveal which emails exist.
      await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
      fail(401, "login_failed");
    }
    if (u!.lockedUntil && +u!.lockedUntil > +now) fail(429, "locked");
    const pwOk = await verifyPassword(password, u!.passwordHash);
    const step = u!.totpSecret ? verifyTotp(u!.totpSecret, code, +now) : null;
    const totpOk = step !== null && (u!.lastTotpStep === null || step > u!.lastTotpStep);
    if (!pwOk || !totpOk) {
      const failed = u!.failedLogins + 1;
      const lock = failed >= this.cfg.admin.maxFailedLogins;
      await this.db
        .update(adminUsers)
        .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(+now + this.cfg.admin.lockMinutes * 60_000) : u!.lockedUntil })
        .where(eq(adminUsers.id, u!.id));
      fail(lock ? 429 : 401, lock ? "locked" : "login_failed");
    }
    await this.db.update(adminUsers).set({ failedLogins: 0, lockedUntil: null, lastTotpStep: step, lastLoginAt: now }).where(eq(adminUsers.id, u!.id));
    const s = await this.sessions.create("admin", { adminUserId: u!.id });
    return { ...s, user: u! };
  }

  /** Create a user waiting for their invite (the first admin is created this way from the command line). */
  async invite(by: string, i: { email: string; name: string; role: AdminRole; timezone?: string }): Promise<{ user: AdminRow; inviteToken: string; expiresAt: Date }> {
    const now = this.clock.now();
    const [existing] = await this.db.select().from(adminUsers).where(eq(adminUsers.email, i.email)).limit(1);
    if (existing && existing.status !== "invited") fail(409, "email_taken");
    const user =
      existing ??
      (await this.db
        .insert(adminUsers)
        .values({ email: i.email, name: i.name, role: i.role, timezone: i.timezone ?? "Asia/Shanghai", status: "invited", createdAt: now })
        .returning())[0]!;
    if (existing) await this.db.update(adminUsers).set({ name: i.name, role: i.role }).where(eq(adminUsers.id, user.id));
    const token = randomToken();
    const expiresAt = new Date(+now + this.cfg.admin.inviteDays * DAY);
    await this.db.insert(adminInvites).values({ adminUserId: user.id, tokenHash: sha256(token), createdBy: by, createdAt: now, expiresAt });
    await this.log(by, "invite_admin_user", user.id, null, { email: i.email, role: i.role });
    return { user, inviteToken: token, expiresAt };
  }

  private async liveInvite(token: string) {
    const now = this.clock.now();
    const [inv] = await this.db
      .select()
      .from(adminInvites)
      .where(and(eq(adminInvites.tokenHash, sha256(token)), isNull(adminInvites.usedAt)))
      .limit(1);
    if (!inv || +inv.expiresAt <= +now) fail(400, "invite_invalid");
    const u = await this.user(inv!.adminUserId);
    if (!u || u.status !== "invited") fail(400, "invite_invalid");
    return { inv: inv!, user: u! };
  }

  /** Step 1 of an invite: set the password; get the two-step secret to scan. */
  async startInvite(token: string, password: string): Promise<{ secret: string; otpauthUrl: string; email: string }> {
    const { user } = await this.liveInvite(token);
    const secret = newTotpSecret();
    await this.db.update(adminUsers).set({ passwordHash: await hashPassword(password), totpSecret: secret }).where(eq(adminUsers.id, user.id));
    return { secret, otpauthUrl: otpauthUrl(secret, user.email), email: user.email };
  }

  /** Step 2: confirm one code from the authenticator app → the account is active. */
  async finishInvite(token: string, code: string): Promise<AdminRow> {
    const { inv, user } = await this.liveInvite(token);
    if (!user.totpSecret || !user.passwordHash) fail(400, "invite_invalid");
    const now = this.clock.now();
    const step = verifyTotp(user.totpSecret!, code, +now);
    if (step === null) fail(400, "totp_wrong");
    await this.db.update(adminInvites).set({ usedAt: now }).where(eq(adminInvites.id, inv.id));
    const [u] = await this.db.update(adminUsers).set({ status: "active", lastTotpStep: step }).where(eq(adminUsers.id, user.id)).returning();
    await this.log(`admin:${user.id}`, "activate_admin_user", user.id, null, null);
    return u!;
  }

  async list(): Promise<AdminRow[]> {
    return this.db.select().from(adminUsers).orderBy(adminUsers.createdAt);
  }

  async disable(by: AdminRow, id: string): Promise<void> {
    if (by.id === id) fail(400, "cannot_disable_self");
    const u = await this.user(id);
    if (!u) fail(404, "not_found");
    await this.db.update(adminUsers).set({ status: "disabled" }).where(eq(adminUsers.id, id));
    await this.sessions.revokeAll({ adminUserId: id });
    await this.log(`admin:${by.id}`, "disable_admin_user", id, { status: u!.status }, { status: "disabled" });
  }

  // ---- view log (part 8 §3.1) ---------------------------------------------------

  async recordView(adminUserId: string, v: ViewRecord): Promise<void> {
    await this.db.insert(viewLog).values({
      adminUserId,
      childId: v.childId ?? null,
      contentKind: v.contentKind,
      objectId: v.objectId ?? null,
      action: v.action,
      at: this.clock.now(),
    });
  }

  async viewLog(f: { adminUserId?: string; childId?: string; from?: Date; to?: Date; limit?: number }) {
    const conds: SQL[] = [];
    if (f.adminUserId) conds.push(eq(viewLog.adminUserId, f.adminUserId));
    if (f.childId) conds.push(eq(viewLog.childId, f.childId));
    if (f.from) conds.push(gte(viewLog.at, f.from));
    if (f.to) conds.push(lte(viewLog.at, f.to));
    return this.db
      .select()
      .from(viewLog)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(viewLog.at))
      .limit(Math.min(f.limit ?? 200, 1000));
  }

  private async log(actor: string, action: string, object: string, before: unknown, after: unknown): Promise<void> {
    await this.db.insert(opLog).values({ actor, action, object, before, after, at: this.clock.now() });
  }
}
