/**
 * 土地公问卷 (PRD part 5 A4; content library §10): stored per child; the play
 * style feeds the grouping (part 3 §4), the challenge decides the default way
 * of explaining daily tasks and is the growth baseline.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { children, files, surveyAnswers, type Db } from "@zhiyouji/db";
import { SURVEY_VERSION, curiosityScores, type SurveySubmit } from "@zhiyouji/shared";
import type { ChildRow } from "./family.js";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";

export class Survey {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async submit(child: ChildRow, b: SurveySubmit) {
    if (b.challenge?.kind === "voice") {
      const [f] = await this.db.select().from(files).where(and(eq(files.id, b.challenge.fileId), eq(files.childId, child.id)));
      if (!f || f.status === "uploading" || f.kind !== "audio") fail(409, "explain_missing");
    }
    // The final pick must be one of the round winners.
    if (!b.curiosity.rounds.some((r) => r[2] === b.curiosity.final) || b.curiosity.rounds.some((r) => r[2] !== r[0] && r[2] !== r[1])) fail(400, "bad_request");
    const now = this.clock.now();
    const curiosity = curiosityScores(b.curiosity);
    await this.db.insert(surveyAnswers).values({
      childId: child.id,
      version: SURVEY_VERSION,
      answers: b,
      curiosity,
      style: b.style,
      challengeKind: b.challenge?.kind ?? null,
      challengeText: b.challenge?.kind === "text" ? b.challenge.text : null,
      challengeFileId: b.challenge?.kind === "voice" ? b.challenge.fileId : null,
      completedAt: now,
    });
    // 选哪个，哪个就是每日任务默认的讲解方式；跳过时默认用语音。
    await this.db.update(children).set({ explainPref: b.challenge?.kind ?? "voice" }).where(eq(children.id, child.id));
    return this.latest(child.id);
  }

  async latest(childId: string) {
    const [r] = await this.db.select().from(surveyAnswers).where(eq(surveyAnswers.childId, childId)).orderBy(desc(surveyAnswers.completedAt)).limit(1);
    if (!r) return { done: false as const };
    return { done: true as const, version: r.version, style: r.style, curiosity: r.curiosity as Record<string, number>, completedAt: r.completedAt.toISOString() };
  }

  /** Latest play style per child (grouping). */
  async styles(childIds: string[]): Promise<Map<string, string>> {
    if (childIds.length === 0) return new Map();
    const rows = await this.db.select().from(surveyAnswers).where(inArray(surveyAnswers.childId, childIds)).orderBy(surveyAnswers.completedAt);
    return new Map(rows.map((r) => [r.childId, r.style]));
  }
}
