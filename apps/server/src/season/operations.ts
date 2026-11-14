/**
 * Running the community around the season (PRD part 7 §3, §7, §8; part 5 E1,
 * E12; part 4 v0.6):
 * - 公告: admins write one, pick everyone / a season / a server and the time;
 *   at that time it goes into every reached child's message center;
 * - WeChat group QR codes: uploaded by admins for every team and camp; only
 *   that team or camp sees them; the admins are reminded 6 days after an upload
 *   (the codes expire after 7);
 * - 使者: leaders and deputies register envoys for the main field; envoys may
 *   hand in the main-field work.
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { aiDisclosures, announcements, campQrCodes, children, envoys, messages, seasonPlayers, seasons, servers, teamMembers, teams, type Db } from "@zhiyouji/db";
import { beijingDate, beijingInstant, campOf, type Camp } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import type { ObjectStorage } from "../storage.js";
import { refuse, type PlayCtx } from "./play.js";

const DAY = 24 * 3_600_000;
export const QR_REMIND_AFTER_DAYS = 6;
const QR_MAX_BYTES = 5 * 1024 * 1024;

export interface AnnouncementInput {
  scope: "all" | "season" | "server";
  seasonId?: string | null;
  serverId?: string | null;
  title: string;
  body: string;
  publishAt: Date;
}

/** 手动推送: messages a child gets from the admins per day at most (part 7 §8 "每天有次数上限"). */
export const MANUAL_PUSH_PER_CHILD_PER_DAY = 2;

export class Operations {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly notifier: Notifier,
    private readonly storage: ObjectStorage,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  // ---- announcements ----------------------------------------------------------------------------

  async createAnnouncement(i: AnnouncementInput, by: string) {
    if (i.scope === "season" && !i.seasonId) fail(400, "bad_request");
    if (i.scope === "server" && !i.serverId) fail(400, "bad_request");
    const [row] = await this.db
      .insert(announcements)
      .values({ scope: i.scope, seasonId: i.seasonId ?? null, serverId: i.serverId ?? null, title: i.title, body: i.body, publishAt: i.publishAt, createdBy: by, createdAt: this.clock.now() })
      .returning();
    await this.publishDue();
    return { announcement: row! };
  }

  async withdraw(id: string) {
    const [row] = await this.db.update(announcements).set({ withdrawnAt: this.clock.now() }).where(and(eq(announcements.id, id), isNull(announcements.sentAt))).returning();
    if (!row) fail(409, "already_sent");
    return { ok: true };
  }

  async listAnnouncements() {
    return { announcements: await this.db.select().from(announcements).orderBy(desc(announcements.publishAt)).limit(200) };
  }

  private async audience(a: typeof announcements.$inferSelect): Promise<string[]> {
    if (a.scope === "server") {
      const rows = await this.db.select({ c: teamMembers.childId }).from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id)).where(and(eq(teams.serverId, a.serverId!), eq(teamMembers.active, true)));
      return rows.map((r) => r.c);
    }
    if (a.scope === "season") {
      const rows = await this.db.select({ c: seasonPlayers.childId }).from(seasonPlayers).where(and(eq(seasonPlayers.seasonId, a.seasonId!), eq(seasonPlayers.status, "enrolled")));
      return rows.map((r) => r.c);
    }
    return (await this.db.select({ id: children.id }).from(children).where(eq(children.status, "active"))).map((r) => r.id);
  }

  /** Worker: announcements whose time has come → message centers. */
  async publishDue(): Promise<number> {
    const due = await this.db
      .select()
      .from(announcements)
      .where(and(isNull(announcements.sentAt), isNull(announcements.withdrawnAt), lte(announcements.publishAt, this.clock.now())));
    for (const a of due) {
      const kids = await this.audience(a);
      await this.notifier.notify({ kind: "announcement", childIds: kids, serverId: a.serverId, title: a.title, body: a.body, link: `/announcements/${a.id}`, dedupeKey: `announcement:${a.id}` });
      await this.db.update(announcements).set({ sentAt: this.clock.now() }).where(eq(announcements.id, a.id));
    }
    return due.length;
  }

  /** What a child can read: published, for everyone, its season or its server. */
  async forChild(childId: string) {
    const seasonsOf = (await this.db.select({ s: seasonPlayers.seasonId }).from(seasonPlayers).where(eq(seasonPlayers.childId, childId))).map((r) => r.s);
    const serversOf = (
      await this.db.select({ s: teams.serverId }).from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id)).where(eq(teamMembers.childId, childId))
    ).map((r) => r.s);
    const rows = await this.db
      .select()
      .from(announcements)
      .where(and(isNull(announcements.withdrawnAt), lte(announcements.publishAt, this.clock.now())))
      .orderBy(desc(announcements.publishAt))
      .limit(100);
    return {
      announcements: rows
        .filter((a) => a.scope === "all" || (a.scope === "season" && seasonsOf.includes(a.seasonId!)) || (a.scope === "server" && serversOf.includes(a.serverId!)))
        .map((a) => ({ id: a.id, title: a.title, body: a.body, publishAt: a.publishAt.toISOString() })),
    };
  }

  // ---- WeChat group QR codes ----------------------------------------------------------------------

  /** Upload ticket for a team's or a camp's QR code (an image). */
  // ---- 手动推送 (part 7 §8) ------------------------------------------------------------------------------

  /**
   * A message from the admins to one team, one server or everyone, now. No
   * app push in v1 (part 8 §1.2), so it goes to the message center only; a
   * child gets at most `MANUAL_PUSH_PER_CHILD_PER_DAY` a day (Beijing date),
   * the others are skipped and counted.
   */
  async push(i: { scope: "team" | "server" | "all"; teamId?: string; serverId?: string; title: string; body: string }, by: string) {
    let kids: string[];
    let serverId: string | null = null;
    if (i.scope === "team") {
      if (!i.teamId) fail(400, "bad_request");
      const [team] = await this.db.select().from(teams).where(eq(teams.id, i.teamId!));
      if (!team) fail(404, "not_found");
      serverId = team!.serverId;
      kids = (await this.db.select({ c: teamMembers.childId }).from(teamMembers).where(and(eq(teamMembers.teamId, i.teamId!), eq(teamMembers.active, true)))).map((r) => r.c);
    } else if (i.scope === "server") {
      if (!i.serverId) fail(400, "bad_request");
      serverId = i.serverId!;
      kids = (await this.db.select({ c: teamMembers.childId }).from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id)).where(and(eq(teams.serverId, i.serverId!), eq(teamMembers.active, true)))).map((r) => r.c);
    } else kids = (await this.db.select({ id: children.id }).from(children).where(eq(children.status, "active"))).map((r) => r.id);
    kids = [...new Set(kids)];
    const now = +this.clock.now();
    const dayStart = new Date(beijingInstant(beijingDate(now), 0));
    const today = kids.length
      ? await this.db
          .select({ r: messages.recipientId })
          .from(messages)
          .where(and(eq(messages.recipientKind, "child"), eq(messages.type, "push"), inArray(messages.recipientId, kids), gte(messages.createdAt, dayStart)))
      : [];
    const count = new Map<string, number>();
    for (const r of today) count.set(r.r, (count.get(r.r) ?? 0) + 1);
    const send = kids.filter((k) => (count.get(k) ?? 0) < MANUAL_PUSH_PER_CHILD_PER_DAY);
    const id = randomUUID();
    const r = await this.notifier.notify({ kind: "push", childIds: send, serverId, title: i.title, body: i.body, link: null, dedupeKey: `push:${id}` });
    return { id, sent: r.messages, skipped: kids.length - send.length, by };
  }

  // ---- 关于与 AI 公示 (part 5 §8; part 7 §8) -----------------------------------------------------------

  async disclosures() {
    const rows = await this.db.select().from(aiDisclosures).orderBy(asc(aiDisclosures.sort), asc(aiDisclosures.purpose));
    return { ai: rows.map((r) => ({ purpose: r.purpose, model: r.model, provider: r.provider, filingNo: r.filingNo, updatedAt: r.updatedAt.toISOString() })) };
  }

  /** Replace the whole list (it is short and edited as one table). */
  async setDisclosures(list: { purpose: string; model: string; provider: string; filingNo?: string | null }[], by: string) {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.delete(aiDisclosures);
      if (list.length) await tx.insert(aiDisclosures).values(list.map((x, i) => ({ purpose: x.purpose, model: x.model, provider: x.provider, filingNo: x.filingNo || null, sort: i, updatedBy: by, updatedAt: now })));
    });
    return this.disclosures();
  }

  async qrTicket(target: { teamId?: string; serverId?: string; camp?: Camp }, contentType: string, size: number) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) fail(400, "file_type");
    if (size > QR_MAX_BYTES) fail(400, "file_too_big");
    const key = `qr/${target.teamId ?? `${target.serverId}-${target.camp}`}/${randomUUID()}`;
    return { key, upload: await this.storage.uploadTicket(key, contentType, size, this.now()) };
  }

  async setTeamQr(teamId: string, key: string, by: string) {
    if (!key.startsWith(`qr/${teamId}/`) || !(await this.storage.head(key))) fail(409, "upload_missing");
    const [row] = await this.db.update(teams).set({ qrImage: key, qrUploadedAt: this.clock.now(), qrRemindedAt: null }).where(eq(teams.id, teamId)).returning();
    if (!row) fail(404, "not_found");
    void by;
    return { ok: true, uploadedAt: row!.qrUploadedAt!.toISOString() };
  }

  async setCampQr(serverId: string, camp: Camp, key: string) {
    if (!key.startsWith(`qr/${serverId}-${camp}/`) || !(await this.storage.head(key))) fail(409, "upload_missing");
    await this.db
      .insert(campQrCodes)
      .values({ serverId, camp, image: key, uploadedAt: this.clock.now() })
      .onConflictDoUpdate({ target: [campQrCodes.serverId, campQrCodes.camp], set: { image: key, uploadedAt: this.clock.now(), remindedAt: null } });
    return { ok: true };
  }

  /** The QR codes this child may see: own team, own camp. */
  async qrFor(ctx: PlayCtx) {
    const now = this.now();
    const [t] = await this.db.select().from(teams).where(eq(teams.id, ctx.teamId));
    const st = await this.store.state(ctx.serverId);
    const camp = st.bigBattle ? campOf(st.bigBattle, ctx.teamId) : null;
    const [c] = camp ? await this.db.select().from(campQrCodes).where(and(eq(campQrCodes.serverId, ctx.serverId), eq(campQrCodes.camp, camp))) : [];
    return {
      team: t?.qrImage ? { url: await this.storage.downloadUrl(t.qrImage, now), uploadedAt: t.qrUploadedAt!.toISOString() } : null,
      camp: c ? { camp, url: await this.storage.downloadUrl(c.image, now), uploadedAt: c.uploadedAt.toISOString() } : null,
    };
  }

  /** Worker: remind the admins 6 days after a QR upload. */
  async qrReminders(): Promise<number> {
    const before = new Date(this.now() - QR_REMIND_AFTER_DAYS * DAY);
    const due = await this.db.select().from(teams).where(and(lte(teams.qrUploadedAt, before), isNull(teams.qrRemindedAt)));
    for (const t of due) {
      await this.notifier.notifyAdmins({
        kind: "qr_expiring",
        title: "微信群二维码快过期了",
        body: `「${t.name}」组的微信群二维码是 ${QR_REMIND_AFTER_DAYS} 天前上传的，明天过期，请上传新的。`,
        link: `/teams/${t.id}`,
        dedupeKey: `qr:${t.id}:${+t.qrUploadedAt!}`,
        roles: ["admin"],
      });
      await this.db.update(teams).set({ qrRemindedAt: this.clock.now() }).where(eq(teams.id, t.id));
    }
    const camps = await this.db.select().from(campQrCodes).where(and(lte(campQrCodes.uploadedAt, before), isNull(campQrCodes.remindedAt)));
    for (const c of camps) {
      await this.notifier.notifyAdmins({
        kind: "qr_expiring",
        title: "阵营微信群二维码快过期了",
        body: `大团战阵营 ${c.camp.toUpperCase()} 的微信群二维码明天过期，请上传新的。`,
        dedupeKey: `qr:${c.serverId}:${c.camp}:${+c.uploadedAt}`,
        roles: ["admin"],
      });
      await this.db.update(campQrCodes).set({ remindedAt: this.clock.now() }).where(eq(campQrCodes.id, c.id));
    }
    return due.length + camps.length;
  }

  // ---- envoys -------------------------------------------------------------------------------------

  async registerEnvoy(ctx: PlayCtx, childId: string) {
    const st = await this.store.state(ctx.serverId);
    const bb = st.bigBattle;
    if (!bb) refuse("not_formed");
    const camp = campOf(bb!, ctx.teamId);
    if (!camp) refuse("not_in_camp");
    const t = st.teams[ctx.teamId]!;
    if (t.leader !== ctx.childId && t.deputy !== ctx.childId) refuse("not_leader");
    if (!t.members.some((m) => m.childId === childId && m.active)) refuse("not_member");
    await this.db
      .insert(envoys)
      .values({ serverId: ctx.serverId, camp: camp!, teamId: ctx.teamId, childId, registeredBy: ctx.childId, at: this.clock.now() })
      .onConflictDoNothing();
    return this.envoysOf(ctx);
  }

  async removeEnvoy(ctx: PlayCtx, childId: string) {
    const st = await this.store.state(ctx.serverId);
    const t = st.teams[ctx.teamId]!;
    if (t.leader !== ctx.childId && t.deputy !== ctx.childId) refuse("not_leader");
    await this.db.delete(envoys).where(and(eq(envoys.serverId, ctx.serverId), eq(envoys.teamId, ctx.teamId), eq(envoys.childId, childId)));
    return this.envoysOf(ctx);
  }

  async envoysOf(ctx: PlayCtx) {
    const st = await this.store.state(ctx.serverId);
    const camp = st.bigBattle ? campOf(st.bigBattle, ctx.teamId) : null;
    if (!camp) return { camp: null, envoys: [] };
    const rows = await this.db.select().from(envoys).where(and(eq(envoys.serverId, ctx.serverId), eq(envoys.camp, camp))).orderBy(asc(envoys.at));
    const kids = rows.length ? await this.db.select({ id: children.id, nickname: children.nickname }).from(children).where(inArray(children.id, rows.map((r) => r.childId))) : [];
    const name = new Map(kids.map((k) => [k.id, k.nickname]));
    return { camp, envoys: rows.map((r) => ({ childId: r.childId, nickname: name.get(r.childId) ?? "", teamId: r.teamId, team: st.teams[r.teamId]?.name ?? "" })) };
  }

  /** Is this child an envoy of the camp? (main-field submissions, part 3 §20.5) */
  async isEnvoy(serverId: string, camp: string, childId: string): Promise<boolean> {
    const [r] = await this.db.select({ id: envoys.id }).from(envoys).where(and(eq(envoys.serverId, serverId), eq(envoys.camp, camp), eq(envoys.childId, childId)));
    return !!r;
  }

  /** Season of a server (admin routes). */
  async serverSeason(serverId: string) {
    const [r] = await this.db.select({ s: seasons }).from(servers).innerJoin(seasons, eq(servers.seasonId, seasons.id)).where(eq(servers.id, serverId));
    return r?.s ?? null;
  }
}
