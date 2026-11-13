/**
 * Items (法宝, PRD part 3 §13, §20.4).
 *
 * Pure rules for using items. Callers hold the season state (inventories,
 * lands, ranks) and turn the returned effects into ledger entries and
 * continuing effects.
 */

import type { SeasonParams } from "./params.js";
import { DAY, type Instant } from "./time.js";
import { floorGrain, pts, type Pts } from "./units.js";

export type ItemTier = "common" | "rare" | "epic";

export interface ItemDef {
  id: string;
  name: string;
  tier: ItemTier;
  /** Hurts its target: subject to the punch-down factor and to 辟火罩 / 照妖镜. */
  negative: boolean;
  /** Works while held; consumed when it triggers. */
  passive: boolean;
  /** Only usable in the big battle. */
  bigBattle: boolean;
}

const def = (id: string, name: string, tier: ItemTier, flags: Partial<Omit<ItemDef, "id" | "name" | "tier">> = {}): ItemDef => ({
  id,
  name,
  tier,
  negative: false,
  passive: false,
  bigBattle: false,
  ...flags,
});

/** The 21 items (§13.4). */
export const ITEMS: readonly ItemDef[] = [
  def("huanhun", "还魂金丹", "common"),
  def("yujing", "玉净瓶", "common"),
  def("jianbi", "坚壁清野", "common", { passive: true }),
  def("bihuo", "辟火罩", "common", { passive: true }),
  def("taixu", "太虚幻镜", "common"),
  def("zhencha", "侦察令", "common", { bigBattle: true }),
  def("dianhua", "点化之术", "rare"),
  def("shengsi", "生死簿", "rare"),
  def("fatian", "法天象地", "rare"),
  def("danao", "大闹天宫", "rare"),
  def("jiuzhuan", "九转兵劫印", "rare"),
  def("xiuli", "袖里乾坤", "rare"),
  def("sanmei", "三昧真火", "rare", { negative: true }),
  def("zijin", "紫金红葫芦", "rare", { negative: true }),
  def("zhaoyao", "玄天照妖镜", "rare", { passive: true }),
  def("beishui", "背水阵", "rare", { bigBattle: true }),
  def("jiancheng", "坚城令", "rare", { bigBattle: true }),
  def("qiankun", "乾坤圈", "rare", { bigBattle: true }),
  def("bagua", "八卦炉", "epic"),
  def("qibao", "七宝紫金钵", "epic", { negative: true }),
  def("diaobing", "调兵符", "epic", { bigBattle: true }),
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function itemDef(id: string): ItemDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`unknown item ${id}`);
  return d;
}

/** Common items for starter picks and loser chests (侦察令 is big-battle only and excluded, §8). */
export const REGULAR_COMMON_ITEMS = ["huanhun", "yujing", "jianbi", "bihuo", "taixu"] as const;

export function isItemEnabled(id: string, p: SeasonParams): boolean {
  return !p.items.disabled.includes(id);
}

/** Negative items on a lower-ranked target are multiplied by the punch-down factor (§13.1). Rank 1 is first. */
export function punchDownFactor(userRank: number, targetRank: number, p: SeasonParams): number {
  return targetRank > userRank ? p.items.punchDownFactor : 1;
}

export interface Defenses {
  zhaoyao: boolean;
  bihuo: boolean;
}

export type HitOutcome =
  | { kind: "hit" }
  | { kind: "blocked"; consumed: "bihuo" }
  | { kind: "reflected"; consumed: "zhaoyao"; multiplier: number };

/**
 * A negative item reaching one target (§13.1): 照妖镜 triggers first and
 * reflects the effect onto the user at 2× (no further reflection); otherwise
 * 辟火罩 blocks it; otherwise it hits.
 */
export function resolveHit(target: Defenses, p: SeasonParams): HitOutcome {
  if (target.zhaoyao) return { kind: "reflected", consumed: "zhaoyao", multiplier: p.items.zhaoyao.reflectMultiplier };
  if (target.bihuo) return { kind: "blocked", consumed: "bihuo" };
  return { kind: "hit" };
}

/** A points transfer between two teams. */
export interface PointsTransfer {
  from: string;
  to: string;
  amount: Pts;
}

export interface NegativeTarget {
  teamId: string;
  rank: number;
  defenses: Defenses;
}

export interface StealResult {
  teamId: string;
  outcome: HitOutcome;
  transfer: PointsTransfer | null;
}

function steal(base: number, userId: string, userRank: number, t: NegativeTarget, p: SeasonParams): StealResult {
  const factor = punchDownFactor(userRank, t.rank, p);
  const outcome = resolveHit(t.defenses, p);
  const amount = pts(base * factor);
  if (outcome.kind === "blocked" || amount === 0) return { teamId: t.teamId, outcome, transfer: null };
  if (outcome.kind === "reflected")
    return { teamId: t.teamId, outcome, transfer: { from: userId, to: t.teamId, amount: pts(base * factor * outcome.multiplier) } };
  return { teamId: t.teamId, outcome, transfer: { from: t.teamId, to: userId, amount } };
}

/** 紫金红葫芦: steal 5 points from one team (§13.4). */
export function useZijin(user: { teamId: string; rank: number }, target: NegativeTarget, p: SeasonParams): StealResult {
  return steal(p.items.zijin.pts, user.teamId, user.rank, target, p);
}

/** 七宝紫金钵: steal 3 points from every other team, each target's defences settled separately (§20.4). */
export function useQibao(
  user: { teamId: string; rank: number },
  others: readonly NegativeTarget[],
  p: SeasonParams,
): StealResult[] {
  return others.filter((o) => o.teamId !== user.teamId).map((o) => steal(p.items.qibao.ptsEach, user.teamId, user.rank, o, p));
}

/**
 * 三昧真火 (§13.4, §20.4): for 3 days, `share` of the victim's best land's daily
 * output goes to the beneficiary instead. Reflected, it hits the user's own
 * best land at 2× (the simulator applies the effect twice). It stops when the
 * land changes owner.
 */
export interface SanmeiEffect {
  kind: "sanmei";
  victim: string;
  beneficiary: string;
  landId: string;
  /** Fraction of the land's daily output moved (can exceed 1 when reflected). */
  share: number;
  from: Instant;
  until: Instant;
}

export function useSanmei(
  user: { teamId: string; rank: number; bestLandId: string | null },
  target: NegativeTarget & { bestLandId: string | null },
  at: Instant,
  p: SeasonParams,
): { outcome: HitOutcome; effect: SanmeiEffect | null } {
  const factor = punchDownFactor(user.rank, target.rank, p);
  const outcome = resolveHit(target.defenses, p);
  const until = at + p.items.sanmei.days * DAY;
  if (outcome.kind === "blocked") return { outcome, effect: null };
  if (outcome.kind === "reflected") {
    if (!user.bestLandId) return { outcome, effect: null };
    return {
      outcome,
      effect: { kind: "sanmei", victim: user.teamId, beneficiary: target.teamId, landId: user.bestLandId, share: factor * outcome.multiplier, from: at, until },
    };
  }
  if (!target.bestLandId) return { outcome, effect: null };
  return {
    outcome,
    effect: { kind: "sanmei", victim: target.teamId, beneficiary: user.teamId, landId: target.bestLandId, share: factor, from: at, until },
  };
}

/** 三昧真火 can only target a team that holds a land. */
export function canUseSanmei(targetLandCount: number): boolean {
  return targetLandCount > 0;
}

/** 法天象地: usable while the team holds ≥ 3 lands; +10 at once. */
export function fatianPoints(heldLands: number, p: SeasonParams): Pts | null {
  return heldLands >= p.items.fatian.minLands ? pts(p.items.fatian.pts) : null;
}

/** 生死簿: +7 at once; the chosen land earns nothing for 4 days. */
export function shengsiEffect(teamId: string, landId: string, at: Instant, p: SeasonParams) {
  return { points: pts(p.items.shengsi.pts), zeroLand: { teamId, landId, from: at, until: at + p.items.shengsi.days * DAY } };
}

/** 点化之术: every land of the team earns +1 a day for 3 days (not diminished). */
export function dianhuaEffect(teamId: string, at: Instant, p: SeasonParams) {
  return { kind: "dianhua" as const, teamId, bonusPerLand: p.items.dianhua.bonusPerLand, from: at, until: at + p.items.dianhua.days * DAY };
}

/** 九转兵劫印: merit points doubled for 5 days. */
export function jiuzhuanWindow(teamId: string, at: Instant, p: SeasonParams) {
  return { teamId, from: at, until: at + p.items.jiuzhuan.days * DAY };
}

/** 袖里乾坤: cancels a contest on the team's land; each attacker gets half its grain back, rounded down. */
export function xiuliRefund(paid: number, p: SeasonParams): number {
  return floorGrain(paid * p.items.xiuli.refundRatio);
}

/** 坚壁清野: when the defender holds, each attacker −3 and the defender +3 per attacker. */
export function jianbiTransfers(defender: string, attackers: readonly string[], p: SeasonParams): PointsTransfer[] {
  return attackers.map((a) => ({ from: a, to: defender, amount: pts(p.items.jianbi.pts) }));
}

/**
 * 太虚幻镜 copies the most recently used non-epic item, including a passive item
 * that triggered, but never 太虚幻镜 itself (§13.1, §20.4). Returns the id to
 * copy, or null.
 */
export function taixuCopyTarget(usedItemsNewestFirst: readonly string[]): string | null {
  for (const id of usedItemsNewestFirst) {
    const d = BY_ID.get(id);
    if (!d || d.tier === "epic" || id === "taixu") continue;
    return id;
  }
  return null;
}

/** 八卦炉: +1.5 a day on the chosen land while the team holds it, through D28 (§13.4). */
export function baguaDailyBonus(stillOwned: boolean, seasonDay: number, p: SeasonParams): Pts {
  return stillOwned && seasonDay <= p.items.bagua.lastDay ? pts(p.items.bagua.dailyBonus) : 0;
}
