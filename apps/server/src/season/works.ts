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
import type { Debates } from "./debates.js";
import type { Operations } from "./operations.js";
import { rubricWithGuide, workRequirements } from "./rubrics.js";
import { workRubric, workTask } from "./taskInfo.js";

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
  /** Debate lands: the opening (立论) and the rebuttal (驳论, the slot that is scored). */
  stage?: "opening" | "rebuttal";
}

/** Bytes the n-th part (1-based) of a multipart upload must have. */
export function expectedPartSize(size: number, partSize: number, n: number): number {
  return Math.max(0, Math.min(partSize, size - (n - 1) * partSize));
}

/** Hard length limit of one file of this kind (null: no length, e.g. images). */
export function mediaMaxSec(cfg: ServerConfig, kind: FileKind): number | null {
  return kind === "video" || kind === "audio" ? cfg.uploads.maxDurationSec[kind] : null;
}

/**
 * Content-rule reminders for the submit page (content library §2, part 3 §20.6):
 * videos and audio ≤5 minutes in all, debate openings ≤3, rebuttals ≤2.
 * Longer works are accepted; the team just sees the reminder.
 */
export function lengthWarnings(cfg: ServerConfig, slot: Pick<SlotInfo, "stage">, fs: { kind: string; durationSec: number | null }[]): string[] {
  const timed = fs.filter((f) => (f.kind === "video" || f.kind === "audio") && f.durationSec !== null);
  if (timed.length === 0) return [];
  const total = timed.reduce((a, f) => a + f.durationSec!, 0);
  const c = cfg.uploads.contentSec;
  const limit = slot.stage === "opening" ? c.opening : slot.stage === "rebuttal" ? c.rebuttal : c.work;
  if (total <= limit + cfg.uploads.durationGraceSec) return [];
  const what = slot.stage === "opening" ? "立论" : slot.stage === "rebuttal" ? "驳论" : "作品";
  return [`${what}的内容要求是不超过 ${limit / 60} 分钟，这次交的有 ${minutesText(total)}。已经交上去了（照样有效）；如果来得及，剪短一点更容易讲清楚。`];
}

function minutesText(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return m === 0 ? `${r} 秒` : r === 0 ? `${m} 分钟` : `${m} 分 ${r} 秒`;
}

export type DebateDeadlines = ReadonlyMap<string, { openingDeadline: number; noDefender?: boolean }>;

/** Every slot the team has (open or closed), from the season state. */
export function teamSlots(st: SeasonState, teamId: string, now: number, debates: DebateDeadlines = new Map()): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (const id of st.contestOrder) {
    const c = st.contests[id]!;
    const role = c.defender === teamId ? "defender" : c.attackers.some((a) => a.teamId === teamId) ? "attacker" : null;
    if (!role || c.status === "cancelled") continue;
    const active = c.status === "active";
    const d = debates.get(id);
    if (d) {
      out.push({ slot: `contest:${id}:open`, kind: "contest", promptId: c.promptId, deadline: d.openingDeadline, open: active && now < d.openingDeadline, role, stage: "opening" });
      // §10.4: a defender who handed in no opening did not take up the debate — no rebuttal either
      const declined = role === "defender" && !!d.noDefender;
      out.push({ slot: `contest:${id}`, kind: "contest", promptId: c.promptId, deadline: c.deadline, open: active && !declined && now >= d.openingDeadline && now < c.deadline, role, stage: "rebuttal" });
    } else out.push({ slot: `contest:${id}`, kind: "contest", promptId: c.promptId, deadline: c.deadline, open: active && now < c.deadline, role });
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
    private readonly debates?: Debates,
    private readonly ops?: Operations,
  ) {}

  private now(): number {
    return +this.clock.now();
  }

  private async slotsOf(serverId: string, st: SeasonState, teamId: string): Promise<SlotInfo[]> {
    const d = this.debates ? await this.debates.openingDeadlines(serverId) : new Map();
    return teamSlots(st, teamId, this.now(), d);
  }

  // ---- uploads ------------------------------------------------------------------------------

  /** Upload ticket for one file of the team's materials. */
  async requestUpload(ctx: PlayCtx, b: { kind: FileKind; contentType: string; size: number; filename?: string; durationSec?: number }) {
    const lim = this.cfg.uploads;
    if (!lim.allowedTypes[b.kind].includes(b.contentType)) fail(400, "file_type");
    if (b.size <= 0 || b.size > lim.maxBytes[b.kind]) fail(400, "file_too_big", { maxBytes: lim.maxBytes[b.kind] });
    const maxSec = mediaMaxSec(this.cfg, b.kind);
    if (maxSec !== null && b.durationSec !== undefined && b.durationSec > maxSec + lim.durationGraceSec) fail(400, "file_too_long", { maxSec });
    const key = `works/${ctx.serverId}/${ctx.teamId}/${randomUUID()}`;
    const [row] = await this.db
      .insert(files)
      .values({
        serverId: ctx.serverId,
        teamId: ctx.teamId,
        childId: ctx.childId,
        kind: b.kind,
        contentType: b.contentType,
        filename: b.filename ?? null,
        size: b.size,
        storageKey: key,
        // What the browser measured; the speech-to-text service later writes the real length.
        durationSec: maxSec !== null && b.durationSec !== undefined ? Math.round(b.durationSec) : null,
        createdAt: this.clock.now(),
      })
      .returning();
    // Big files go up in parts that can resume (part 2 §4.5, part 5 §5).
    const mp = lim.multipart;
    if (b.size > mp.from) {
      const { uploadId } = await this.storage.startMultipart(key, b.contentType);
      await this.db.update(files).set({ multipartId: uploadId, partSize: mp.partSize }).where(eq(files.id, row!.id));
      return { fileId: row!.id, multipart: { partSize: mp.partSize, parts: Math.ceil(b.size / mp.partSize) } };
    }
    const ticket = await this.storage.uploadTicket(key, b.contentType, b.size, this.now());
    return { fileId: row!.id, upload: ticket };
  }

  private async multipartFile(ctx: PlayCtx, fileId: string) {
    const [f] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.teamId, ctx.teamId)));
    if (!f) fail(404, "not_found");
    if (!f!.multipartId || !f!.partSize) fail(400, "bad_request");
    return { f: f!, uploadId: f!.multipartId!, partSize: f!.partSize!, parts: Math.ceil(f!.size / f!.partSize!) };
  }

  /** Which parts storage already has: a resumed upload sends only the rest. */
  async uploadProgress(ctx: PlayCtx, fileId: string) {
    const m = await this.multipartFile(ctx, fileId);
    if (m.f.status !== "uploading") return { partSize: m.partSize, parts: m.parts, done: Array.from({ length: m.parts }, (_, i) => i + 1), complete: true };
    const have = await this.storage.listParts(m.f.storageKey, m.uploadId);
    const done = have.filter((p) => p.size === expectedPartSize(m.f.size, m.partSize, p.partNumber)).map((p) => p.partNumber);
    return { partSize: m.partSize, parts: m.parts, done, complete: false };
  }

  /** Signed URLs for some parts. */
  async partTickets(ctx: PlayCtx, fileId: string, partNumbers: number[]) {
    const m = await this.multipartFile(ctx, fileId);
    if (m.f.status !== "uploading") fail(409, "already_uploaded");
    if (partNumbers.some((n) => n > m.parts)) fail(400, "bad_request");
    const now = this.now();
    return { parts: await Promise.all([...new Set(partNumbers)].map(async (partNumber) => ({ partNumber, ...(await this.storage.partTicket(m.f.storageKey, m.uploadId, partNumber, now)) }))) };
  }

  /** The website says the bytes are in storage; the server checks. */
  async completeUpload(ctx: PlayCtx, fileId: string) {
    const [f] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.teamId, ctx.teamId)));
    if (!f) fail(404, "not_found");
    if (f!.status !== "uploading") return { file: this.fileView(f!) };
    if (f!.multipartId && f!.partSize) {
      const parts = Math.ceil(f!.size / f!.partSize);
      const have = new Map((await this.storage.listParts(f!.storageKey, f!.multipartId)).map((p) => [p.partNumber, p.size]));
      const missing = Array.from({ length: parts }, (_, i) => i + 1).filter((n) => have.get(n) !== expectedPartSize(f!.size, f!.partSize!, n));
      if (missing.length > 0) fail(409, "upload_missing", { missing });
      await this.storage.completeMultipart(f!.storageKey, f!.multipartId, parts);
    }
    const head = await this.storage.head(f!.storageKey);
    if (!head) fail(409, "upload_missing");
    if (head!.size !== f!.size) fail(409, "upload_size");
    const [row] = await this.db.update(files).set({ status: "uploaded", uploadedAt: this.clock.now() }).where(eq(files.id, fileId)).returning();
    return { file: this.fileView(row!) };
  }

  private fileView(f: typeof files.$inferSelect) {
    return {
      id: f.id,
      kind: f.kind,
      contentType: f.contentType,
      filename: f.filename,
      size: f.size,
      durationSec: f.durationSec,
      status: f.status,
      uploadedBy: f.childId,
      createdAt: f.createdAt.toISOString(),
    };
  }

  async fileUrl(ctx: PlayCtx, fileId: string) {
    const [f] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.teamId, ctx.teamId)));
    if (!f || f.status === "uploading") fail(404, "not_found");
    return { url: await this.storage.downloadUrl(f!.storageKey, this.now()) };
  }

  // ---- slots and materials ------------------------------------------------------------------------

  /** What a slot asks for, how it is judged and what to hand in (shown in the workshop before making it). */
  async task(ctx: PlayCtx, slot: string) {
    const st = await this.store.state(ctx.serverId);
    const s = (await this.slotsOf(ctx.serverId, st, ctx.teamId)).find((x) => x.slot === slot);
    if (!s) fail(404, "not_found");
    const w = { kind: s!.kind, slot, teamId: ctx.teamId };
    return {
      task: await workTask(this.db, ctx.serverId, st, w),
      rubric: rubricWithGuide(await workRubric(this.db, ctx.serverId, st, w)),
      requirements: workRequirements(s!.kind, s!.stage ?? null),
    };
  }

  async slots(ctx: PlayCtx) {
    const st = await this.store.state(ctx.serverId);
    const slots = await this.slotsOf(ctx.serverId, st, ctx.teamId);
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
    const s = (await this.slotsOf(ctx.serverId, st, ctx.teamId)).find((x) => x.slot === slot);
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
    const s = (await this.slotsOf(ctx.serverId, st, ctx.teamId)).find((x) => x.slot === slot);
    if (!s) fail(404, "no_slot");
    if (!s!.open) refuse(this.now() >= s!.deadline ? "too_late" : "too_early");
    const t = st.teams[ctx.teamId]!;
    const me = t.members.find((m) => m.childId === ctx.childId);
    if (!me?.active) fail(403, "withdrawn");
    // The main field: also the camp's registered envoys (part 3 §20.5).
    const envoy = s!.kind === "main" && !!this.ops && (await this.ops.isEnvoy(ctx.serverId, slot.slice(5), ctx.childId));
    if (t.leader !== ctx.childId && t.deputy !== ctx.childId && !envoy) refuse("not_leader");

    const ids = [...new Set(b.fileIds)];
    const fs = ids.length ? await this.db.select().from(files).where(and(inArray(files.id, ids), eq(files.teamId, ctx.teamId))) : [];
    if (fs.length !== ids.length || fs.some((f) => f.status === "uploading")) fail(409, "upload_missing");
    const want: Record<MediaKind, FileKind[]> = { video: ["video"], audio: ["audio"], images: ["image", "pdf"], text: [] };
    if (fs.some((f) => !want[b.mediaKind].includes(f.kind as FileKind))) fail(400, "media_mismatch");
    if (b.mediaKind === "text" && !b.text?.trim()) fail(400, "work_empty");
    if (b.mediaKind !== "text" && fs.length === 0) fail(400, "work_empty");
    if (b.mediaKind === "images" && fs.length > this.cfg.uploads.maxImages) fail(400, "too_many_images");
    // Hard length limit (part 3 §20.6): a file known to be longer is refused; the content rule only warns.
    for (const f of fs) {
      const maxSec = mediaMaxSec(this.cfg, f.kind as FileKind);
      if (maxSec !== null && f.durationSec !== null && f.durationSec > maxSec + this.cfg.uploads.durationGraceSec) fail(400, "file_too_long", { fileId: f.id, maxSec });
    }
    const warnings = lengthWarnings(this.cfg, s!, fs);
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
    return { work: this.workView(row!), warnings };
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
