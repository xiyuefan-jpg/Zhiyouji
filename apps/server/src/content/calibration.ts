/**
 * 校准 (PRD part 7 §4; part 6 §4.1 "上线前先做一次小校准"): sample works with
 * their question and rubric family; each person scores them on their own (no
 * one sees the others' scores before scoring); AI set-ups (a model and a prompt,
 * the live one or a draft) score all samples of a family; the report shows, per
 * family, how far each AI set-up is from the people's average (goal ±8) and how
 * far the people are from each other.
 *
 * Samples are the user's own examples, not children's season data. Text only:
 * a video's or audio's words go in as a transcript.
 */

import { and, asc, eq } from "drizzle-orm";
import { calibSamples, calibScores, type Db } from "@zhiyouji/db";
import type { AiScorer } from "../ai.js";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import { checkDims, rubricBook, RUBRIC_IDS, type RubricId } from "../season/rubrics.js";
import { DEFAULT_AUDIENCE } from "./questionBank.js";

export interface SampleInput {
  title: string;
  family: RubricId;
  taskTitle: string;
  taskBody?: string | null;
  audience?: string | null;
  mediaKind?: string;
  text: string;
  aiNote?: string | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export class Calibration {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly ai: AiScorer,
  ) {}

  async addSample(i: SampleInput, by: string) {
    const [row] = await this.db
      .insert(calibSamples)
      .values({ title: i.title, family: i.family, taskTitle: i.taskTitle, taskBody: i.taskBody ?? null, audience: i.audience ?? null, mediaKind: i.mediaKind ?? "text", text: i.text, aiNote: i.aiNote ?? null, createdBy: by, createdAt: this.clock.now() })
      .returning();
    return { sample: row! };
  }

  /** The samples; for a scorer, only their own scores (independent scoring). */
  async samples(scorerId: string) {
    const rows = await this.db.select().from(calibSamples).orderBy(asc(calibSamples.createdAt));
    const mine = await this.db.select().from(calibScores).where(and(eq(calibScores.kind, "human"), eq(calibScores.scorer, scorerId)));
    return {
      samples: await Promise.all(
        rows.map(async (s) => {
          const { rubric, guide } = await rubricBook(this.db).live(s.family as RubricId);
          const m = mine.find((x) => x.sampleId === s.id);
          return { ...s, createdAt: s.createdAt.toISOString(), rubric: { ...rubric, dims: rubric.dims.map((d) => ({ ...d, hint: guide.hints[d.key] ?? "" })), at50: guide.at50, at75: guide.at75 }, mine: m ? { total: m.total, dims: m.dims } : null };
        }),
      ),
    };
  }

  /** One person's score of one sample (can be changed until the report is used; one per person). */
  async score(sampleId: string, scorerId: string, dims: Record<string, number>) {
    const [s] = await this.db.select().from(calibSamples).where(eq(calibSamples.id, sampleId));
    if (!s) fail(404, "not_found");
    const { rubric } = await rubricBook(this.db).live(s!.family as RubricId);
    if (!checkDims(rubric, dims)) fail(400, "bad_dims");
    const total = Object.values(dims).reduce((a, b) => a + b, 0);
    const v = { total, dims, rubric: `${rubric.id}@${rubric.version}`, createdAt: this.clock.now() };
    await this.db.insert(calibScores).values({ sampleId, kind: "human", scorer: scorerId, ...v }).onConflictDoUpdate({ target: [calibScores.sampleId, calibScores.kind, calibScores.scorer], set: v });
    return { total };
  }

  /**
   * Run an AI set-up on every sample (of one family, or all): the live model
   * and prompt, or another model and / or a draft prompt (a trial in the AI
   * log). Stored under `label`; running the same label again replaces it.
   */
  async runAi(o: { family?: RubricId; model?: string; prompt?: string; label: string }) {
    const rows = (await this.db.select().from(calibSamples)).filter((s) => !o.family || s.family === o.family);
    let done = 0;
    const failed: string[] = [];
    for (const s of rows) {
      const { rubric, guide } = await rubricBook(this.db).live(s.family as RubricId);
      try {
        const r = await this.ai.score(
          {
            workId: s.id,
            rubric,
            promptId: null,
            task: { title: s.taskTitle, body: s.taskBody, audience: s.audience ?? DEFAULT_AUDIENCE, questionType: null, subject: null, landName: null, juniorHint: null },
            mediaKind: s.mediaKind,
            text: s.mediaKind === "text" || s.mediaKind === "images" ? s.text : null,
            transcript: s.mediaKind === "video" || s.mediaKind === "audio" ? s.text : null,
            aiNote: s.aiNote,
            anchors: { at50: guide.at50, at75: guide.at75 },
          },
          o.model || o.prompt ? { trial: { model: o.model, prompt: o.prompt } } : undefined,
        );
        const v = { total: Math.max(0, Math.min(100, Math.round(r.total))), dims: r.dims, rubric: `${rubric.id}@${rubric.version}`, createdAt: this.clock.now() };
        await this.db.insert(calibScores).values({ sampleId: s.id, kind: "ai", scorer: o.label, ...v }).onConflictDoUpdate({ target: [calibScores.sampleId, calibScores.kind, calibScores.scorer], set: v });
        done++;
      } catch (err) {
        failed.push(`${s.title}：${String((err as Error).message ?? err)}`);
      }
    }
    return { scored: done, failed };
  }

  /**
   * Per family: samples, people's spread (average gap between two people on
   * the same sample), and per AI set-up the average of (AI − people's average)
   * and of its absolute value; within ±8 is the goal (part 6 §4.1).
   */
  async report() {
    const samples = await this.db.select().from(calibSamples);
    const scores = await this.db.select().from(calibScores);
    return {
      goal: 8,
      families: RUBRIC_IDS.map((family) => {
        const mine = samples.filter((s) => s.family === family);
        const humanMean = new Map<string, number>();
        const pairGaps: number[] = [];
        for (const s of mine) {
          const hs = scores.filter((x) => x.sampleId === s.id && x.kind === "human").map((x) => x.total);
          if (hs.length) humanMean.set(s.id, avg(hs)!);
          for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) pairGaps.push(Math.abs(hs[i]! - hs[j]!));
        }
        const labels = [...new Set(scores.filter((x) => x.kind === "ai" && mine.some((s) => s.id === x.sampleId)).map((x) => x.scorer))];
        return {
          family,
          samples: mine.length,
          scoredByPeople: humanMean.size,
          people: new Set(scores.filter((x) => x.kind === "human" && mine.some((s) => s.id === x.sampleId)).map((x) => x.scorer)).size,
          peopleGap: r1(avg(pairGaps)),
          ai: labels.map((label) => {
            const gaps = mine
              .map((s) => {
                const a = scores.find((x) => x.sampleId === s.id && x.kind === "ai" && x.scorer === label);
                const h = humanMean.get(s.id);
                return a && h !== undefined ? a.total - h : null;
              })
              .filter((x): x is number => x !== null);
            const mean = avg(gaps);
            const abs = avg(gaps.map(Math.abs));
            return { label, compared: gaps.length, aiMinusPeople: r1(mean), absGap: r1(abs), withinGoal: abs !== null && abs <= 8 };
          }),
        };
      }),
    };
  }
}
