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
