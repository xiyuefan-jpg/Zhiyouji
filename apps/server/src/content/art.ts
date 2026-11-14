/**
 * 美术资源 (PRD part 5 §7 "v1 的插画先用 AI 生成初稿、人工挑选，以后由孩子们的作品替换";
 * part 7 §8 "每个资源位的当前图片；上传新图、填写作者、启用"): slots for the map,
 * the 12 lands, the items, team badges, avatars, 土地公 and the splash screen.
 * Upload with a ticket (straight to storage), then save with the author;
 * enabling one makes it the slot's live image. The website reads the live
 * images and the authors (关于 page).
 */

import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { artAssets, type Db } from "@zhiyouji/db";
import { ITEMS } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { ObjectStorage } from "../storage.js";
import { DEFAULT_LAND_TEMPLATES } from "./questionBank.js";

const ART_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const ART_MAX_BYTES = 8 * 1024 * 1024;
const AVATARS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"];

/** Every slot with its Chinese name, grouped as the console shows them. */
export function artSlots(): { slot: string; name: string; group: string }[] {
  return [
    { slot: "map", name: "赛季地图", group: "地图" },
    { slot: "splash", name: "开屏", group: "其他" },
    { slot: "tudigong", name: "土地公", group: "其他" },
    ...DEFAULT_LAND_TEMPLATES.map((l) => ({ slot: `land:${l.name}`, name: l.name, group: "地块" })),
    ...ITEMS.map((i) => ({ slot: `item:${i.id}`, name: i.name, group: "法宝" })),
    ...Array.from({ length: 8 }, (_, i) => ({ slot: `badge:${i + 1}`, name: `组徽 ${i + 1}`, group: "组徽" })),
    ...AVATARS.map((a, i) => ({ slot: `avatar:${a}`, name: `头像 ${i + 1}`, group: "头像" })),
  ];
}

export class Art {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly storage: ObjectStorage,
  ) {}

  private known(slot: string) {
    if (!artSlots().some((s) => s.slot === slot)) fail(400, "bad_request", { message: "没有这个资源位" });
  }

  async ticket(slot: string, contentType: string, size: number) {
    this.known(slot);
    if (!ART_TYPES.includes(contentType)) fail(400, "file_type");
    if (size > ART_MAX_BYTES) fail(400, "file_too_big");
    const key = `art/${slot.replace(/[^a-z0-9]+/gi, "_")}/${randomUUID()}`;
    return { key, upload: await this.storage.uploadTicket(key, contentType, size, +this.clock.now()) };
  }

  /** After the upload: keep it with its author; `live` makes it the slot's image now. */
  async save(i: { slot: string; key: string; contentType: string; author: string; note?: string | null; live?: boolean }, by: string) {
    this.known(i.slot);
    if (!i.key.startsWith(`art/${i.slot.replace(/[^a-z0-9]+/gi, "_")}/`) || !(await this.storage.head(i.key))) fail(409, "upload_missing");
    const [row] = await this.db
      .insert(artAssets)
      .values({ slot: i.slot, storageKey: i.key, contentType: i.contentType, author: i.author, note: i.note ?? null, live: false, uploadedBy: by, uploadedAt: this.clock.now() })
      .returning();
    if (i.live) await this.enable(row!.id);
    return { id: row!.id };
  }

  /** Make one upload its slot's live image (the others of the slot stop being live). */
  async enable(id: string) {
    const [row] = await this.db.select().from(artAssets).where(eq(artAssets.id, id));
    if (!row) fail(404, "not_found");
    await this.db.transaction(async (tx) => {
      await tx.update(artAssets).set({ live: false }).where(eq(artAssets.slot, row!.slot));
      await tx.update(artAssets).set({ live: true }).where(eq(artAssets.id, id));
    });
    return { ok: true };
  }

  /** Back to no image (the website's built-in look). */
  async disable(slot: string) {
    this.known(slot);
    await this.db.update(artAssets).set({ live: false }).where(eq(artAssets.slot, slot));
    return { ok: true };
  }

  /** Admin console: every slot, its live image and all uploads. */
  async list() {
    const now = +this.clock.now();
    const rows = await this.db.select().from(artAssets).orderBy(desc(artAssets.uploadedAt));
    return {
      slots: await Promise.all(
        artSlots().map(async (s) => {
          const mine = rows.filter((r) => r.slot === s.slot);
          return {
            ...s,
            uploads: await Promise.all(mine.map(async (r) => ({ id: r.id, author: r.author, note: r.note, live: r.live, uploadedAt: r.uploadedAt.toISOString(), url: await this.storage.downloadUrl(r.storageKey, now) }))),
          };
        }),
      ),
    };
  }

  /** Website: the live images and the authors to credit. */
  async live() {
    const now = +this.clock.now();
    const rows = await this.db.select().from(artAssets).where(eq(artAssets.live, true)).orderBy(asc(artAssets.slot));
    const names = new Map(artSlots().map((s) => [s.slot, s.name]));
    return {
      images: Object.fromEntries(await Promise.all(rows.map(async (r) => [r.slot, await this.storage.downloadUrl(r.storageKey, now)] as const))),
      authors: [...new Set(rows.map((r) => r.author))].map((author) => ({ author, works: rows.filter((r) => r.author === author).map((r) => names.get(r.slot) ?? r.slot) })),
    };
  }
}
