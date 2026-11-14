/**
 * Season state (PRD part 3; data model in part 4).
 *
 * The state is plain JSON: teams, lands, held items, continuing effects,
 * contests and the append-only ledger. Event handlers (in this folder) take a
 * state and an event and return a new state plus notices; they never mutate
 * their input, never read the clock (every event carries `at`) and draw random
 * numbers only from a seeded Rng derived from the season seed and the event.
 */

import { balanceOf, grainEntry, pointsEntry, type GrainSource, type LedgerEntry, type PointsSource } from "../ledger.js";
import { ITEMS } from "../items.js";
import { landCounts, type SeasonParams } from "../params.js";
import { rankTeams, type Ranked } from "../ranking.js";
import { createRng, seedFromString, type Rng } from "../rng.js";
import type { LandKind } from "../territory.js";
import { beijingDate, type DateStr, type DayKindOverrides, type Instant } from "../time.js";
import { assertInt, type Pts } from "../units.js";

export interface MemberState {
  childId: string;
  grade: number;
  /** False once the member has left the season (§5). */
  active: boolean;
}

export interface HeldItem {
  /** Unique id of this copy of the item. */
  uid: string;
  itemId: string;
  source: "opening" | "chest" | "shop" | "auction" | "copy" | "admin";
  acquiredAt: Instant;
}

export interface TeamState {
  id: string;
  name: string;
  members: MemberState[];
  leader: string | null;
  deputy: string | null;
  items: HeldItem[];
  /** Weekly-war wins and merit count break ranking ties (§1). */
  warWins: number;
  meritCount: number;
}

export interface LandState {
  id: string;
  kind: LandKind;
  owner: string | null;
  /** When the current owner took it (null while unowned). */
  ownedSince: Instant | null;
}

export interface ContestAttacker {
  teamId: string;
  /** 0 for the starter, then 1, 2, … in join order. */
  order: number;
  paid: number;
  joinedAt: Instant;
}

export type ContestStatus = "active" | "settled" | "cancelled";

export interface ContestState {
  id: string;
  landId: string;
  defender: string;
  promptId: string;
  startedAt: Instant;
  joinDeadline: Instant;
  deadline: Instant;
  attackers: ContestAttacker[];
  status: ContestStatus;
  outcome?: { kind: "captured"; winner: string } | { kind: "defended" } | { kind: "nothing" } | { kind: "cancelled"; by: "xiuli" | "admin" };
  settledAt?: Instant;
}

/** Continuing effects of items (§13.4). Windows are [from, until). */
export type Effect =
  | { kind: "huanhun"; teamId: string; from: Instant; until: Instant }
  | { kind: "dianhua"; teamId: string; bonusPerLand: number; from: Instant; until: Instant }
  | { kind: "jiuzhuan"; teamId: string; from: Instant; until: Instant }
  | { kind: "shengsi"; teamId: string; landId: string; from: Instant; until: Instant }
  | {
      kind: "bagua";
      teamId: string;
      landId: string;
      from: Instant;
      /** Set when the land changes owner: the furnace is gone for good (same as the simulator). */
      endedAt?: Instant;
    }
  | {
      kind: "sanmei";
      victim: string;
      beneficiary: string;
      landId: string;
      share: number;
      from: Instant;
      until: Instant;
      /** Set when the land changed owner: no transfers from then on (§20.4). */
      endedAt?: Instant;
    }
  | { kind: "yujing"; teamId: string; week: number; at: Instant }
  | { kind: "danao"; teamId: string; week: number; at: Instant };

export interface UsedItem {
  itemId: string;
  teamId: string;
  at: Instant;
  /** True when a passive item triggered rather than being used by hand. */
  triggered: boolean;
}

export interface TaskPass {
  id: string;
  childId: string;
  teamId: string;
  submittedAt: Instant;
  /** Beijing date of submission: the day the task counts for (§7). */
  date: DateStr;
  week: number;
  counted: boolean;
  grain: number;
}

export interface EpicAuctionState {
  itemId: string;
  startAt: Instant;
  endAt: Instant;
  bids: { teamId: string; amount: number; at: Instant }[];
  closed: boolean;
  winner: string | null;
}

export interface ShopState {
  /** Items each team bought in the mid-season shop (any tier, auctions included). */
  bought: Record<string, string[]>;
  /** Rare items left per kind (§13.3: 2 per kind per server). */
  rareStock: Record<string, number>;
  auctions: EpicAuctionState[];
}

export interface WarState {
  week: number;
  pairs: [string, string][];
  bye: string | null;
  pairedAt: Instant;
  settled: boolean;
  results?: { teamId: string; outcome: "win" | "lose" | "tie" | "bye"; points: Pts; chestItem: string | null }[];
}

export type Camp = "a" | "b";

export interface BigBattleState {
  camps: Record<Camp, string[]>;
  lineValues: number[];
  formedAt: Instant;
  /** Latest submission per camp: line index → team (§14). */
  submitted: Record<Camp, { lines: string[]; by: string | null; at: Instant } | null>;
  /** Locked at D29 21:00 (missing or invalid submissions completed at random). */
  final: Record<Camp, string[]> | null;
  lockedAt: Instant | null;
  /** Big-battle items activated per team. */
  flags: Record<string, { beishui?: boolean; jiancheng?: boolean; qiankun?: boolean }>;
  settled: boolean;
}

export interface FinalResult {
  at: Instant;
  ranking: { teamId: string; rank: number; points: Pts }[];
  scholarship: { teamId: string; yuan: number }[];
  poolYuan: number;
}

export interface SeasonState {
  seasonId: string;
  seed: number;
  /** Beijing date of D0 (a Sunday). */
  opening: DateStr;
  params: SeasonParams;
  calendar: DayKindOverrides;
  teams: Record<string, TeamState>;
  /** Team ids in a fixed order (creation order). */
  teamOrder: string[];
  lands: Record<string, LandState>;
  landOrder: string[];
  contests: Record<string, ContestState>;
  contestOrder: string[];
  effects: Effect[];
  /** Newest last. Feeds 太虚幻镜 (§13.1, §20.4). */
  usedItems: UsedItem[];
  /** Enabled prompts per land, and the ones already drawn this season (§10.1). */
  prompts: Record<string, string[]>;
  usedPrompts: Record<string, string[]>;
  ledger: LedgerEntry[];
  /** Days whose 24:00 territory settlement has run (idempotency, §16). */
  settledDays: number[];
  /** Keys of one-off events that have run, e.g. "auction", "starter", "center_round", "participation:1" (idempotency). */
  done: string[];
  /** D1 auction processing order, highest bid first (starter items are picked in reverse, §8). */
  auctionOrder: string[] | null;
  /** Passed daily tasks as they were counted (§7). */
  taskPasses: TaskPass[];
  shop: ShopState;
  /** Weekly wars by week number (§11). */
  wars: Record<string, WarState>;
  bigBattle: BigBattleState | null;
  final: FinalResult | null;
  paused: boolean;
  /** Pause intervals; open while `until` is null (§16: scheduled events shift by the paused time). */
  pauses: { from: Instant; until: Instant | null; reason?: string }[];
  /** Counter for deterministic ids. */
  seq: number;
}

export interface Notice {
  kind: string;
  at: Instant;
  /** Real-time broadcast (§1.2) vs. result for the next report. */
  broadcast: boolean;
  data: Record<string, unknown>;
}

export type Result<R extends string> =
  | { ok: true; state: SeasonState; notices: Notice[] }
  | { ok: false; refusal: R; detail?: string };

export interface CreateSeasonInput {
  seasonId: string;
  seed: number;
  opening: DateStr;
  params: SeasonParams;
  calendar?: DayKindOverrides;
  teams: { id: string; name: string; members: { childId: string; grade: number }[] }[];
  lands: { id: string; kind: LandKind }[];
  prompts?: Record<string, string[]>;
  /** When the opening grain is credited (default 0). */
  at?: Instant;
}

/** The standard map for a server with `teams` teams: edge lands E1…En, center lands C1…Cn/2 (§4, §20.1). */
export function standardLands(teams: number): { id: string; kind: LandKind }[] {
  const { edge, center } = landCounts(teams);
  return [
    ...Array.from({ length: edge }, (_, i) => ({ id: `E${i + 1}`, kind: "edge" as const })),
    ...Array.from({ length: center }, (_, i) => ({ id: `C${i + 1}`, kind: "center" as const })),
  ];
}

/** A fresh season: every team gets the opening grain (§17: 60). */
export function createSeasonState(i: CreateSeasonInput): SeasonState {
  const s: SeasonState = {
    seasonId: i.seasonId,
    seed: i.seed,
    opening: i.opening,
    params: i.params,
    calendar: { ...(i.calendar ?? {}) },
    teams: {},
    teamOrder: [],
    lands: {},
    landOrder: [],
    contests: {},
    contestOrder: [],
    effects: [],
    usedItems: [],
    prompts: Object.fromEntries(i.lands.map((l) => [l.id, [...(i.prompts?.[l.id] ?? [])]])),
    usedPrompts: Object.fromEntries(i.lands.map((l) => [l.id, []])),
    ledger: [],
    settledDays: [],
    done: [],
    auctionOrder: null,
    taskPasses: [],
    shop: {
      bought: Object.fromEntries(i.teams.map((t) => [t.id, []])),
      rareStock: Object.fromEntries(ITEMS.filter((it) => it.tier === "rare").map((it) => [it.id, i.params.items.rareStockPerKind])),
      auctions: [],
    },
    wars: {},
    bigBattle: null,
    final: null,
    paused: false,
    pauses: [],
    seq: 0,
  };
  for (const t of i.teams) {
    if (s.teams[t.id]) throw new Error(`duplicate team ${t.id}`);
    s.teams[t.id] = {
      id: t.id,
      name: t.name,
      members: t.members.map((m) => ({ ...m, active: true })),
      leader: null,
      deputy: null,
      items: [],
      warWins: 0,
      meritCount: 0,
    };
    s.teamOrder.push(t.id);
  }
  for (const l of i.lands) {
    if (s.lands[l.id]) throw new Error(`duplicate land ${l.id}`);
    s.lands[l.id] = { id: l.id, kind: l.kind, owner: null, ownedSince: null };
    s.landOrder.push(l.id);
  }
  for (const t of s.teamOrder) addGrain(s, t, i.params.opening.grain, "opening", i.at ?? 0);
  return s;
}

/**
 * Handlers work on a copy so the caller's state is never mutated. Append-only
 * logs (ledger, task passes, used items) hold entries that are never changed
 * after they are written, so the copy shares those entries and only copies the
 * arrays; everything else is deep-copied.
 */
/**
 * A time from the season calendar, moved by every finished pause that began
 * before it (§16 "所有计划事件顺延", §18 "截止时间自动顺延暂停的时长").
 * A pause still open does not move anything yet: the times move on resume,
 * like the contest deadlines and the planned events.
 */
export function afterPauses(s: Pick<SeasonState, "pauses">, t: Instant): Instant {
  let out = t;
  for (const p of [...(s.pauses ?? [])].sort((a, b) => a.from - b.from)) {
    if (p.until !== null && p.from < out) out += p.until - p.from;
  }
  return out;
}

export function cloneState(s: SeasonState): SeasonState {
  const { ledger, taskPasses, usedItems, ...rest } = s;
  const copy = JSON.parse(JSON.stringify(rest)) as Omit<SeasonState, "ledger" | "taskPasses" | "usedItems">;
  return { ...copy, ledger: ledger.slice(), taskPasses: taskPasses.slice(), usedItems: usedItems.slice() };
}

export function nextId(s: SeasonState, prefix: string): string {
  s.seq += 1;
  return `${prefix}${s.seq}`;
}

/** Rng for one event: the same season seed and key always draw the same numbers. */
export function eventRng(s: SeasonState, key: string): Rng {
  return createRng(seedFromString(`${s.seed}|${key}`));
}

export function team(s: SeasonState, id: string): TeamState {
  const t = s.teams[id];
  if (!t) throw new Error(`unknown team ${id}`);
  return t;
}

export function land(s: SeasonState, id: string): LandState {
  const l = s.lands[id];
  if (!l) throw new Error(`unknown land ${id}`);
  return l;
}

// ---- ledger -------------------------------------------------------------

export function addGrain(
  s: SeasonState,
  teamId: string,
  amount: number,
  source: GrainSource,
  at: Instant,
  extra: { refId?: string; note?: string } = {},
): LedgerEntry | null {
  assertInt("grain", amount);
  if (amount === 0) return null;
  const e = grainEntry({ id: nextId(s, "L"), teamId, amount, source, at, ...extra });
  s.ledger.push(e);
  return e;
}

export function addPoints(
  s: SeasonState,
  teamId: string,
  amount: Pts,
  source: PointsSource,
  at: Instant,
  extra: { refId?: string; note?: string } = {},
): LedgerEntry | null {
  assertInt("points (hundredths)", amount);
  if (amount === 0) return null;
  const e = pointsEntry({ id: nextId(s, "L"), teamId, amount, source, at, ...extra });
  s.ledger.push(e);
  return e;
}

/** Move points between teams as two entries with the same source and ref. */
export function transferPoints(
  s: SeasonState,
  from: string,
  to: string,
  amount: Pts,
  source: PointsSource,
  at: Instant,
  extra: { refId?: string; note?: string } = {},
): void {
  addPoints(s, from, -amount, source, at, extra);
  addPoints(s, to, amount, source, at, extra);
}

export function grainOf(s: SeasonState, teamId: string): number {
  return balanceOf(s.ledger, teamId, "grain");
}

export function pointsOf(s: SeasonState, teamId: string): Pts {
  return balanceOf(s.ledger, teamId, "points");
}

/** Grain frozen by the team's leading bids on open epic auctions (§13.3). */
export function frozenGrain(s: SeasonState, teamId: string): number {
  let sum = 0;
  for (const a of s.shop.auctions) {
    if (a.closed) continue;
    const lead = a.bids[a.bids.length - 1];
    if (lead && lead.teamId === teamId) sum += lead.amount;
  }
  return sum;
}

/** Grain the team can spend now: balance minus grain frozen by leading bids. */
export function spendableGrain(s: SeasonState, teamId: string): number {
  return grainOf(s, teamId) - frozenGrain(s, teamId);
}

// ---- queries ------------------------------------------------------------

export function landsOf(s: SeasonState, teamId: string): LandState[] {
  return s.landOrder.map((id) => s.lands[id] as LandState).filter((l) => l.owner === teamId);
}

/**
 * Current ranking (§1): points, then war wins, then merit count, then a seeded
 * draw. The draw is the same for the whole Beijing day, so teams still tied
 * do not swap places every time someone looks (the rule is unchanged: ties
 * are broken at random).
 */
export function rankingAt(s: SeasonState, at: Instant): Ranked[] {
  const rng = eventRng(s, `rank|${beijingDate(at)}`);
  return rankTeams(
    s.teamOrder.map((id) => {
      const t = s.teams[id] as TeamState;
      return { teamId: id, points: pointsOf(s, id), warWins: t.warWins, meritCount: t.meritCount };
    }),
    rng,
  );
}

export function rankOf(ranking: readonly Ranked[], teamId: string): number {
  const r = ranking.find((x) => x.teamId === teamId);
  if (!r) throw new Error(`team ${teamId} not ranked`);
  return r.rank;
}

/** Attacks the team is in (started or joined) that are not settled or cancelled (§20.2). */
export function activeAttackCount(s: SeasonState, teamId: string): number {
  let n = 0;
  for (const id of s.contestOrder) {
    const c = s.contests[id] as ContestState;
    if (c.status === "active" && c.attackers.some((a) => a.teamId === teamId)) n++;
  }
  return n;
}

export function activeContestOnLand(s: SeasonState, landId: string): ContestState | null {
  for (const id of s.contestOrder) {
    const c = s.contests[id] as ContestState;
    if (c.status === "active" && c.landId === landId) return c;
  }
  return null;
}

export function hasItem(s: SeasonState, teamId: string, itemId: string): boolean {
  return team(s, teamId).items.some((i) => i.itemId === itemId);
}

/** Remove one copy of an item (the oldest) and return it, or null. */
export function takeItem(s: SeasonState, teamId: string, itemId: string, uid?: string): HeldItem | null {
  const t = team(s, teamId);
  const idx = t.items.findIndex((i) => i.itemId === itemId && (uid === undefined || i.uid === uid));
  if (idx < 0) return null;
  const [it] = t.items.splice(idx, 1);
  return it ?? null;
}

export function giveItem(s: SeasonState, teamId: string, itemId: string, source: HeldItem["source"], at: Instant): HeldItem {
  const it: HeldItem = { uid: nextId(s, "I"), itemId, source, acquiredAt: at };
  team(s, teamId).items.push(it);
  return it;
}

export function effectActive(e: { from: Instant; until?: Instant }, at: Instant): boolean {
  return at >= e.from && (e.until === undefined || at < e.until);
}

/** 九转兵劫印 doubles merit while active (§13.4). */
export function jiuzhuanActive(s: SeasonState, teamId: string, at: Instant): boolean {
  return s.effects.some((e) => e.kind === "jiuzhuan" && e.teamId === teamId && effectActive(e, at));
}

/** 生死簿 zeroes a land for 4 days (§6). */
export function landZeroed(s: SeasonState, landId: string, at: Instant): boolean {
  return s.effects.some((e) => e.kind === "shengsi" && e.landId === landId && effectActive(e, at));
}

/** The team a child plays for, or null. */
export function teamOfChild(s: SeasonState, childId: string): string | null {
  for (const id of s.teamOrder) if (s.teams[id]!.members.some((m) => m.childId === childId)) return id;
  return null;
}

export function notice(kind: string, at: Instant, broadcast: boolean, data: Record<string, unknown> = {}): Notice {
  return { kind, at, broadcast, data };
}

export function logUsedItem(s: SeasonState, itemId: string, teamId: string, at: Instant, triggered: boolean): void {
  s.usedItems.push({ itemId, teamId, at, triggered });
}
