/**
 * 待补清单 (content library "待补清单"; PRD part 7 §1 "待补清单里快到截止的项", §4
 * "按最晚什么时候要有排序，到期前提醒"): what is still a draft, what to do about
 * it, and the season day it must be ready by. For the next season that has not
 * started (or the one running), each open item gets a reminder 7 days and 1 day
 * before; done items are ticked off by an admin.
 */

import { asc, eq, inArray } from "drizzle-orm";
import { contentTodos, seasons, type Db } from "@zhiyouji/db";
import { beijingInstant } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";

const DAY = 86_400_000;

/** The content library's list (round 16–17). */
export const DEFAULT_TODOS: readonly { title: string; state: string; action: string; dueDay: number; dueNote: string }[] = [
  { title: "正式评分标准", state: "评分族草案（第 3 节）", action: "合并以前的评分标准；上线前小校准", dueDay: 1, dueNote: "D1 之前" },
  { title: "边缘区素材难度复查", state: "沿用 S2", action: "按 1.1 检查是否都超出年龄段", dueDay: 1, dueNote: "D1 之前" },
  { title: "军需任务", state: "AI 草案（宾果改编）", action: "定稿后在题库里录入并启用", dueDay: 3, dueNote: "D3（第一个周三）" },
  { title: "周战争主题与词条", state: "AI 草案", action: "主题换成更大的世界；在题库、约束词条里录入", dueDay: 4, dueNote: "D4（第一个周四晚间公布时刻）" },
  { title: "4 块中心区", state: "待定，有 AI 草案", action: "想好方向后重写，遵守 1.1", dueDay: 8, dueNote: "D8（第 2 批开放）" },
  { title: "大团战主题", state: "草案不满足要求", action: "全球议题、有国际视角；在题库录入战线和主战场", dueDay: 22, dueNote: "D22 前公布，给各阵营准备时间" },
];

export interface TodoInput {
  title: string;
  state?: string | null;
  action?: string | null;
  dueDay: number;
  dueNote?: string | null;
}

const UPCOMING = ["draft", "enrolling", "grouped", "running", "big_battle"];

export class ContentTodos {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly notifier: Notifier,
  ) {}

  /** The season the deadlines count from: the running one, else the next to open. */
  private async season() {
    const rows = await this.db.select().from(seasons).where(inArray(seasons.status, UPCOMING)).orderBy(asc(seasons.openingDate));
    return rows.find((s) => s.status !== "draft" && s.status !== "enrolling") ?? rows[0] ?? null;
  }

  private dueAt(opening: string, dueDay: number): number {
    return beijingInstant(opening, 0) + dueDay * DAY;
  }

  async list() {
    const s = await this.season();
    const rows = await this.db.select().from(contentTodos);
    const now = +this.clock.now();
    const items = rows
      .map((r) => {
        const due = s ? this.dueAt(String(s.openingDate), r.dueDay) : null;
        return {
          id: r.id,
          title: r.title,
          state: r.state,
          action: r.action,
          dueDay: r.dueDay,
          dueNote: r.dueNote,
          dueAt: due === null ? null : new Date(due).toISOString(),
          daysLeft: due === null ? null : Math.ceil((due - now) / DAY),
          done: !!r.doneAt,
          doneAt: r.doneAt?.toISOString() ?? null,
          doneBy: r.doneBy,
        };
      })
      .sort((a, b) => Number(a.done) - Number(b.done) || a.dueDay - b.dueDay || a.title.localeCompare(b.title));
    return { season: s ? { id: s.id, name: s.name, openingDate: String(s.openingDate) } : null, items };
  }

  async seedDefaults(by: string) {
    const have = await this.db.select({ id: contentTodos.id }).from(contentTodos).limit(1);
    if (!have.length) await this.db.insert(contentTodos).values(DEFAULT_TODOS.map((t) => ({ ...t, createdBy: by, createdAt: this.clock.now() })));
    return this.list();
  }

  async create(i: TodoInput, by: string) {
    await this.db.insert(contentTodos).values({ title: i.title, state: i.state ?? null, action: i.action ?? null, dueDay: i.dueDay, dueNote: i.dueNote ?? null, createdBy: by, createdAt: this.clock.now() });
    return this.list();
  }

  async update(id: string, patch: Partial<TodoInput> & { done?: boolean }, by: string) {
    const [row] = await this.db.select().from(contentTodos).where(eq(contentTodos.id, id));
    if (!row) fail(404, "not_found");
    const { done, ...rest } = patch;
    await this.db
      .update(contentTodos)
      .set({ ...rest, ...(done === undefined ? {} : done ? { doneAt: this.clock.now(), doneBy: by } : { doneAt: null, doneBy: null }) })
      .where(eq(contentTodos.id, id));
    return this.list();
  }

  /** Worker: 7 days and 1 day before an open item's deadline, tell the admins (once each). */
  async remindDue(): Promise<number> {
    const s = await this.season();
    if (!s) return 0;
    const now = +this.clock.now();
    let n = 0;
    for (const r of await this.db.select().from(contentTodos)) {
      if (r.doneAt) continue;
      const due = this.dueAt(String(s.openingDate), r.dueDay);
      const left = due - now;
      const stage = left <= 0 ? "late" : left <= DAY ? "1d" : left <= 7 * DAY ? "7d" : null;
      if (!stage) continue;
      n += await this.notifier.notifyAdmins({
        kind: "content_todo",
        title: stage === "late" ? `待补内容过了截止：${r.title}` : `待补内容快到截止：${r.title}`,
        body: `「${r.title}」${r.dueNote ? `要在 ${r.dueNote}` : `要在 D${r.dueDay} 之前`}准备好（${s.name}）。${r.action ? `要做的：${r.action}。` : ""}做完后在"题库与评分 → 待补清单"里勾掉。`,
        link: "/content",
        dedupeKey: `content_todo:${s.id}:${r.id}:${stage}`,
        roles: ["admin"],
      });
    }
    return n;
  }
}
