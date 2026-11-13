/**
 * Big battle, D29–D33 (PRD part 3 §14, §20.5).
 */

import { baseOutput, type LandKind } from "./territory.js";
import type { SeasonParams } from "./params.js";
import type { Rng } from "./rng.js";
import { pts, type Pts } from "./units.js";

/**
 * Snake draft by rank: 1st → camp A, 2nd and 3rd → B, 4th and 5th → A, …
 * With 8 teams: A = ranks 1, 4, 5, 8; B = ranks 2, 3, 6, 7.
 */
export function formCamps(ranked: readonly string[]): { a: string[]; b: string[] } {
  const a: string[] = [];
  const b: string[] = [];
  ranked.forEach((t, i) => {
    const block = Math.floor((i + 1) / 2);
    (block % 2 === 0 ? a : b).push(t);
  });
  return { a, b };
}

/** A camp's assignment: line index → team. Missing or invalid assignments get a random one at the deadline. */
export function completeLineAssignment(
  camp: readonly string[],
  lineCount: number,
  submitted: readonly string[] | null,
  rng: Rng,
): string[] {
  const valid =
    submitted !== null &&
    submitted.length === lineCount &&
    new Set(submitted).size === lineCount &&
    submitted.every((t) => camp.includes(t));
  return valid ? [...(submitted as string[])] : rng.shuffle(camp).slice(0, lineCount);
}

export interface LineSide {
  teamId: string;
  score: number | null;
  beishui?: boolean;
  jiancheng?: boolean;
  /** Kind of the team's highest-output land, or null if it holds none. */
  bestLand: LandKind | null;
}

export interface LineSideResult {
  teamId: string;
  outcome: "win" | "lose" | "tie" | "none";
  linePoints: Pts;
  /** Output taken from (negative) or given to (positive) this team. */
  seized: Pts;
  /** True when the winner gets the no-land compensation instead of seizing. */
  compensation: boolean;
}

/**
 * Settle one battle line (§14, §20.5):
 * - winner: + line value (背水阵 × 1.75) + the loser's best land base output × 5 days,
 *   or 1 × 5 × 0.8 = 4 when the loser has no land; 坚城令 on the loser stops the seizing;
 * - loser: − the seized output; 背水阵 on the loser: −10 more;
 * - tie: both get half the line value, nothing seized, 背水阵 has no effect;
 * - one side missing: the other wins; both missing: nobody scores.
 */
export function settleBattleLine(value: number, x: LineSide, y: LineSide, p: SeasonParams): [LineSideResult, LineSideResult] {
  const bb = p.bigBattle;
  if (x.score === null && y.score === null) {
    const nothing = (s: LineSide): LineSideResult => ({ teamId: s.teamId, outcome: "none", linePoints: 0, seized: 0, compensation: false });
    return [nothing(x), nothing(y)];
  }
  if (x.score !== null && y.score !== null && x.score === y.score) {
    const tie = (s: LineSide): LineSideResult => ({ teamId: s.teamId, outcome: "tie", linePoints: pts(value / 2), seized: 0, compensation: false });
    return [tie(x), tie(y)];
  }
  const xWins = y.score === null || (x.score !== null && x.score > y.score);
  const [w, l] = xWins ? [x, y] : [y, x];
  let seized = 0;
  let compensation = false;
  if (l.bestLand === null) {
    seized = pts(p.territory.edgeOutput * bb.seizeDays * bb.noLandCompFactor);
    compensation = true;
  } else if (!l.jiancheng) {
    seized = pts(baseOutput(l.bestLand, p) * bb.seizeDays);
  }
  const winner: LineSideResult = {
    teamId: w.teamId,
    outcome: "win",
    linePoints: pts(value * (w.beishui ? p.items.beishui.winMultiplier : 1)),
    seized,
    compensation,
  };
  const loser: LineSideResult = {
    teamId: l.teamId,
    outcome: "lose",
    linePoints: l.beishui ? -pts(p.items.beishui.losePenalty) : 0,
    seized: compensation || seized === 0 ? 0 : -seized,
    compensation: false,
  };
  return xWins ? [winner, loser] : [loser, winner];
}

/** Main battlefield: every team of the higher-scoring camp +12; a tie gives nothing (§14). */
export function mainBattlefieldWinner(scoreA: number | null, scoreB: number | null): "a" | "b" | "tie" {
  const a = scoreA ?? Number.NEGATIVE_INFINITY;
  const b = scoreB ?? Number.NEGATIVE_INFINITY;
  if (a === b) return "tie";
  return a > b ? "a" : "b";
}

export function mainBattlefieldPoints(camp: "a" | "b", winner: "a" | "b" | "tie", qiankun: boolean, p: SeasonParams): Pts {
  if (winner === "tie") return 0;
  const won = winner === camp;
  const base = won ? pts(p.bigBattle.mainWin) : 0;
  if (!qiankun) return base;
  return base + pts(won ? p.items.qiankun.win : p.items.qiankun.lose);
}
