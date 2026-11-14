/**
 * AI gateway (PRD part 2 §4.6; part 6 §0, §5, §9): every AI task goes through
 * here. Per task the admin console sets the provider, model, prompt version, a
 * fallback model and a shadow model. Every call is logged (input, output,
 * model, version, time, status). A failed primary call is tried once on the
 * fallback model; the shadow model runs alongside and is only logged.
 *
 * The model clients themselves are the provider interfaces (fake until the
 * accounts exist); `wrap…` turns them into the same interfaces with logging and
 * fallback, so the rest of the server does not change.
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { scoreInstructions, withFlag } from "./aiGuard.js";
import { aiCalls, aiConfigs, aiScores, humanScores, promptTemplates, type Db } from "@zhiyouji/db";
import type { AiDailyReviewer, AiScorer, AiSummarizer, AiSupplyScorer } from "./ai.js";
import type { Clock } from "./clock.js";

export const AI_TASKS = ["daily_review", "work_score", "supply_score", "summary"] as const;
export type AiTask = (typeof AI_TASKS)[number];

const DEFAULTS: Record<AiTask, { provider: string; model: string }> = {
  daily_review: { provider: "fake", model: "fake-daily" },
  work_score: { provider: "fake", model: "fake-scorer" },
  supply_score: { provider: "fake", model: "fake-supply" },
  summary: { provider: "fake", model: "fake-summary" },
};

export interface AiConfigInput {
  provider: string;
  model: string;
  promptVersion?: number;
  fallbackProvider?: string | null;
  fallbackModel?: string | null;
  shadowModel?: string | null;
}

export class AiGateway {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async config(task: AiTask) {
    const [row] = await this.db.select().from(aiConfigs).where(eq(aiConfigs.task, task));
    return row ?? { task, ...DEFAULTS[task], promptVersion: 1, fallbackProvider: null, fallbackModel: null, shadowModel: null, updatedBy: "default", updatedAt: new Date(0) };
  }

  async configs() {
    return { configs: await Promise.all(AI_TASKS.map((t) => this.config(t))) };
  }

  async setConfig(task: AiTask, i: AiConfigInput, by: string) {
    const v = { provider: i.provider, model: i.model, promptVersion: i.promptVersion ?? 1, fallbackProvider: i.fallbackProvider ?? null, fallbackModel: i.fallbackModel ?? null, shadowModel: i.shadowModel ?? null, updatedBy: by, updatedAt: this.clock.now() };
    await this.db.insert(aiConfigs).values({ task, ...v }).onConflictDoUpdate({ target: aiConfigs.task, set: v });
    return this.config(task);
  }

  // ---- prompt templates ---------------------------------------------------------------------------

  async prompts(task: AiTask) {
    const rows = await this.db.select().from(promptTemplates).where(eq(promptTemplates.task, task)).orderBy(desc(promptTemplates.version));
    return { prompts: rows };
  }

  /** Save a new version (never overwrites); the config chooses which version is live. */
  async addPrompt(task: AiTask, content: string, note: string | null, by: string) {
    const [last] = await this.db.select().from(promptTemplates).where(eq(promptTemplates.task, task)).orderBy(desc(promptTemplates.version)).limit(1);
    const [row] = await this.db
      .insert(promptTemplates)
      .values({ task, version: (last?.version ?? 0) + 1, content, note, createdBy: by, createdAt: this.clock.now() })
      .returning();
    return { prompt: row! };
  }

  // ---- calling --------------------------------------------------------------------------------------

  private async log(task: AiTask, role: string, provider: string, model: string, promptVersion: number, input: unknown, started: number, output: unknown, error: unknown) {
    await this.db.insert(aiCalls).values({
      task,
      provider,
      model,
      promptVersion,
      role,
      input: input as object,
      output: (output ?? null) as object | null,
      latencyMs: Math.max(0, Date.now() - started),
      status: error ? "error" : "ok",
      error: error ? String((error as Error).message ?? error) : null,
      createdAt: this.clock.now(),
    });
  }

  /**
   * Run `fn` for a task with logging; on failure once more as the fallback;
   * the shadow model runs after the primary and only goes to the log.
   */
  async call<T>(task: AiTask, input: unknown, fn: (model: string) => Promise<T>): Promise<T> {
    const c = await this.config(task);
    const t0 = Date.now();
    try {
      const out = await fn(c.model);
      await this.log(task, "primary", c.provider, c.model, c.promptVersion, input, t0, out, null);
      if (c.shadowModel) {
        const t1 = Date.now();
        try {
          const shadow = await fn(c.shadowModel);
          await this.log(task, "shadow", c.provider, c.shadowModel, c.promptVersion, input, t1, shadow, null);
        } catch (err) {
          await this.log(task, "shadow", c.provider, c.shadowModel, c.promptVersion, input, t1, null, err);
        }
      }
      return out;
    } catch (err) {
      await this.log(task, "primary", c.provider, c.model, c.promptVersion, input, t0, null, err);
      if (!c.fallbackModel) throw err;
      const t2 = Date.now();
      try {
        const out = await fn(c.fallbackModel);
        await this.log(task, "fallback", c.fallbackProvider ?? c.provider, c.fallbackModel, c.promptVersion, input, t2, out, null);
        return out;
      } catch (err2) {
        await this.log(task, "fallback", c.fallbackProvider ?? c.provider, c.fallbackModel, c.promptVersion, input, t2, null, err2);
        throw err2;
      }
    }
  }

  // Children's words are data (PRD part 8 §3.3; part 6 §3): lines aimed at the grader are
  // found here, whatever the model does with them, and the result is flagged.
  wrapScorer(inner: AiScorer): AiScorer {
    return {
      score: async (r) => {
        const hits = scoreInstructions(r.text, r.aiNote, r.transcript);
        const out = await this.call(
          "work_score",
          { workId: r.workId, rubric: r.rubric.id, promptId: r.promptId, task: r.task?.title ?? null, mediaKind: r.mediaKind, ...(hits.length ? { scoreInstructions: hits } : {}) },
          () => inner.score(r),
        );
        return hits.length ? { ...out, flags: withFlag(out.flags) } : out;
      },
    };
  }

  wrapDaily(inner: AiDailyReviewer): AiDailyReviewer {
    return {
      reviewDaily: async (r) => {
        const hits = scoreInstructions(r.explainText, r.transcript, r.aiNote);
        const out = await this.call("daily_review", { submissionId: r.submissionId, templateId: r.templateId, grade: r.grade, ...(hits.length ? { scoreInstructions: hits } : {}) }, () => inner.reviewDaily(r));
        return hits.length ? { ...out, flags: withFlag(out.flags) } : out;
      },
    };
  }

  wrapSupply(inner: AiSupplyScorer): AiSupplyScorer {
    return {
      scoreSupply: async (r) => {
        const hits = scoreInstructions(...r.entries, r.summary);
        const out = await this.call("supply_score", { task: r.task.title, entries: r.entries.length, summary: !!r.summary, ...(hits.length ? { scoreInstructions: hits } : {}) }, () => inner.scoreSupply(r));
        return hits.length ? { ...out, flags: withFlag(out.flags) } : out;
      },
    };
  }

  wrapSummary(inner: AiSummarizer): AiSummarizer {
    return { summarize: (r) => this.call("summary", { kind: r.kind, cards: r.cards.length }, () => inner.summarize(r)) };
  }

  // ---- the AI board (part 6 §9) ----------------------------------------------------------------------

  async stats(from: Date, to: Date) {
    const rows = await this.db.select().from(aiCalls).where(and(gte(aiCalls.createdAt, from), lte(aiCalls.createdAt, to))).orderBy(asc(aiCalls.createdAt));
    const by = new Map<string, { task: string; model: string; calls: number; errors: number; latency: number; cost: number }>();
    for (const r of rows) {
      const k = `${r.task}|${r.model}|${r.role}`;
      const x = by.get(k) ?? { task: r.task, model: r.model, role: r.role, calls: 0, errors: 0, latency: 0, cost: 0 };
      x.calls++;
      if (r.status === "error") x.errors++;
      x.latency += r.latencyMs;
      x.cost += r.cost ?? 0;
      by.set(k, x);
    }
    // AI vs human by rubric family (part 6 §4.1 calibration).
    const ai = await this.db.select().from(aiScores).where(eq(aiScores.official, true));
    const human = await this.db.select().from(humanScores);
    const gaps = new Map<string, number[]>();
    for (const h of human) {
      const a = ai.find((x) => x.workId === h.workId);
      if (!a) continue;
      const fam = a.rubric.split("@")[0]!;
      gaps.set(fam, [...(gaps.get(fam) ?? []), h.total - a.total]);
    }
    return {
      byTaskAndModel: [...by.values()].map((x) => ({ ...x, errorRate: x.calls ? x.errors / x.calls : 0, avgLatencyMs: x.calls ? Math.round(x.latency / x.calls) : 0, costYuan: x.cost / 10000 })),
      humanMinusAiByRubric: Object.fromEntries([...gaps.entries()].map(([k, v]) => [k, { works: v.length, average: Math.round((v.reduce((s, d) => s + d, 0) / v.length) * 10) / 10 }])),
    };
  }
}
