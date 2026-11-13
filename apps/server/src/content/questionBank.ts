/**
 * 题库 (PRD part 4 §3; part 7 §4; content library §4, §12):
 * - 12 land templates (reused every season) and prompts of every category,
 *   each draft / enabled / disabled; admins add, edit, disable and import in bulk;
 * - confirming a grouping maps the templates to the lands (edge → E1…E8,
 *   center → C1…C4) and hands the enabled prompts to the engine;
 * - enabling or disabling a land prompt later updates every running server
 *   (engine `set_land_prompts`; drawn prompts stay used);
 * - fewer than 2 enabled-and-unused prompts on a land → the admins are told.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { landTemplates, lands, opLog, prompts, seasons, servers, type Db } from "@zhiyouji/db";
import type { SeasonState } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import { LIVE_SEASON_STATES } from "../worker.js";

/** Content library 4.0. Center lands are still 【待定】 (AI drafts). */
export const DEFAULT_LAND_TEMPLATES = [
  { name: "大唐长安城", kind: "edge", subject: "语文与文学", rubric: "B", questionType: "主题思辨；作品的现实意义", status: "enabled" },
  { name: "五行山", kind: "edge", subject: "数学", rubric: "A", questionType: "生活场景里的数学", status: "enabled" },
  { name: "火焰山", kind: "edge", subject: "物理", rubric: "A", questionType: "现象解释；AI 视频找物理错误", status: "enabled" },
  { name: "兜率宫", kind: "edge", subject: "化学", rubric: "A", questionType: "现象解释", status: "enabled" },
  { name: "五庄观", kind: "edge", subject: "生物", rubric: "A", questionType: "现象解释", status: "enabled" },
  { name: "通天河", kind: "edge", subject: "地理", rubric: "A", questionType: "现象解释", status: "enabled" },
  { name: "朱紫国", kind: "edge", subject: "历史", rubric: "B", questionType: "异步辩论", status: "enabled" },
  { name: "车迟国", kind: "edge", subject: "政治与国际关系", rubric: "B", questionType: "异步辩论", status: "enabled" },
  { name: "谛听台", kind: "center", subject: "AI / 人机协作", rubric: "E", questionType: "让 AI 做事，再当它的考官", status: "pending" },
  { name: "小雷音寺", kind: "center", subject: "科学探究", rubric: "D", questionType: "用实验检验一个流行说法", status: "pending" },
  { name: "盘丝洞", kind: "center", subject: "媒介与信息", rubric: "B", questionType: "拆解一个真实的网络内容", status: "pending" },
  { name: "女儿国", kind: "center", subject: "商业与经济", rubric: "C", questionType: "拆解或改进一个真实的生意", status: "pending" },
] as const;

export const DEFAULT_AUDIENCE = "一个没学过这个知识的初中生或普通成年人";

export interface PromptInput {
  category: "land" | "war_theme" | "supply" | "battle_line" | "battle_main";
  landTemplateId?: string | null;
  questionType?: string | null;
  title: string;
  body: string;
  audience?: string | null;
  rubric?: string | null;
  status?: "draft" | "enabled" | "disabled";
  todo?: boolean;
}

type PromptRow = typeof prompts.$inferSelect;

export class QuestionBank {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly notifier: Notifier,
  ) {}

  private async log(by: string, action: string, object: string, before: unknown, after: unknown) {
    await this.db.insert(opLog).values({ actor: by, action, object, before: before ?? null, after: after ?? null, at: this.clock.now() });
  }

  // ---- land templates ---------------------------------------------------------------------------

  async seedDefaults(by: string) {
    const have = new Set((await this.db.select({ name: landTemplates.name }).from(landTemplates)).map((r) => r.name));
    const missing = DEFAULT_LAND_TEMPLATES.map((t, i) => ({ ...t, sort: i, defaultAudience: DEFAULT_AUDIENCE })).filter((t) => !have.has(t.name));
    if (missing.length) await this.db.insert(landTemplates).values(missing);
    if (missing.length) await this.log(by, "land_templates_seed", "land_templates", null, { added: missing.map((m) => m.name) });
    return this.templates();
  }

  async templates() {
    const rows = await this.db.select().from(landTemplates).orderBy(asc(landTemplates.sort), asc(landTemplates.name));
    const counts = await this.db.select({ t: prompts.landTemplateId, s: prompts.status }).from(prompts).where(eq(prompts.category, "land"));
    return {
      templates: rows.map((r) => ({
        ...r,
        prompts: { enabled: counts.filter((c) => c.t === r.id && c.s === "enabled").length, total: counts.filter((c) => c.t === r.id).length },
      })),
    };
  }

  async updateTemplate(id: string, patch: Partial<{ name: string; subject: string; rubric: string; questionType: string; defaultAudience: string | null; juniorHint: string | null; status: string; sort: number }>, by: string) {
    const [before] = await this.db.select().from(landTemplates).where(eq(landTemplates.id, id));
    if (!before) fail(404, "not_found");
    const [row] = await this.db.update(landTemplates).set(patch).where(eq(landTemplates.id, id)).returning();
    await this.log(by, "land_template_update", `land_template:${id}`, before, patch);
    return { template: row! };
  }

  /** Land code → template, names and enabled prompts for a new server (edge in order → E1…, center → C1…). */
  async defaultMapping(edges: number, centers: number) {
    const rows = await this.db.select().from(landTemplates).orderBy(asc(landTemplates.sort), asc(landTemplates.name));
    const edge = rows.filter((r) => r.kind === "edge").slice(0, edges);
    const center = rows.filter((r) => r.kind === "center").slice(0, centers);
    const map: { code: string; templateId: string; name: string }[] = [
      ...edge.map((t, i) => ({ code: `E${i + 1}`, templateId: t.id, name: t.name })),
      ...center.map((t, i) => ({ code: `C${i + 1}`, templateId: t.id, name: t.name })),
    ];
    const ids = map.map((m) => m.templateId);
    const enabled = ids.length
      ? await this.db
          .select({ id: prompts.id, t: prompts.landTemplateId })
          .from(prompts)
          .where(and(eq(prompts.category, "land"), eq(prompts.status, "enabled"), inArray(prompts.landTemplateId, ids)))
      : [];
    return {
      landNames: Object.fromEntries(map.map((m) => [m.code, m.name])),
      landTemplates: Object.fromEntries(map.map((m) => [m.code, m.templateId])),
      prompts: Object.fromEntries(map.map((m) => [m.code, enabled.filter((p) => p.t === m.templateId).map((p) => p.id)])),
    };
  }

  // ---- prompts --------------------------------------------------------------------------------------

  async list(f: { category?: string; landTemplateId?: string; status?: string }) {
    const conds = [];
    if (f.category) conds.push(eq(prompts.category, f.category));
    if (f.landTemplateId) conds.push(eq(prompts.landTemplateId, f.landTemplateId));
    if (f.status) conds.push(eq(prompts.status, f.status));
    const rows = await this.db.select().from(prompts).where(conds.length ? and(...conds) : undefined).orderBy(asc(prompts.createdAt));
    return { prompts: rows.map((r) => this.view(r)) };
  }

  view(r: PromptRow) {
    return { ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
  }

  async create(i: PromptInput, by: string) {
    const row = await this.createRaw(i, by);
    await this.log(by, "prompt_create", `prompt:${row.id}`, null, { title: i.title, status: row.status });
    if (row.status === "enabled" && row.landTemplateId) await this.syncTemplate(row.landTemplateId);
    return { prompt: this.view(row) };
  }

  /** 表格批量导入: many at once (the admin console turns a sheet into this list). */
  async importMany(items: PromptInput[], by: string) {
    const out = [];
    const touched = new Set<string>();
    for (const i of items) {
      const r = await this.createRaw(i, by);
      out.push(r);
      if (r.status === "enabled" && r.landTemplateId) touched.add(r.landTemplateId);
    }
    for (const t of touched) await this.syncTemplate(t);
    await this.log(by, "prompt_import", "prompts", null, { count: out.length });
    return { imported: out.length };
  }

  private async createRaw(i: PromptInput, by: string) {
    if (i.category === "land" && !i.landTemplateId) fail(400, "bad_request");
    const now = this.clock.now();
    const [row] = await this.db
      .insert(prompts)
      .values({
        category: i.category,
        landTemplateId: i.landTemplateId ?? null,
        questionType: i.questionType ?? null,
        title: i.title,
        body: i.body,
        audience: i.audience ?? (i.category === "land" ? DEFAULT_AUDIENCE : null),
        rubric: i.rubric ?? null,
        status: i.status ?? "draft",
        todo: i.todo ?? false,
        createdBy: by,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row!;
  }

  async update(id: string, patch: Partial<PromptInput>, by: string) {
    const [before] = await this.db.select().from(prompts).where(eq(prompts.id, id));
    if (!before) fail(404, "not_found");
    const [row] = await this.db
      .update(prompts)
      .set({ ...patch, updatedAt: this.clock.now() })
      .where(eq(prompts.id, id))
      .returning();
    await this.log(by, "prompt_update", `prompt:${id}`, { status: before!.status, title: before!.title }, patch);
    for (const t of new Set([before!.landTemplateId, row!.landTemplateId])) if (t) await this.syncTemplate(t);
    return { prompt: this.view(row!) };
  }

  /** Push the enabled prompts of a template to every live server's land made from it. */
  async syncTemplate(templateId: string): Promise<number> {
    const enabled = (
      await this.db
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.category, "land"), eq(prompts.status, "enabled"), eq(prompts.landTemplateId, templateId)))
    ).map((r) => r.id);
    const rows = await this.db
      .select({ serverId: lands.serverId, code: lands.code })
      .from(lands)
      .innerJoin(servers, eq(lands.serverId, servers.id))
      .innerJoin(seasons, eq(servers.seasonId, seasons.id))
      .where(and(eq(lands.templateId, templateId), inArray(seasons.status, LIVE_SEASON_STATES)));
    for (const r of rows) await this.store.apply(r.serverId, { type: "set_land_prompts", landId: r.code, promptIds: enabled, at: +this.clock.now() }, "system");
    return rows.length;
  }

  /** Lands with fewer than `min` enabled prompts not yet drawn this season (part 7 §1 题库不足). */
  static lowStock(st: SeasonState, min = 2): { landId: string; available: number }[] {
    return st.landOrder
      .map((landId) => {
        const used = st.usedPrompts[landId] ?? [];
        return { landId, available: (st.prompts[landId] ?? []).filter((q) => !used.includes(q)).length };
      })
      .filter((x) => x.available < min);
  }

  async lowStockAll() {
    const live = await this.db
      .select({ id: servers.id, name: servers.name })
      .from(servers)
      .innerJoin(seasons, eq(servers.seasonId, seasons.id))
      .where(inArray(seasons.status, LIVE_SEASON_STATES));
    const out = [];
    for (const s of live) {
      const st = await this.store.state(s.id);
      const names = new Map((await this.db.select().from(lands).where(eq(lands.serverId, s.id))).map((l) => [l.code, l.name]));
      for (const x of QuestionBank.lowStock(st)) out.push({ serverId: s.id, server: s.name, landId: x.landId, land: names.get(x.landId) ?? x.landId, available: x.available });
    }
    return { lands: out };
  }

  /** After a draw: tell the admins when a land is running out. */
  async checkAfterDraw(serverId: string, st: SeasonState, landId: string): Promise<void> {
    const low = QuestionBank.lowStock(st).find((x) => x.landId === landId);
    if (!low) return;
    const [land] = await this.db.select().from(lands).where(and(eq(lands.serverId, serverId), eq(lands.code, landId)));
    await this.notifier.notifyAdmins({
      kind: "prompts_low",
      title: "题库不足",
      body: `${land?.name ?? landId}只剩 ${low.available} 条可抽的题了，请补题。`,
      link: `/question-bank`,
      dedupeKey: `prompts_low:${serverId}:${landId}:${low.available}`,
      roles: ["admin"],
    });
  }

  /** What a child sees of a drawn prompt. */
  async prompt(id: string) {
    const [p] = await this.db.select().from(prompts).where(eq(prompts.id, id));
    return p ? { id: p.id, title: p.title, body: p.body, audience: p.audience, questionType: p.questionType } : null;
  }
}
