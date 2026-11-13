/**
 * Weekly war (PRD part 3 §11, §20.3).
 */

import type { SeasonParams } from "./params.js";
import type { Rng } from "./rng.js";
import { pts, type Pts } from "./units.js";

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface WarPairing {
  pairs: [string, string][];
  bye: string | null;
  /** How many of the pairs have already met this season (0 unless unavoidable). */
  repeats: number;
}

/**
 * Pair teams by current rank (1 v 2, 3 v 4, …), avoiding opponents that have
 * already met this season where possible. With an odd count the lowest-ranked
 * team gets the bye. Among pairings with the fewest repeats, the one closest
 * to rank order wins (least total rank distance; ties to the first found).
 */
export function pairWeeklyWar(ranked: readonly string[], alreadyMet: ReadonlySet<string>): WarPairing {
  const teams = [...ranked];
  const bye = teams.length % 2 === 1 ? (teams.pop() as string) : null;
  const rankOf = new Map(ranked.map((t, i) => [t, i]));
  let best: { pairs: [string, string][]; cost: number; repeats: number } | null = null;
  const search = (rest: string[], acc: [string, string][], cost: number, repeats: number): void => {
    if (best && (repeats > best.repeats || (repeats === best.repeats && cost >= best.cost))) return;
    if (rest.length === 0) {
      best = { pairs: [...acc], cost, repeats };
      return;
    }
    const [first, ...others] = rest as [string, ...string[]];
    for (let i = 0; i < others.length; i++) {
      const second = others[i] as string;
      const met = alreadyMet.has(pairKey(first, second)) ? 1 : 0;
      const dist = Math.abs((rankOf.get(first) ?? 0) - (rankOf.get(second) ?? 0)) - 1;
      search(
        others.filter((_, j) => j !== i),
        [...acc, [first, second]],
        cost + dist,
        repeats + met,
      );
    }
  };
  search(teams, [], 0, 0);
  const found = best as { pairs: [string, string][]; repeats: number } | null;
  return { pairs: found?.pairs ?? [], bye, repeats: found?.repeats ?? 0 };
}

export interface WarSide {
  teamId: string;
  /** Settlement score; null when the team did not submit. */
  score: number | null;
  /** 玉净瓶 activated before the war started. */
  yujing?: boolean;
  /** 大闹天宫 activated before the war started. */
  danao?: boolean;
}

export type WarOutcome = "win" | "lose" | "tie";

export interface WarSideResult {
  teamId: string;
  outcome: WarOutcome;
  points: Pts;
  /** The loser of a match where both submitted opens a chest. */
  chest: boolean;
}

/**
 * Settle one match (§11, §13.4, §20.3):
 * - higher score wins: +15 / −5 (大闹天宫: +25 / −10; 玉净瓶: a loss costs 0);
 * - only the loser of a match where both submitted opens the loser chest;
 * - tie: both +5, items consumed, no chest;
 * - one side missing: the other wins; the missing side loses (玉净瓶 still saves it), no chest;
 * - both missing: both lose, no chest.
 */
export function settleWarMatch(a: WarSide, b: WarSide, p: SeasonParams): [WarSideResult, WarSideResult] {
  const win = (s: WarSide): WarSideResult => ({
    teamId: s.teamId,
    outcome: "win",
    points: pts(s.danao ? p.items.danao.win : p.war.win),
    chest: false,
  });
  const lose = (s: WarSide, chest: boolean): WarSideResult => ({
    teamId: s.teamId,
    outcome: "lose",
    points: s.yujing ? 0 : pts(s.danao ? p.items.danao.lose : p.war.lose),
    chest: chest && p.items.loserChestEnabled,
  });
  if (a.score === null && b.score === null) return [lose(a, false), lose(b, false)];
  if (a.score === null) return [lose(a, false), win(b)];
  if (b.score === null) return [win(a), lose(b, false)];
  if (a.score === b.score) {
    const tie = (s: WarSide): WarSideResult => ({ teamId: s.teamId, outcome: "tie", points: pts(p.war.tie), chest: false });
    return [tie(a), tie(b)];
  }
  return a.score > b.score ? [win(a), lose(b, true)] : [lose(a, true), win(b)];
}

export function byeAward(p: SeasonParams): Pts {
  return pts(p.war.bye);
}

/** The five common items a loser chest can hold, 20% each (§11). */
export const COMMON_ITEMS = ["huanhun", "yujing", "jianbi", "bihuo", "taixu"] as const;

export function openLoserChest(rng: Rng, kinds: readonly string[] = COMMON_ITEMS): string {
  return rng.pick(kinds);
}

/** Weeks 2 and 4 are gift weeks: each team sees 3 random cards from the week's whitelist and gives one to its opponent. */
export function isGiftWeek(week: number, p: SeasonParams): boolean {
  return p.war.giftWeeks.includes(week);
}

export function drawGiftCards(whitelist: readonly string[], rng: Rng, count = 3): string[] {
  return rng.shuffle(whitelist).slice(0, Math.min(count, whitelist.length));
}
