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
 *
 * Each call also gets the live prompt version (admin console; version 0 = the
 * built-in first draft) built into messages with the children's words wrapped
 * as material (`aiPrompts.ts`), and its tokens and cost go into the log for the
 * cost board (part 6 §6.2: by task, by model, by day). Speech-to-text, key
 * frames and document parsing (T1–T3) go through here too, so they get a backup
 * service and a log like the models do.
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { beijingDate } from "@zhiyouji/engine";
import { checkDailyReview, checkSummary, checkSupplyScore, checkWorkScore, InvalidAiOutput } from "./aiValidate.js";
import { scoreInstructions, withFlag } from "./aiGuard.js";
import { aiCalls, aiConfigs, aiPrices, aiScores, humanScores, promptTemplates, type Db } from "@zhiyouji/db";
import type { AiCallOptions, AiDailyReviewer, AiScorer, AiSummarizer, AiSupplyScorer, AiUsage } from "./ai.js";
import { BUILTIN_PROMPTS, dailyMessages, summaryMessages, supplyMessages, workMessages, type AiMessages, type PromptTask } from "./aiPrompts.js";
import type { Clock } from "./clock.js";
import type { MediaProcessor } from "./media.js";
import { fail } from "./http/errors.js";

/**
 * Every AI task of part 6 §1 that calls an outside service: T1 transcribe, T2
 * key_frames, T3 doc_parse, T4 daily_review, T5 + T7 work_score (one call), T6
 * supply_score, T8 summary, T9 season_review. (T10 groups the "其他" tags by
 * name, no model.)
 */
export const AI_TASKS = ["daily_review", "work_score", "supply_score", "summary", "season_review", "transcribe", "key_frames", "doc_parse"] as const;
export type AiTask = (typeof AI_TASKS)[number];

const DEFAULTS: Record<AiTask, { provider: string; model: string }> = {
  daily_review: { provider: "fake", model: "fake-daily" },
  work_score: { provider: "fake", model: "fake-scorer" },
  supply_score: { provider: "fake", model: "fake-supply" },
  summary: { provider: "fake", model: "fake-summary" },
  season_review: { provider: "fake", model: "fake-summary" },
  transcribe: { provider: "fake", model: "fake-asr" },
  key_frames: { provider: "fake", model: "fake-frames" },
  doc_parse: { provider: "fake", model: "fake-doc" },
};

/** Tasks with a prompt (the media tasks have none). */
export const PROMPT_TASKS: readonly PromptTask[] = ["daily_review", "work_score", "supply_score", "summary", "season_review"];
const hasPrompt = (t: AiTask): t is PromptTask => (PROMPT_TASKS as readonly string[]).includes(t);

export interface AiPriceInput {
  inPerMillion: number;
  outPerMillion: number;
  perAudioHour: number;
}

/** Extra handling of one call (beyond the format check). */
export interface CallExtras<T> {
  /** Build the messages from the live prompt text. */
  build?: (template: string) => AiMessages;
  /** What goes into the log as the output (e.g. a count instead of picture bytes). */
  logOutput?: (out: T) => unknown;
  /** Tokens / audio seconds of the answer (default: `out.usage`). */
  usage?: (out: T) => AiUsage | undefined;
  /** A trial run (admin console 试跑): this prompt text and / or model; no fallback, no shadow. */
  trial?: { prompt?: string; model?: string };
}

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
    return row ?? { task, ...DEFAULTS[task], promptVersion: 0, fallbackProvider: null, fallbackModel: null, shadowModel: null, updatedBy: "default", updatedAt: new Date(0) };
  }

  async configs() {
    return { configs: await Promise.all(AI_TASKS.map((t) => this.config(t))) };
  }

  async setConfig(task: AiTask, i: AiConfigInput, by: string) {
    // the version has to exist (0 = built-in); not given: keep the current one
    const promptVersion = i.promptVersion ?? (await this.config(task)).promptVersion;
    if (promptVersion > 0) {
      if (!hasPrompt(task)) fail(400, "bad_request", { message: "这个任务没有提示词" });
      const [p] = await this.db.select({ v: promptTemplates.version }).from(promptTemplates).where(and(eq(promptTemplates.task, task), eq(promptTemplates.version, promptVersion)));
      if (!p) fail(400, "bad_request", { message: `没有第 ${promptVersion} 版提示词` });
    }
    const v = { provider: i.provider, model: i.model, promptVersion, fallbackProvider: i.fallbackProvider ?? null, fallbackModel: i.fallbackModel ?? null, shadowModel: i.shadowModel ?? null, updatedBy: by, updatedAt: this.clock.now() };
    await this.db.insert(aiConfigs).values({ task, ...v }).onConflictDoUpdate({ target: aiConfigs.task, set: v });
    return this.config(task);
  }

  // ---- prompt templates ---------------------------------------------------------------------------

  async prompts(task: AiTask) {
    const rows = await this.db.select().from(promptTemplates).where(eq(promptTemplates.task, task)).orderBy(desc(promptTemplates.version));
    return { prompts: rows, builtin: hasPrompt(task) ? BUILTIN_PROMPTS[task] : null, live: (await this.config(task)).promptVersion };
  }

  /** The text of a prompt version; a version that is not there (or 0) is the built-in draft. */
  async promptFor(task: AiTask, version: number): Promise<{ version: number; text: string }> {
    if (!hasPrompt(task)) return { version: 0, text: "" };
    if (version > 0) {
      const [p] = await this.db.select().from(promptTemplates).where(and(eq(promptTemplates.task, task), eq(promptTemplates.version, version)));
      if (p) return { version, text: p.content };
    }
    return { version: 0, text: BUILTIN_PROMPTS[task] };
  }

  /** Save a new version (never overwrites); the config chooses which version is live. */
  async addPrompt(task: AiTask, content: string, note: string | null, by: string) {
    if (!hasPrompt(task)) fail(400, "bad_request", { message: "这个任务没有提示词" });
    const [last] = await this.db.select().from(promptTemplates).where(eq(promptTemplates.task, task)).orderBy(desc(promptTemplates.version)).limit(1);
    const [row] = await this.db
      .insert(promptTemplates)
      .values({ task, version: (last?.version ?? 0) + 1, content, note, createdBy: by, createdAt: this.clock.now() })
      .returning();
    return { prompt: row! };
  }

  // ---- prices (part 6 §6.2) ---------------------------------------------------------------------------

  async prices() {
    return { prices: await this.db.select().from(aiPrices).orderBy(asc(aiPrices.model)) };
  }

  async setPrice(model: string, p: AiPriceInput, by: string) {
    const v = { inPerMillion: p.inPerMillion, outPerMillion: p.outPerMillion, perAudioHour: p.perAudioHour, updatedBy: by, updatedAt: this.clock.now() };
    await this.db.insert(aiPrices).values({ model, ...v }).onConflictDoUpdate({ target: aiPrices.model, set: v });
    return this.prices();
  }

  /** Cost of a call in 0.0001 yuan (null: the client did not say what it used). */
  private async costOf(model: string, u: AiUsage | undefined): Promise<number | null> {
    if (!u) return null;
    const [p] = await this.db.select().from(aiPrices).where(eq(aiPrices.model, model));
    if (!p) return 0;
    return Math.round(((u.tokensIn ?? 0) * p.inPerMillion + (u.tokensOut ?? 0) * p.outPerMillion) / 1_000_000 + ((u.audioSec ?? 0) * p.perAudioHour) / 3600);
  }

  // ---- calling --------------------------------------------------------------------------------------

  private async log(task: AiTask, role: string, provider: string, model: string, promptVersion: number, input: unknown, started: number, output: unknown, error: unknown, usage?: AiUsage) {
    await this.db.insert(aiCalls).values({
      task,
      provider,
      model,
      promptVersion,
      role,
      input: input as object,
      output: (output ?? null) as object | null,
      tokensIn: usage?.tokensIn ?? null,
      tokensOut: usage?.tokensOut ?? null,
      cost: await this.costOf(model, usage),
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
  private background = new Set<Promise<unknown>>();

  /** Wait for shadow calls still running (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.background.size) await Promise.allSettled([...this.background]);
  }

  async call<T>(
    task: AiTask,
    meta: unknown,
    fn: (model: string, opts: AiCallOptions) => Promise<T>,
    check: (out: T) => string | null = () => null,
    extras: CallExtras<T> = {},
  ): Promise<T> {
    const c = await this.config(task);
    const trial = extras.trial;
    // a trial prompt is "version -1": not saved, so not a version
    const prompt = trial?.prompt !== undefined ? { version: -1, text: trial.prompt } : await this.promptFor(task, c.promptVersion);
    const messages = extras.build?.(prompt.text);
    // "数据先存" (part 6 §0.3): what the model really got; the children's words in it are cleared after 90 days
    const input = messages ? { ...(meta as object), messages } : meta;
    const outLog = (out: T) => (extras.logOutput ? extras.logOutput(out) : out);
    const usageOf = (out: T) => (extras.usage ? extras.usage(out) : ((out as { usage?: AiUsage } | null)?.usage ?? undefined));
    const t0 = Date.now();
    // An answer in the wrong format counts as a failure (part 6 §3 "格式不对就自动重试").
    const run = async (model: string, provider: string) => {
      const out = await fn(model, { model, provider, prompt, ...(messages ? { messages } : {}) });
      const bad = check(out);
      if (bad) throw new InvalidAiOutput(bad);
      return out;
    };
    if (trial) {
      const model = trial.model || c.model;
      try {
        const out = await run(model, c.provider);
        await this.log(task, "trial", c.provider, model, prompt.version, input, t0, outLog(out), null, usageOf(out));
        return out;
      } catch (err) {
        await this.log(task, "trial", c.provider, model, prompt.version, input, t0, null, err);
        throw err;
      }
    }
    try {
      const out = await run(c.model, c.provider);
      await this.log(task, "primary", c.provider, c.model, prompt.version, input, t0, outLog(out), null, usageOf(out));
      if (c.shadowModel) {
        // in the background: the caller (e.g. a child waiting for the daily review) does not wait for it
        const shadowModel = c.shadowModel;
        const t1 = Date.now();
        const job = run(shadowModel, c.provider).then(
          (shadow) => this.log(task, "shadow", c.provider, shadowModel, prompt.version, input, t1, outLog(shadow), null, usageOf(shadow)),
          (err) => this.log(task, "shadow", c.provider, shadowModel, prompt.version, input, t1, null, err),
        );
        this.background.add(job);
        void job.catch((err) => console.error("shadow log failed", err)).finally(() => this.background.delete(job));
      }
      return out;
    } catch (err) {
      await this.log(task, "primary", c.provider, c.model, prompt.version, input, t0, null, err);
      if (!c.fallbackModel) throw err;
      const t2 = Date.now();
      const fbProvider = c.fallbackProvider ?? c.provider;
      try {
        const out = await run(c.fallbackModel, fbProvider);
        await this.log(task, "fallback", fbProvider, c.fallbackModel, prompt.version, input, t2, outLog(out), null, usageOf(out));
        return out;
      } catch (err2) {
        await this.log(task, "fallback", fbProvider, c.fallbackModel, prompt.version, input, t2, null, err2);
        throw err2;
      }
    }
  }

  // Children's words are data (PRD part 8 §3.3; part 6 §3): lines aimed at the grader are
  // found here, whatever the model does with them, and the result is flagged.
  wrapScorer(inner: AiScorer): AiScorer {
    return {
      score: async (r, o) => {
        const hits = scoreInstructions(r.text, r.aiNote, r.transcript);
        const out = await this.call(
          "work_score",
          { workId: r.workId, rubric: r.rubric.id, promptId: r.promptId, task: r.task?.title ?? null, mediaKind: r.mediaKind, ...(hits.length ? { scoreInstructions: hits } : {}) },
          (_m, opts) => inner.score(r, opts),
          (out) => checkWorkScore(out, r.rubric),
          { build: (tpl) => workMessages(r, tpl), trial: o?.trial },
        );
        return hits.length ? { ...out, flags: withFlag(out.flags) } : out;
      },
    };
  }

  wrapDaily(inner: AiDailyReviewer): AiDailyReviewer {
    return {
      reviewDaily: async (r, o) => {
        const hits = scoreInstructions(r.explainText, r.transcript, r.aiNote);
        const out = await this.call("daily_review", { submissionId: r.submissionId, templateId: r.templateId, grade: r.grade, ...(hits.length ? { scoreInstructions: hits } : {}) }, (_m, opts) => inner.reviewDaily(r, opts), checkDailyReview, { build: (tpl) => dailyMessages(r, tpl), trial: o?.trial });
        return hits.length ? { ...out, flags: withFlag(out.flags) } : out;
      },
    };
  }

  wrapSupply(inner: AiSupplyScorer): AiSupplyScorer {
    return {
      scoreSupply: async (r) => {
        const hits = scoreInstructions(...r.entries, r.summary);
        const out = await this.call("supply_score", { task: r.task.title, entries: r.entries.length, summary: !!r.summary, ...(hits.length ? { scoreInstructions: hits } : {}) }, (_m, opts) => inner.scoreSupply(r, opts), (out) => checkSupplyScore(out, !!r.summary), { build: (tpl) => supplyMessages(r, tpl) });
        return hits.length ? { ...out, flags: withFlag(out.flags) } : out;
      },
    };
  }

  /** T8 (week, month) and T9 (season review) have their own configuration. */
  wrapSummary(inner: AiSummarizer): AiSummarizer {
    return {
      summarize: (r) =>
        this.call(r.kind === "season" ? "season_review" : "summary", { kind: r.kind, cards: r.cards.length, works: r.works?.length ?? 0 }, (_m, opts) => inner.summarize(r, opts), checkSummary, { build: (tpl) => summaryMessages(r, tpl) }),
    };
  }

  /** T1–T3: logged, with a backup service (part 6 §5 "换备用的语音识别服务重试"). */
  wrapMedia(inner: MediaProcessor): MediaProcessor {
    const meta = (i: { fileId: string; kind: string; contentType: string }) => ({ fileId: i.fileId, kind: i.kind, contentType: i.contentType });
    const textOk = (o: { text?: unknown }) => (typeof o?.text === "string" ? null : "text");
    return {
      transcribe: (i) =>
        this.call("transcribe", meta(i), (_m, o) => inner.transcribe(i, { model: o.model, provider: o.provider }), textOk, {
          usage: (out) => out.usage ?? (out.durationSec != null ? { audioSec: out.durationSec } : undefined),
        }),
      keyFrames: (i, opts) =>
        this.call("key_frames", meta(i), (_m, o) => inner.keyFrames(i, { ...opts, model: o.model, provider: o.provider }), (out) => (Array.isArray(out) ? null : "frames"), {
          logOutput: (out) => ({ frames: out.length }),
          usage: () => undefined,
        }),
      parseDocument: (i) => this.call("doc_parse", meta(i), (_m, o) => inner.parseDocument(i, { model: o.model, provider: o.provider }), textOk),
    };
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
    // by Beijing day and task (part 6 §6.2 "按任务、按模型、按天")
    const days = new Map<string, { date: string; task: string; calls: number; errors: number; tokensIn: number; tokensOut: number; cost: number }>();
    for (const r of rows) {
      const date = beijingDate(+r.createdAt);
      const k = `${date}|${r.task}`;
      const x = days.get(k) ?? { date, task: r.task, calls: 0, errors: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
      x.calls++;
      if (r.status === "error") x.errors++;
      x.tokensIn += r.tokensIn ?? 0;
      x.tokensOut += r.tokensOut ?? 0;
      x.cost += r.cost ?? 0;
      days.set(k, x);
    }
    const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
    return {
      totals: { calls: rows.length, errors: rows.filter((r) => r.status === "error").length, costYuan: totalCost / 10000 },
      byDay: [...days.values()].map(({ cost, ...x }) => ({ ...x, errorRate: x.calls ? x.errors / x.calls : 0, costYuan: cost / 10000 })),
      byTaskAndModel: [...by.values()].map((x) => ({ ...x, errorRate: x.calls ? x.errors / x.calls : 0, avgLatencyMs: x.calls ? Math.round(x.latency / x.calls) : 0, costYuan: x.cost / 10000 })),
      humanMinusAiByRubric: Object.fromEntries([...gaps.entries()].map(([k, v]) => [k, { works: v.length, average: Math.round((v.reduce((s, d) => s + d, 0) / v.length) * 10) / 10 }])),
    };
  }
}
