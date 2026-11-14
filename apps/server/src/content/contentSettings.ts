/**
 * 约束词条 and 每日任务模板 kept in the database (PRD part 7 §4 "约束词条：24 张词条
 *及各周的白名单"; "每日任务模板：6 个模板的提示和证据要求"). Until an admin saves a
 * list, the content library drafts in `@zhiyouji/shared` are used. Cached per
 * database in the process; saving refreshes it.
 */

import { eq } from "drizzle-orm";
import { contentSettings as table, type Db } from "@zhiyouji/db";
import { DAILY_TEMPLATES, WAR_CARDS } from "@zhiyouji/shared";
import { fail } from "../http/errors.js";

export interface DailyTemplate {
  id: number;
  name: string;
  prompt: string;
  evidence: string;
  /** Templates 3–6 may say "没用 AI" (content library 8.1): a rule, not editable here. */
  noAiAllowed: boolean;
}

export interface WarCard {
  id: string;
  kind: string;
  text: string;
  weeks: number[];
}

type Key = "war_cards" | "daily_templates";

class ContentSettings {
  private cache = new Map<Key, unknown>();
  constructor(private readonly db: Db) {}

  private async get<T>(key: Key, fallback: T): Promise<T> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const [row] = await this.db.select().from(table).where(eq(table.key, key));
    const v = (row?.value as T | undefined) ?? fallback;
    this.cache.set(key, v);
    return v;
  }

  private async set(key: Key, value: unknown, by: string, at: Date) {
    await this.db.insert(table).values({ key, value, updatedBy: by, updatedAt: at }).onConflictDoUpdate({ target: table.key, set: { value, updatedBy: by, updatedAt: at } });
    this.cache.delete(key);
  }

  async dailyTemplates(): Promise<DailyTemplate[]> {
    const saved = await this.get<{ id: number; name: string; prompt: string; evidence: string }[] | null>("daily_templates", null);
    return DAILY_TEMPLATES.map((d) => {
      const s = saved?.find((x) => x.id === d.id);
      return { id: d.id, name: s?.name ?? d.name, prompt: s?.prompt ?? d.prompt, evidence: s?.evidence ?? d.evidence, noAiAllowed: d.noAiAllowed };
    });
  }

  async dailyTemplate(id: number): Promise<DailyTemplate> {
    return (await this.dailyTemplates()).find((t) => t.id === id) ?? (await this.dailyTemplates())[0]!;
  }

  /** The six templates' wording (ids 1–6 stay; "没用 AI" stays as the rules say). */
  async setDailyTemplates(list: { id: number; name: string; prompt: string; evidence: string }[], by: string, at: Date) {
    const ids = list.map((x) => x.id).sort();
    if (ids.join(",") !== "1,2,3,4,5,6") fail(400, "bad_request", { message: "要 6 个模板（编号 1–6）都填" });
    await this.set("daily_templates", list.map((x) => ({ id: x.id, name: x.name.trim(), prompt: x.prompt.trim(), evidence: x.evidence.trim() })), by, at);
    return { templates: await this.dailyTemplates() };
  }

  async warCards(): Promise<WarCard[]> {
    return this.get<WarCard[]>("war_cards", WAR_CARDS.map((c) => ({ ...c, weeks: [...c.weeks] })));
  }

  /** The whole card list (ids like S1, R2; the weeks each may be offered in). */
  async setWarCards(list: WarCard[], by: string, at: Date) {
    const ids = list.map((c) => c.id);
    if (new Set(ids).size !== ids.length) fail(400, "bad_request", { message: "词条编号不能重复" });
    if (ids.some((id) => !/^[A-Z]\d$/.test(id))) fail(400, "bad_request", { message: "词条编号是一个大写字母加一个数字，例如 S1" });
    await this.set("war_cards", list.map((c) => ({ id: c.id, kind: c.kind.trim(), text: c.text.trim(), weeks: [...new Set(c.weeks)].sort() })), by, at);
    return { cards: await this.warCards() };
  }
}

const books = new WeakMap<Db, ContentSettings>();

export function contentSettings(db: Db): ContentSettings {
  let b = books.get(db);
  if (!b) books.set(db, (b = new ContentSettings(db)));
  return b;
}
