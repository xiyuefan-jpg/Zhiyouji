/**
 * 作品工坊 (PRD part 5 E4, §3.3): uploads, the material box every member can
 * add to, and the work the leader or deputy assembles and submits before the
 * deadline (each submission is a new version; the last one counts).
 *
 * Work slots of a team:
 * - `contest:<id>` — a contest the team attacks or defends (deadline: day 3 21:00);
 * - `war:<week>` — the weekly war (deadline: Sunday 21:00);
 * - `line` — the team's big-battle line (after the line-up is published);
 * - `main:<camp>` — the camp's main battlefield (any leader or deputy of the camp).
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { files, materials, works, type Db } from "@zhiyouji/db";
import { battleDeadline, campOf, linesPublishedAt, warDeadline, type SeasonState } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import { fail } from "../http/errors.js";
import type { SeasonStore } from "../seasonStore.js";
import type { ObjectStorage } from "../storage.js";
import { refuse, type PlayCtx } from "./play.js";

export type FileKind = "video" | "audio" | "image" | "pdf";
export type MediaKind = "video" | "audio" | "images" | "text";

export interface SlotInfo {
  slot: string;
  kind: "contest" | "war" | "line" | "main";
  /** Prompt id (question bank) the work answers, when known. */
  promptId: string | null;
  deadline: number;
  open: boolean;
  role?: "attacker" | "defender";
}

/** Every slot the team has (open or closed), from the season state. */
export function teamSlots(st: SeasonState, teamId: string, now: number): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (const id of st.contestOrder) {
    const c = st.contests[id]!;
    const role = c.defender === teamId ? "defender" : c.attackers.some((a) => a.teamId === teamId) ? "attacker" : null;
    if (!role || c.status === "cancelled") continue;
    out.push({ slot: `contest:${id}`, kind: "contest", promptId: c.promptId, deadline: c.deadline, open: c.status === "active" && now < c.deadline, role });
  }
  for (const w of Object.values(st.wars).sort((a, b) => a.week - b.week)) {
    if (!w.pairs.some((p) => p.includes(teamId))) continue;
    const deadline = warDeadline(st, w.week);
    out.push({ slot: `war:${w.week}`, kind: "war", promptId: null, deadline, open: !w.settled && now < deadline });
  }
  const bb = st.bigBattle;
  if (bb?.final) {
    const camp = campOf(bb, teamId);
    const deadline = battleDeadline(st);
    const published = now >= linesPublishedAt(st);
    if (camp && bb.final[camp].includes(teamId)) out.push({ slot: "line", kind: "line", promptId: null, deadline, open: published && !bb.settled && now < deadline });
    if (camp) out.push({ slot: `main:${camp}`, kind: "main", promptId: null, deadline, open: published && !bb.settled && now < deadline });
  }
  return out;
}

export class Works {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly cfg: ServerConfig,
    private readonly store: SeasonStore,
    private readonly storage: ObjectStorage,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  // ---- uploads ------------------------------------------------------------------------------

  /** Upload ticket for one file of the team's materials. */
  async requestUpload(ctx: PlayCtx, b: { kind: FileKind; contentType: string; size: number; filename?: string }) {
    const lim = this.cfg.uploads;
    if (!lim.allowedTypes[b.kind].includes(b.contentType)) fail(400, "file_type");
    if (b.size <= 0 || b.size > lim.maxBytes[b.kind]) fail(400, "file_too_big", { maxBytes: lim.maxBytes[b.kind] });
    const key = `works/${ctx.serverId}/${ctx.teamId}/${randomUUID()}`;
    const [row] = await this.db
      .insert(files)
      .values({ serverId: ctx.serverId, teamId: ctx.teamId, childId: ctx.childId, kind: b.kind, contentType: b.contentType, filename: b.filename ?? null, size: b.size, storageKey: key, createdAt: this.clock.now() })
      .returning();
    const ticket = await this.storage.uploadTicket(key, b.contentType, b.size, this.now());
    return { fileId: row!.id, upload: ticket };
  }

  /** The website says the bytes are in storage; the server checks. */
  async completeUpload(ctx: PlayCtx, fileId: string) {
    const [f] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.teamId, ctx.teamId)));
    if (!f) fail(404, "not_found");
    if (f!.status !== "uploading") return { file: this.fileView(f!) };
    const head = await this.storage.head(f!.storageKey);
    if (!head) fail(409, "upload_missing");
    if (head!.size !== f!.size) fail(409, "upload_size");
    const [row] = await this.db.update(files).set({ status: "uploaded", uploadedAt: this.clock.now() }).where(eq(files.id, fileId)).returning();
    return { file: this.fileView(row!) };
  }

  private fileView(f: typeof files.$inferSelect) {
    return { id: f.id, kind: f.kind, contentType: f.contentType, filename: f.filename, size: f.size, status: f.status, uploadedBy: f.childId, createdAt: f.createdAt.toISOString() };
  }

  async fileUrl(ctx: PlayCtx, fileId: string) {
    const [f] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.teamId, ctx.teamId)));
    if (!f || f.status === "uploading") fail(404, "not_found");
    return { url: await this.storage.downloadUrl(f!.storageKey, this.now()) };
  }

  // ---- slots and materials ------------------------------------------------------------------------

  async slots(ctx: PlayCtx) {
    const st = await this.store.state(ctx.serverId);
    const slots = teamSlots(st, ctx.teamId, this.now());
    const latest = await this.latestVersions(ctx.serverId, ctx.teamId, slots.map((s) => s.slot));
    return { slots: slots.map((s) => ({ ...s, submitted: latest.get(s.slot) ?? null })) };
  }

  private async latestVersions(serverId: string, teamId: string, slots: string[]) {
    const out = new Map<string, { version: number; at: string; by: string }>();
    if (slots.length === 0) return out;
    const rows = await this.db
      .select()
      .from(works)
      .where(and(eq(works.serverId, serverId), eq(works.teamId, teamId), inArray(works.slot, slots)))
      .orderBy(asc(works.version));
    for (const r of rows) out.set(r.slot, { version: r.version, at: r.submittedAt.toISOString(), by: r.submittedBy });
    return out;
  }

  private async slotOf(ctx: PlayCtx, slot: string): Promise<SlotInfo> {
    const st = await this.store.state(ctx.serverId);
    const s = teamSlots(st, ctx.teamId, this.now()).find((x) => x.slot === slot);
    if (!s) fail(404, "no_slot");
    return s!;
  }

  async addMaterial(ctx: PlayCtx, slot: string, b: { fileId?: string; text?: string }) {
    const s = await this.slotOf(ctx, slot);
    if (!s.open) refuse("too_late");
    if (!b.fileId && !b.text?.trim()) fail(400, "bad_request");
    if (b.fileId) {
      const [f] = await this.db.select().from(files).where(and(eq(files.id, b.fileId), eq(files.teamId, ctx.teamId)));
      if (!f || f.status === "uploading") fail(409, "upload_missing");
    }
    const [row] = await this.db
      .insert(materials)
      .values({ serverId: ctx.serverId, teamId: ctx.teamId, slot, fileId: b.fileId ?? null, text: b.text?.trim() || null, addedBy: ctx.childId, createdAt: this.clock.now() })
      .returning();
    return { material: { id: row!.id, fileId: row!.fileId, text: row!.text, addedBy: row!.addedBy, createdAt: row!.createdAt.toISOString() } };
  }

  async listMaterials(ctx: PlayCtx, slot: string) {
    await this.slotOf(ctx, slot);
    const rows = await this.db
      .select({ m: materials, f: files })
      .from(materials)
      .leftJoin(files, eq(materials.fileId, files.id))
      .where(and(eq(materials.serverId, ctx.serverId), eq(materials.teamId, ctx.teamId), eq(materials.slot, slot), isNull(materials.removedAt)))
      .orderBy(asc(materials.createdAt));
    return {
      materials: rows.map((r) => ({
        id: r.m.id,
        text: r.m.text,
        addedBy: r.m.addedBy,
        createdAt: r.m.createdAt.toISOString(),
        file: r.f ? this.fileView(r.f) : null,
      })),
    };
  }

  /** Whoever added it, or the leader / deputy, can take it out (the file stays stored). */
  async removeMaterial(ctx: PlayCtx, id: string) {
    const [m] = await this.db.select().from(materials).where(and(eq(materials.id, id), eq(materials.teamId, ctx.teamId), isNull(materials.removedAt)));
    if (!m) fail(404, "not_found");
    const st = await this.store.state(ctx.serverId);
    const t = st.teams[ctx.teamId]!;
    if (m!.addedBy !== ctx.childId && t.leader !== ctx.childId && t.deputy !== ctx.childId) refuse("not_leader");
    await this.db.update(materials).set({ removedAt: this.clock.now() }).where(eq(materials.id, id));
    return { ok: true };
  }

  // ---- submitting -------------------------------------------------------------------------------------

  async submit(
    ctx: PlayCtx,
    slot: string,
    b: { mediaKind: MediaKind; fileIds: string[]; text?: string; aiNote?: string; members: string[] },
  ) {
    const st = await this.store.state(ctx.serverId);
    const s = teamSlots(st, ctx.teamId, this.now()).find((x) => x.slot === slot);
    if (!s) fail(404, "no_slot");
    if (!s!.open) refuse(this.now() >= s!.deadline ? "too_late" : "too_early");
    const t = st.teams[ctx.teamId]!;
    const me = t.members.find((m) => m.childId === ctx.childId);
    if (!me?.active) fail(403, "withdrawn");
    if (t.leader !== ctx.childId && t.deputy !== ctx.childId) refuse("not_leader");

    const ids = [...new Set(b.fileIds)];
    const fs = ids.length ? await this.db.select().from(files).where(and(inArray(files.id, ids), eq(files.teamId, ctx.teamId))) : [];
    if (fs.length !== ids.length || fs.some((f) => f.status === "uploading")) fail(409, "upload_missing");
    const want: Record<MediaKind, FileKind[]> = { video: ["video"], audio: ["audio"], images: ["image", "pdf"], text: [] };
    if (fs.some((f) => !want[b.mediaKind].includes(f.kind as FileKind))) fail(400, "media_mismatch");
    if (b.mediaKind === "text" && !b.text?.trim()) fail(400, "work_empty");
    if (b.mediaKind !== "text" && fs.length === 0) fail(400, "work_empty");
    if (b.mediaKind === "images" && fs.length > this.cfg.uploads.maxImages) fail(400, "too_many_images");
    const active = new Set(t.members.filter((m) => m.active).map((m) => m.childId));
    const members = [...new Set(b.members)];
    if (members.length === 0 || members.some((m) => !active.has(m))) fail(400, "bad_members");

    const [last] = await this.db
      .select({ version: works.version })
      .from(works)
      .where(and(eq(works.serverId, ctx.serverId), eq(works.teamId, ctx.teamId), eq(works.slot, slot)))
      .orderBy(desc(works.version))
      .limit(1);
    const [row] = await this.db
      .insert(works)
      .values({
        serverId: ctx.serverId,
        teamId: ctx.teamId,
        kind: s!.kind,
        slot,
        promptId: s!.promptId,
        version: (last?.version ?? 0) + 1,
        submittedBy: ctx.childId,
        submittedAt: this.clock.now(),
        mediaKind: b.mediaKind,
        fileIds: ids,
        text: b.text?.trim() || null,
        aiNote: b.aiNote?.trim() || null,
        members,
      })
      .returning();
    return { work: this.workView(row!) };
  }

  workView(w: typeof works.$inferSelect) {
    return {
      id: w.id,
      slot: w.slot,
      kind: w.kind,
      version: w.version,
      submittedBy: w.submittedBy,
      submittedAt: w.submittedAt.toISOString(),
      mediaKind: w.mediaKind,
      fileIds: w.fileIds as string[],
      text: w.text,
      aiNote: w.aiNote,
      members: w.members as string[],
    };
  }

  /** Every version the team submitted for a slot, newest first. */
  async versions(ctx: PlayCtx, slot: string) {
    const rows = await this.db
      .select()
      .from(works)
      .where(and(eq(works.serverId, ctx.serverId), eq(works.teamId, ctx.teamId), eq(works.slot, slot)))
      .orderBy(desc(works.version));
    return { works: rows.map((w) => this.workView(w)) };
  }

  /** The counting version of each team for a slot (main battlefield: the camp's latest across its teams). */
  async finalWorks(serverId: string, slot: string) {
    const rows = await this.db.select().from(works).where(and(eq(works.serverId, serverId), eq(works.slot, slot))).orderBy(asc(works.submittedAt), asc(works.version));
    const byTeam = new Map<string, typeof works.$inferSelect>();
    for (const r of rows) byTeam.set(r.teamId, r);
    return [...byTeam.values()];
  }
}
