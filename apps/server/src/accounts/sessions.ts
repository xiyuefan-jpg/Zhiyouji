/**
 * Login sessions for both sides (PRD part 2 §4.8, part 8 §3.1).
 * - Family (student website): long-lived and sliding, so children do not
 *   type codes again; each use also counts as "logged in" for the 2-year rule.
 * - Admin console: logged out after a while without activity and after a
 *   fixed maximum.
 * Only a hash of the token is stored.
 */

import { and, eq, isNull } from "drizzle-orm";
import { families, sessions, type Db } from "@zhiyouji/db";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import { randomToken, sha256 } from "../security.js";

export type SessionRow = typeof sessions.$inferSelect;
export type SessionKind = "family" | "admin";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export class Sessions {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: ServerConfig,
  ) {}

  async create(kind: SessionKind, ref: { familyId?: string; adminUserId?: string }): Promise<{ token: string; expiresAt: Date }> {
    const now = this.clock.now();
    const token = randomToken();
    const expiresAt = new Date(+now + (kind === "family" ? this.cfg.family.sessionDays * DAY : this.cfg.admin.maxSessionHours * HOUR));
    await this.db.insert(sessions).values({
      tokenHash: sha256(token),
      kind,
      familyId: ref.familyId ?? null,
      adminUserId: ref.adminUserId ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** The live session for a token, or why there is none. Refreshes activity. */
  async resolve(token: string | undefined, kind: SessionKind): Promise<{ ok: true; session: SessionRow } | { ok: false; reason: "not_logged_in" | "session_expired" }> {
    if (!token) return { ok: false, reason: "not_logged_in" };
    const [s] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, sha256(token)), eq(sessions.kind, kind), isNull(sessions.revokedAt)))
      .limit(1);
    if (!s) return { ok: false, reason: "not_logged_in" };
    const now = this.clock.now();
    if (+now >= +s.expiresAt) return { ok: false, reason: "session_expired" };
    if (kind === "admin") {
      if (+now - +s.lastSeenAt > this.cfg.admin.idleMinutes * 60_000) {
        await this.db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, s.id));
        return { ok: false, reason: "session_expired" };
      }
      if (+now - +s.lastSeenAt > 30_000) {
        await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.id));
        s.lastSeenAt = now;
      }
    } else if (+now - +s.lastSeenAt > HOUR) {
      const expiresAt = new Date(+now + this.cfg.family.sessionDays * DAY);
      await this.db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, s.id));
      if (s.familyId) await this.db.update(families).set({ lastLoginAt: now }).where(eq(families.id, s.familyId));
      s.lastSeenAt = now;
      s.expiresAt = expiresAt;
    }
    return { ok: true, session: s };
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.update(sessions).set({ revokedAt: this.clock.now() }).where(eq(sessions.tokenHash, sha256(token)));
  }

  /** Log out every session of a family or an admin user (e.g. after disabling an account). */
  async revokeAll(ref: { familyId?: string; adminUserId?: string }): Promise<void> {
    const now = this.clock.now();
    if (ref.familyId) await this.db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.familyId, ref.familyId), isNull(sessions.revokedAt)));
    if (ref.adminUserId) await this.db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.adminUserId, ref.adminUserId), isNull(sessions.revokedAt)));
  }

  /**
   * Incident response (PRD part 8 §3.5): end every open login of one side or
   * both at once; everyone logs in again. Returns how many were ended.
   */
  async revokeKind(kind: "admin" | "family" | "all"): Promise<number> {
    const now = this.clock.now();
    const open = isNull(sessions.revokedAt);
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(kind === "all" ? open : and(open, eq(sessions.kind, kind)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  async setChild(sessionId: string, childId: string | null): Promise<void> {
    await this.db.update(sessions).set({ childId }).where(eq(sessions.id, sessionId));
  }
}
