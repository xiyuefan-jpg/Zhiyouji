/**
 * AI gateway, first piece (PRD part 6 T5): the initial score of a team work.
 * The real gateway (configurable provider, model, prompt version, fallback,
 * shadow mode, call log) comes with part 6; callers only see this interface.
 */

import { createHash } from "node:crypto";
import type { Rubric } from "./season/rubrics.js";

export interface ScoreRequest {
  workId: string;
  rubric: Rubric;
  promptId: string | null;
  mediaKind: string;
  text: string | null;
  aiNote: string | null;
  /** Speech-to-text of the video or audio, when ready. */
  transcript: string | null;
}

export interface ScoreResult {
  model: string;
  total: number;
  dims: { key: string; name: string; max: number; score: number; reason: string }[];
  comment: string;
  flags: string[];
}

export interface AiScorer {
  score(r: ScoreRequest): Promise<ScoreResult>;
}

/** Spread `total` over the rubric's dimensions in proportion to their points (whole numbers, summing to total). */
export function spreadTotal(rubric: Rubric, total: number): number[] {
  const all = rubric.dims.reduce((s, d) => s + d.max, 0);
  const raw = rubric.dims.map((d) => (total * d.max) / all);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    if (out[i]! < rubric.dims[i]!.max) {
      out[i]!++;
      left--;
    }
  }
  return out;
}

/**
 * Deterministic stand-in: a score between 40 and 85 from the work id, or a
 * fixed one per work id (tests). `fail` makes calls throw.
 */
export class FakeAiScorer implements AiScorer {
  fixed = new Map<string, number>();
  fail = false;
  calls = 0;

  async score(r: ScoreRequest): Promise<ScoreResult> {
    this.calls++;
    if (this.fail) throw new Error("fake AI failure");
    const h = createHash("sha256").update(r.workId).digest().readUInt32BE(0);
    const total = this.fixed.get(r.workId) ?? 40 + (h % 46);
    const parts = spreadTotal(r.rubric, total);
    return {
      model: "fake-scorer",
      total,
      dims: r.rubric.dims.map((d, i) => ({ ...d, score: parts[i]!, reason: `${d.name}：示例理由（假的 AI）。` })),
      comment: "示例评语（假的 AI）：讲清楚了主要原理，可以再多举一个受众熟悉的例子。",
      flags: [],
    };
  }
}

// ---- T4 每日任务审核 (PRD part 6 §3; content library 8.2) ------------------------------

export interface DailyReviewRequest {
  submissionId: string;
  templateId: number;
  templateName: string;
  /** Grade on the day (wording for younger children is simpler). */
  grade: number;
  explainText: string | null;
  /** Speech-to-text of the voice explanation. */
  transcript: string | null;
  aiNote: string | null;
  noAi: boolean;
  evidenceCount: number;
}

export interface DailyReviewResult {
  model: string;
  passed: boolean;
  /** When not passed: why, and how to fix it, in words the child understands. */
  failReason: string | null;
  feedbackGood: string;
  feedbackBetter: string;
  /** 表达档 0–4 */
  expression: number;
  /** 人机协作档 0–4, null = not applicable ("没用 AI") */
  aiLevel: number | null;
  /** Reads like AI wrote it, with no example of the child's own. */
  aiTone: boolean;
  /** "学科/子领域" (taxonomy v0.2) */
  mainTag: string;
  subTag: string | null;
  /** L1–L6 → 1–6 */
  difficulty: number;
  card: { title: string; summary: string };
}

export interface AiDailyReviewer {
  reviewDaily(r: DailyReviewRequest): Promise<DailyReviewResult>;
}

/**
 * Stand-in for T4: passes unless the explanation contains "不通过"; flags "作为一个AI"
 * as AI tone (expression capped at 1, still passed). `failDaily` makes calls throw.
 */
export class FakeAiDaily implements AiDailyReviewer {
  failDaily = false;
  calls = 0;

  async reviewDaily(r: DailyReviewRequest): Promise<DailyReviewResult> {
    this.calls++;
    if (this.failDaily) throw new Error("fake AI failure");
    const text = r.explainText ?? r.transcript ?? "";
    const passed = !text.includes("不通过");
    const aiTone = text.includes("作为一个AI");
    const tag = r.templateId === 2 ? "工程与计算机/人工智能" : r.templateId === 4 ? "生活与实践/手工与修理" : "物理与天文/力与运动";
    return {
      model: "fake-daily",
      passed,
      failReason: passed ? null : "你讲了“是什么”，还没讲“为什么”，再补一句为什么就可以了。",
      feedbackGood: "做得好的：你用自己的例子讲清楚了。",
      feedbackBetter: "可以更好的：说一说你原来以为是什么、后来怎么想通的。",
      expression: aiTone ? 1 : 3,
      aiLevel: r.noAi ? null : 2,
      aiTone,
      mainTag: tag,
      subTag: null,
      difficulty: 3,
      card: { title: [...(text || r.templateName)].slice(0, 15).join(""), summary: text.slice(0, 120) || r.templateName },
    };
  }
}
