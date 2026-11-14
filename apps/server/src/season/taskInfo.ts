/**
 * What a team work is answering — shown to the team before they make it and
 * to the reviewer and the AI while scoring (design: "讲给别人听并讲明白" needs
 * the question, the audience and how it is judged on both sides).
 */

import { and, asc, eq } from "drizzle-orm";
import { landTemplates, lands, prompts as promptRows, type Db } from "@zhiyouji/db";
import { WAR_THEMES } from "@zhiyouji/shared";
import { campOf, type SeasonState } from "@zhiyouji/engine";
import { rubricFor, RUBRICS, type RubricId } from "./rubrics.js";

const UUID = /^[0-9a-f-]{36}$/i;
export const DEFAULT_AUDIENCE = "一个没学过这个知识的初中生或普通成年人";

export interface TaskInfo {
  title: string | null;
  body: string | null;
  audience: string;
  questionType: string | null;
  subject: string | null;
  landName: string | null;
  /** 小队友可以做什么 (mixed-age teams). */
  juniorHint: string | null;
}

/** The land of an engine land code, with its template (subject, question type, junior hint). */
export async function landInfo(db: Db, serverId: string, landCode: string) {
  const [land] = await db.select().from(lands).where(and(eq(lands.serverId, serverId), eq(lands.code, landCode)));
  const [tpl] = land?.templateId && UUID.test(land.templateId) ? await db.select().from(landTemplates).where(eq(landTemplates.id, land.templateId)) : [];
  return { name: land?.name ?? null, subject: tpl?.subject ?? null, questionType: tpl?.questionType ?? null, juniorHint: tpl?.juniorHint ?? null, audience: tpl?.defaultAudience ?? null };
}

export async function contestTask(db: Db, serverId: string, st: SeasonState, contestId: string): Promise<TaskInfo> {
  const c = st.contests[contestId];
  const land = c ? await landInfo(db, serverId, c.landId) : null;
  const [p] = c && UUID.test(c.promptId) ? await db.select().from(promptRows).where(eq(promptRows.id, c.promptId)) : [];
  return {
    title: p?.title ?? null,
    body: p?.body ?? null,
    audience: p?.audience ?? land?.audience ?? DEFAULT_AUDIENCE,
    questionType: p?.questionType ?? land?.questionType ?? null,
    subject: land?.subject ?? null,
    landName: land?.name ?? null,
    juniorHint: land?.juniorHint ?? null,
  };
}

type PromptRow = typeof promptRows.$inferSelect;

/**
 * Big-battle prompts from the question bank (content library §7, still 待补):
 * the enabled 大团战战线 prompts in creation order are lines 1, 2, 3… (lowest
 * value first); the first enabled 大团战主战场 prompt is the main battlefield.
 */
export async function battlePrompts(db: Db): Promise<{ lines: PromptRow[]; main: PromptRow | null }> {
  const rows = await db.select().from(promptRows).where(eq(promptRows.status, "enabled")).orderBy(asc(promptRows.createdAt), asc(promptRows.id));
  return { lines: rows.filter((r) => r.category === "battle_line"), main: rows.find((r) => r.category === "battle_main") ?? null };
}

/** Line index (0-based) of a team on the locked board, or -1. */
export function lineOf(st: SeasonState, teamId: string): number {
  const bb = st.bigBattle;
  const camp = bb ? campOf(bb, teamId) : null;
  return bb?.final && camp ? bb.final[camp].indexOf(teamId) : -1;
}

function promptTask(p: PromptRow | null | undefined, fallback: string): TaskInfo {
  return { title: p?.title ?? fallback, body: p?.body ?? null, audience: p?.audience ?? DEFAULT_AUDIENCE, questionType: p?.questionType ?? null, subject: null, landName: null, juniorHint: null };
}

/** Task of any work slot: contests by their drawn prompt, weekly wars by the week's theme, the big battle by the question bank. */
export async function workTask(db: Db, serverId: string, st: SeasonState, w: { kind: string; slot: string; teamId?: string }): Promise<TaskInfo | null> {
  if (w.kind === "contest") {
    const id = w.slot.replace(/:open$/, "").slice("contest:".length);
    return contestTask(db, serverId, st, id);
  }
  if (w.kind === "war") {
    const week = Number(w.slot.split(":")[1]);
    const t = WAR_THEMES[week];
    return t ? { title: t.title, body: t.task, audience: DEFAULT_AUDIENCE, questionType: null, subject: null, landName: null, juniorHint: null } : null;
  }
  if (w.kind === "line") {
    const i = w.teamId ? lineOf(st, w.teamId) : -1;
    if (i < 0) return null;
    return promptTask((await battlePrompts(db)).lines[i], `大团战第 ${i + 1} 条线`);
  }
  if (w.kind === "main") return promptTask((await battlePrompts(db)).main, "大团战主战场");
  return null;
}

const isRubric = (x: string | null | undefined): x is RubricId => !!x && x in RUBRICS;

/** Rubric a work is scored with: contests by land, the big battle by its prompt's rubric (C when unset), the rest C. */
export async function workRubric(db: Db, serverId: string, st: SeasonState, w: { kind: string; slot: string; teamId?: string }): Promise<RubricId> {
  if (w.kind === "contest") {
    const landId = st.contests[w.slot.replace(/:open$/, "").slice("contest:".length)]?.landId;
    const [land] = landId ? await db.select().from(lands).where(and(eq(lands.serverId, serverId), eq(lands.code, landId))) : [];
    return rubricFor("contest", land?.name ?? null);
  }
  if (w.kind === "line" || w.kind === "main") {
    const bp = await battlePrompts(db);
    const p = w.kind === "main" ? bp.main : w.teamId ? bp.lines[lineOf(st, w.teamId)] : undefined;
    if (isRubric(p?.rubric)) return p!.rubric as RubricId;
  }
  return rubricFor(w.kind, null);
}
