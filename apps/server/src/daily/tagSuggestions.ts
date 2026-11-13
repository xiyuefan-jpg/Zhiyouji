/**
 * 新标签建议整理 (PRD part 6 T10): knowledge cards the AI
 * could not place in the taxonomy are tagged "其他/<建议>". Once a month the
 * admins get the suggestions of the last month, most frequent first, with a
 * few example titles, to decide whether to add sub-fields (content library
 * 知识分类表). For now identical suggestions are grouped; merging similar
 * wordings with a model comes with the real AI.
 */

import { and, gte, like, lt } from "drizzle-orm";
import { knowledgeCards, type Db } from "@zhiyouji/db";
import { beijingDate } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import type { Notifier } from "../notify/notifier.js";

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export function previousMonth(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export class TagSuggestions {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly notifier: Notifier,
  ) {}

  /** "其他" suggestions of one month, most frequent first. */
  async suggestions(month: string) {
    const { from, to } = monthRange(month);
    const rows = await this.db
      .select({ tag: knowledgeCards.tag, title: knowledgeCards.title })
      .from(knowledgeCards)
      .where(and(like(knowledgeCards.tag, "其他/%"), gte(knowledgeCards.day, from), lt(knowledgeCards.day, to)));
    const by = new Map<string, { name: string; count: number; examples: string[] }>();
    for (const r of rows) {
      const name = r.tag!.slice("其他/".length).trim();
      if (!name) continue;
      const x = by.get(name) ?? { name, count: 0, examples: [] };
      x.count++;
      if (x.examples.length < 3) x.examples.push(r.title);
      by.set(name, x);
    }
    return { month, total: rows.length, suggestions: [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) };
  }

  /** Worker: on the 1st (Beijing), tell the admins about last month's suggestions (once). */
  async runDue(): Promise<number> {
    const today = beijingDate(+this.clock.now());
    if (!today.endsWith("-01")) return 0;
    const month = previousMonth(today);
    const s = await this.suggestions(month);
    if (s.suggestions.length === 0) return 0;
    const top = s.suggestions
      .slice(0, 5)
      .map((x) => `${x.name}（${x.count}）`)
      .join("、");
    return this.notifier.notifyAdmins({
      kind: "tag_suggestions",
      title: `${month} 的新标签建议`,
      body: `上个月有 ${s.total} 张知识卡片放不进现有的分类，最多的是：${top}。可以考虑加进知识分类表。`,
      link: `/content?tab=tags&month=${month}`,
      dedupeKey: `tag_suggestions:${month}`,
      roles: ["admin"],
    });
  }
}

