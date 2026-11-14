/**
 * The fixed output format of each AI task (PRD part 6 §3 "统一输出成固定格式（JSON）。
 * 格式不对就自动重试"). Each check returns what is wrong, or null; the gateway treats a
 * wrong answer like a failed call (fallback, then the caller's own retries).
 */

import type { DailyReviewResult, ScoreResult, SupplyScoreResult } from "./ai.js";
import type { Rubric } from "./season/rubrics.js";

const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isLevel = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;

/** T4 每日任务审核. */
export function checkDailyReview(r: DailyReviewResult): string | null {
  if (!r || typeof r !== "object") return "not an object";
  if (typeof r.passed !== "boolean") return "passed";
  if (!r.passed && !isText(r.failReason)) return "failReason";
  if (!isText(r.feedbackGood) || !isText(r.feedbackBetter)) return "feedback";
  if (!isLevel(r.expression, 0, 4)) return "expression";
  if (r.aiLevel !== null && !isLevel(r.aiLevel, 0, 4)) return "aiLevel";
  if (typeof r.aiTone !== "boolean") return "aiTone";
  if (!isText(r.mainTag)) return "mainTag";
  if (typeof r.difficulty !== "number" || !Number.isFinite(r.difficulty) || r.difficulty < 1 || r.difficulty > 6) return "difficulty";
  if (r.passed && (!r.card || !isText(r.card.title) || !isText(r.card.summary))) return "card";
  return null;
}

/** T5 作品初评: one score per rubric dimension, each within its maximum, adding up to the total. */
export function checkWorkScore(r: ScoreResult, rubric: Rubric): string | null {
  if (!r || typeof r !== "object") return "not an object";
  if (!Array.isArray(r.dims) || r.dims.length !== rubric.dims.length) return "dims";
  for (const d of rubric.dims) {
    const x = r.dims.find((y) => y.key === d.key);
    if (!x || typeof x.score !== "number" || !Number.isFinite(x.score) || x.score < 0 || x.score > d.max) return `dims.${d.key}`;
  }
  const sum = r.dims.reduce((s, d) => s + d.score, 0);
  if (typeof r.total !== "number" || Math.abs(sum - r.total) > 0.5) return "total";
  if (typeof r.comment !== "string") return "comment";
  return null;
}

/** T6 军需打分: quality 0–40, summary 0–20 (0 when there is no summary). */
export function checkSupplyScore(r: SupplyScoreResult, hasSummary: boolean): string | null {
  if (!r || typeof r !== "object") return "not an object";
  if (typeof r.quality !== "number" || !Number.isFinite(r.quality) || r.quality < 0 || r.quality > 40) return "quality";
  if (typeof r.summary !== "number" || !Number.isFinite(r.summary) || r.summary < 0 || r.summary > 20) return "summary";
  if (!hasSummary && r.summary !== 0) return "summary";
  return null;
}

/** T8 / T9 小结和回顾. */
export function checkSummary(r: { text: string }): string | null {
  return r && isText(r.text) ? null : "text";
}

export class InvalidAiOutput extends Error {
  constructor(readonly field: string) {
    super(`invalid_output: ${field}`);
  }
}
