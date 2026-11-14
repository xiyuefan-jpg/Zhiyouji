/**
 * Facts for the season review (PRD part 5 §4.1): the team's highlights
 * (lands taken, lands held, weekly wars won, the big battle line) and how
 * each work a child signed turned out. Pure over the season state.
 */

import { campOf, type SeasonState } from "@zhiyouji/engine";
import { lineOf } from "./taskInfo.js";

/** "夺下 2 块地", "守住 3 次", "周战争赢了 2 场", "大团战战线赢了". */
export function teamHighlights(st: SeasonState, teamId: string): string[] {
  let captured = 0;
  let defended = 0;
  for (const c of Object.values(st.contests)) {
    if (c.outcome?.kind === "captured" && c.outcome.winner === teamId) captured++;
    if (c.outcome?.kind === "defended" && c.defender === teamId) defended++;
  }
  const warWins = Object.values(st.wars).filter((w) => w.results?.some((r) => r.teamId === teamId && r.outcome === "win")).length;
  const out: string[] = [];
  if (captured) out.push(`夺下 ${captured} 块地`);
  if (defended) out.push(`守住 ${defended} 次`);
  if (warWins) out.push(`周战争赢了 ${warWins} 场`);
  if (lineOutcome(st, teamId) === "win") out.push("大团战战线赢了");
  if (mainOutcome(st, teamId) === "win") out.push("大团战主战场赢了");
  return out;
}

/** Win / tie / lose on the team's big-battle line, from its line points (win = the full line value or more). */
function lineOutcome(st: SeasonState, teamId: string): "win" | "tie" | "lose" | null {
  const bb = st.bigBattle;
  const i = lineOf(st, teamId);
  if (!bb?.settled || i < 0) return null;
  const pts = st.ledger.filter((e) => e.teamId === teamId && e.currency === "points" && e.source === "big_battle_line").reduce((a, e) => a + e.amount, 0);
  const full = bb.lineValues[i]! * 100;
  return pts >= full ? "win" : pts > 0 ? "tie" : "lose";
}

function mainOutcome(st: SeasonState, teamId: string): "win" | "lose" | null {
  if (!st.bigBattle?.settled || !campOf(st.bigBattle, teamId)) return null;
  const pts = st.ledger.filter((e) => e.teamId === teamId && e.currency === "points" && e.source === "main_battlefield").reduce((a, e) => a + e.amount, 0);
  return pts > 0 ? "win" : "lose";
}

const WAR_TEXT = { win: "赢了", lose: "输了", tie: "打平", bye: "轮空" } as const;
const LINE_TEXT = { win: "赢了", tie: "打平", lose: "输了" } as const;

/** How a work slot turned out for the team, in a few words (null while it is not settled). */
export function workOutcome(st: SeasonState, teamId: string, w: { kind: string; slot: string }): string | null {
  if (w.kind === "contest") {
    const c = st.contests[w.slot.replace(/:open$/, "").slice("contest:".length)];
    const o = c?.outcome;
    if (!c || !o) return null;
    const defending = c.defender === teamId;
    if (o.kind === "captured") return o.winner === teamId ? "夺地成功" : defending ? "地被夺走了" : "没夺下";
    if (o.kind === "defended") return defending ? "守住了" : "没夺下";
    if (o.kind === "nothing") return "没有组达到质量线";
    return "取消了";
  }
  if (w.kind === "war") {
    const r = st.wars[Number(w.slot.split(":")[1])]?.results?.find((x) => x.teamId === teamId);
    return r ? WAR_TEXT[r.outcome] : null;
  }
  if (w.kind === "line") {
    const o = lineOutcome(st, teamId);
    return o ? LINE_TEXT[o] : null;
  }
  if (w.kind === "main") {
    const o = mainOutcome(st, teamId);
    return o ? (o === "win" ? "本阵营赢了" : "本阵营输了") : null;
  }
  return null;
}
