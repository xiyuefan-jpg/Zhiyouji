/**
 * What a team work is answering — shown to the team before they make it and
 * to the reviewer and the AI while scoring (design: "讲给别人听并讲明白" needs
 * the question, the audience and how it is judged on both sides).
 */

import { and, eq } from "drizzle-orm";
import { landTemplates, lands, prompts as promptRows, type Db } from "@zhiyouji/db";
import { WAR_THEMES } from "@zhiyouji/shared";
import type { SeasonState } from "@zhiyouji/engine";

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

/** Task of any work slot: contests by their drawn prompt, weekly wars by the week's theme. */
export async function workTask(db: Db, serverId: string, st: SeasonState, w: { kind: string; slot: string }): Promise<TaskInfo | null> {
  if (w.kind === "contest") {
    const id = w.slot.replace(/:open$/, "").slice("contest:".length);
    return contestTask(db, serverId, st, id);
  }
  if (w.kind === "war") {
    const week = Number(w.slot.split(":")[1]);
    const t = WAR_THEMES[week];
    return t ? { title: t.title, body: t.task, audience: DEFAULT_AUDIENCE, questionType: null, subject: null, landName: null, juniorHint: null } : null;
  }
  return null;
}
