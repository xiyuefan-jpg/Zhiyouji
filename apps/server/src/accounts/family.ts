/**
 * Student side accounts (PRD part 5 A2–A3, part 8 §2.1 and §3.1):
 * parent phone + SMS code → family account → parent confirms the documents
 * (同意 / 不同意) → child profiles ("我是谁").
 */

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { children, consentRecords, families, gradeChanges, loginCodes, type Db } from "@zhiyouji/db";
import { beijingDate, beijingInstant } from "@zhiyouji/engine";
import { GRADE_LABELS, maskPhone, type ChildCreate, type ChildUpdate, type ChildView, type FamilyMe } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import type { CaptchaVerifier, SmsProvider } from "../providers.js";
import { fail } from "../http/errors.js";
import { hmac, safeEqual, smsCode } from "../security.js";
import type { SessionRow, Sessions } from "./sessions.js";

export type FamilyRow = typeof families.$inferSelect;
export type ChildRow = typeof children.$inferSelect;

const HOUR = 3_600_000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function childView(c: ChildRow): ChildView {
  return {
    id: c.id,
    nickname: c.nickname,
    avatar: c.avatar,
    grade: c.grade,
    gradeLabel: GRADE_LABELS[c.grade] ?? String(c.grade),
    explainPref: c.explainPref as "voice" | "text",
    guideSeen: !!c.guideSeenAt,
  };
}

export class FamilyAccounts {
  /** Code requests per IP in the last hour (in memory; one server in season 1). */
  private ipHits = new Map<string, number[]>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: ServerConfig,
    private readonly sessions: Sessions,
    private readonly sms: SmsProvider,
    private readonly captcha: CaptchaVerifier,
  ) {}

  // ---- SMS code and login ---------------------------------------------------------

  async requestCode(phone: string, ip: string | undefined, captchaToken?: string): Promise<{ resendAfterMs: number }> {
    const now = +this.clock.now();
    const c = this.cfg.sms;

    if (ip) {
      const hits = (this.ipHits.get(ip) ?? []).filter((t) => now - t < HOUR);
      if (hits.length >= c.perIpPerHour) fail(429, "ip_limit");
      hits.push(now);
      this.ipHits.set(ip, hits);
    }

    const recent = await this.db
      .select()
      .from(loginCodes)
      .where(and(eq(loginCodes.phone, phone), gte(loginCodes.createdAt, new Date(now - 24 * HOUR))))
      .orderBy(desc(loginCodes.createdAt));
    const last = recent[0];
    if (last && now - +last.createdAt < c.resendMs) fail(429, "too_soon", { retryAfterMs: c.resendMs - (now - +last.createdAt) });
    const dayStart = beijingInstant(beijingDate(now), 0, 0);
    if (recent.filter((r) => +r.createdAt >= dayStart).length >= c.perPhonePerDay) fail(429, "daily_limit");
    const wrongTries = recent.reduce((s, r) => s + r.attempts, 0);
    if (wrongTries >= c.captchaAfterFails) {
      if (!captchaToken) fail(400, "captcha_required");
      if (!(await this.captcha.verify(captchaToken!, ip))) fail(400, "captcha_wrong");
    }

    const code = smsCode();
    const sent = await this.sms.sendCode(phone, code);
    if (!sent.ok) fail(502, "sms_failed");
    await this.db.insert(loginCodes).values({
      phone,
      codeHash: hmac(this.cfg.secret, `${phone}:${code}`),
      ip: ip ?? null,
      createdAt: new Date(now),
      expiresAt: new Date(now + c.codeTtlMs),
    });
    return { resendAfterMs: c.resendMs };
  }

  /** Check the code; create the family account the first time. */
  async login(phone: string, code: string): Promise<{ token: string; expiresAt: Date; family: FamilyRow }> {
    const now = this.clock.now();
    const [row] = await this.db
      .select()
      .from(loginCodes)
      .where(and(eq(loginCodes.phone, phone), isNull(loginCodes.usedAt)))
      .orderBy(desc(loginCodes.createdAt))
      .limit(1);
    if (!row || +row.expiresAt <= +now || row.attempts >= this.cfg.sms.maxAttempts) fail(400, "code_expired");
    if (!safeEqual(row!.codeHash, hmac(this.cfg.secret, `${phone}:${code}`))) {
      const attempts = row!.attempts + 1;
      await this.db.update(loginCodes).set({ attempts }).where(eq(loginCodes.id, row!.id));
      const left = this.cfg.sms.maxAttempts - attempts;
      fail(400, left > 0 ? "code_wrong" : "code_expired", { attemptsLeft: Math.max(0, left) });
    }
    await this.db.update(loginCodes).set({ usedAt: now }).where(eq(loginCodes.id, row!.id));

    let [fam] = await this.db.select().from(families).where(eq(families.phone, phone)).limit(1);
    if (!fam) {
      [fam] = await this.db.insert(families).values({ phone, createdAt: now, lastLoginAt: now }).returning();
    } else {
      await this.db.update(families).set({ lastLoginAt: now }).where(eq(families.id, fam.id));
    }
    const s = await this.sessions.create("family", { familyId: fam!.id });
    return { ...s, family: fam! };
  }

  // ---- the parent's confirmation ----------------------------------------------------

  async family(familyId: string): Promise<FamilyRow> {
    const [f] = await this.db.select().from(families).where(eq(families.id, familyId)).limit(1);
    if (!f || f.status === "deleted") fail(401, "not_logged_in");
    return f!;
  }

  needsConsent(f: FamilyRow): boolean {
    return f.status === "refused" || f.consentVersion !== this.cfg.policyVersion;
  }

  async consent(familyId: string, choice: "agree" | "disagree", version: string): Promise<{ needsConsent: boolean; refused: boolean }> {
    if (version !== this.cfg.policyVersion) fail(409, "policy_changed", { policyVersion: this.cfg.policyVersion });
    const now = this.clock.now();
    await this.db.insert(consentRecords).values({ familyId, choice, policyVersion: version, at: now });
    if (choice === "agree") {
      await this.db.update(families).set({ status: "active", consentVersion: version, consentAt: now }).where(eq(families.id, familyId));
      return { needsConsent: false, refused: false };
    }
    await this.db.update(families).set({ status: "refused", consentVersion: null, consentAt: null }).where(eq(families.id, familyId));
    return { needsConsent: true, refused: true };
  }

  async me(session: SessionRow): Promise<FamilyMe> {
    const f = await this.family(session.familyId!);
    const kids = await this.listChildren(f.id);
    return {
      family: { id: f.id, phone: maskPhone(f.phone) },
      needsConsent: this.needsConsent(f),
      refused: f.status === "refused",
      policyVersion: this.cfg.policyVersion,
      children: kids.map(childView),
      activeChildId: kids.some((k) => k.id === session.childId) ? session.childId : null,
    };
  }

  // ---- child profiles ---------------------------------------------------------------

  async listChildren(familyId: string): Promise<ChildRow[]> {
    return this.db
      .select()
      .from(children)
      .where(and(eq(children.familyId, familyId), eq(children.status, "active")))
      .orderBy(children.createdAt);
  }

  async child(familyId: string, childId: string): Promise<ChildRow> {
    if (!UUID_RE.test(childId)) fail(404, "child_not_found");
    const [c] = await this.db
      .select()
      .from(children)
      .where(and(eq(children.id, childId), eq(children.familyId, familyId), eq(children.status, "active")))
      .limit(1);
    if (!c) fail(404, "child_not_found");
    return c!;
  }

  async createChild(familyId: string, input: ChildCreate): Promise<ChildRow> {
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(children)
      .where(and(eq(children.familyId, familyId), eq(children.status, "active")));
    if (n >= this.cfg.family.maxChildren) fail(400, "too_many_children");
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(children)
        .values({ familyId, nickname: input.nickname, avatar: input.avatar, grade: input.grade, explainPref: input.explainPref, createdAt: now })
        .returning();
      await tx.insert(gradeChanges).values({ childId: c!.id, fromGrade: null, toGrade: input.grade, source: "created", at: now });
      return c!;
    });
  }

  async updateChild(familyId: string, childId: string, patch: ChildUpdate): Promise<ChildRow> {
    const cur = await this.child(familyId, childId);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [c] = await tx.update(children).set(patch).where(eq(children.id, childId)).returning();
      if (patch.grade !== undefined && patch.grade !== cur.grade)
        await tx.insert(gradeChanges).values({ childId, fromGrade: cur.grade, toGrade: patch.grade, source: "parent", at: now });
      return c!;
    });
  }

  /** 新手引导 seen or skipped (part 5 A5): remembered on the account, first time only. */
  async markGuideSeen(familyId: string, childId: string): Promise<ChildRow> {
    const cur = await this.child(familyId, childId);
    if (cur.guideSeenAt) return cur;
    const [c] = await this.db.update(children).set({ guideSeenAt: this.clock.now() }).where(eq(children.id, childId)).returning();
    return c!;
  }

  /** Remember when this child last used the site (leader take-over, part 3 §5). Written at most every 5 minutes. */
  async touchChild(c: ChildRow): Promise<void> {
    const now = this.clock.now();
    if (c.lastActiveAt && +now - +c.lastActiveAt < 5 * 60_000) return;
    await this.db.update(children).set({ lastActiveAt: now }).where(eq(children.id, c.id));
  }

  async chooseChild(session: SessionRow, childId: string): Promise<ChildRow> {
    const c = await this.child(session.familyId!, childId);
    await this.sessions.setChild(session.id, c.id);
    return c;
  }
}
