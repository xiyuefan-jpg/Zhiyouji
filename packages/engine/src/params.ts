/**
 * Season parameters. Every number in PRD part 3 §17 (and the item effects in
 * §13.4 / §20) lives here; nothing is hard-coded elsewhere in the engine.
 * The admin console edits a copy of this object and stores it as a new
 * parameter version.
 */

export interface SeasonParams {
  time: {
    /** All submission deadlines are at this Beijing hour (21:00). */
    deadlineHour: number;
    /** Publication hours [morning, noon, evening] on school days. */
    publishSchoolDay: [number, number, number];
    /** Publication hours [morning, noon, evening] on rest days. */
    publishRestDay: [number, number, number];
    /** D0 .. D33. */
    seasonDays: number;
    bigBattleDays: number;
    /** Big battle starts on this day (D29). */
    bigBattleStartDay: number;
    shopOpenDay: number;
    shopCloseDay: number;
  };
  grouping: {
    /** Every server has exactly this many teams (§20.1: fixed at 8). */
    teamsPerServer: number;
    /** A server holds at most teamsPerServer × maxTeamSize players; more → another server. */
    maxTeamSize: number;
  };
  team: {
    /** Deputy may take over after the leader has not logged in for this many days. */
    leaderInactiveDays: number;
  };
  dailyTask: {
    grainPerTask: number;
    capPerDay: number;
    capPerWeek: number;
    /** Grain is earned from this season day on (§20.2). */
    grainFromDay: number;
  };
  participation: {
    ratio: number;
    minTasks: number;
    bonus: number;
    /** Only weeks 1..weeks are checked (§20.2). */
    weeks: number;
  };
  territory: {
    edgeOutput: number;
    centerOutput: number;
    /** The first `fullCount` lands (by value) earn in full. */
    fullCount: number;
    /** The n-th land earns decay^(n - fullCount). */
    decay: number;
  };
  centerLand: {
    openDay: number;
    price: number;
    minFactor: number;
  };
  contest: {
    baseCost: number;
    perActiveAttack: number;
    perLand: number;
    exileFactor: number;
    crusadeFactor: number;
    joinWindowDays: number;
    durationDays: number;
    qualityLine: number;
    meritCapture: number;
    meritDefend: number;
    lastInitiationDay: number;
    debateSideHours: number;
    debateOpeningDay: number;
  };
  review: {
    timeoutHours: number;
    remindBeforeHours: number;
    doubleReviewRatio: number;
    diffAlert: number;
    /** W4 review must finish by this publication slot on the big battle start day. */
    w4DeadlineSlot: PublicationSlot;
  };
  war: {
    win: number;
    lose: number;
    bye: number;
    tie: number;
    /** Weeks with gift cards (互赠周). */
    giftWeeks: number[];
  };
  supply: {
    /** Score boundaries for the grain tiers: <50, 50–65, ≥65. */
    tierBounds: [number, number];
    tierGrain: [number, number, number];
    participationWeight: number;
    qualityWeight: number;
    summaryWeight: number;
  };
  opening: {
    grain: number;
    freeItems: number;
    /** Stock per common item kind; null = teams / 2 (§20.1). */
    stockPerKind: number | null;
  };
  items: {
    /** Effects of negative items on a lower-ranked target are multiplied by this (打低倍率). */
    punchDownFactor: number;
    commonPrice: number;
    rarePrice: number;
    rareStockPerKind: number;
    epicStartPrice: number;
    epicIncrement: number;
    epicAuctionHours: number;
    antiSnipeMinutes: number;
    shopMaxItems: number;
    shopMaxEpic: number;
    loserChestEnabled: boolean;
    huanhun: { grainPerTask: number; days: number };
    jianbi: { pts: number };
    dianhua: { bonusPerLand: number; days: number };
    shengsi: { pts: number; days: number };
    fatian: { pts: number; minLands: number };
    danao: { win: number; lose: number };
    jiuzhuan: { multiplier: number; days: number };
    xiuli: { refundRatio: number };
    sanmei: { days: number };
    zijin: { pts: number };
    zhaoyao: { reflectMultiplier: number };
    beishui: { winMultiplier: number; losePenalty: number };
    qiankun: { win: number; lose: number };
    bagua: { dailyBonus: number; lastDay: number };
    qibao: { ptsEach: number };
    /** Item ids switched off by the admin. */
    disabled: string[];
  };
  bigBattle: {
    lines8: number[];
    lines6: number[];
    seizeDays: number;
    noLandCompFactor: number;
    mainWin: number;
  };
  final: {
    grainPerPoint: number;
  };
  scholarship: {
    rankDecay: number;
    scoreExponent: number;
    rankShare: number;
  };
}

export type PublicationSlot = "morning" | "noon" | "evening";

export const DEFAULT_PARAMS: SeasonParams = {
  time: {
    deadlineHour: 21,
    publishSchoolDay: [7, 12, 19],
    publishRestDay: [9, 14, 19],
    seasonDays: 33,
    bigBattleDays: 5,
    bigBattleStartDay: 29,
    shopOpenDay: 15,
    shopCloseDay: 17,
  },
  grouping: { teamsPerServer: 8, maxTeamSize: 11 },
  team: { leaderInactiveDays: 3 },
  dailyTask: { grainPerTask: 3, capPerDay: 2, capPerWeek: 4, grainFromDay: 1 },
  participation: { ratio: 0.75, minTasks: 2, bonus: 3, weeks: 4 },
  territory: { edgeOutput: 1, centerOutput: 2, fullCount: 2, decay: 0.6 },
  centerLand: { openDay: 8, price: 75, minFactor: 0.2 },
  contest: {
    baseCost: 30,
    perActiveAttack: 15,
    perLand: 10,
    exileFactor: 0.5,
    crusadeFactor: 0.7,
    joinWindowDays: 1,
    durationDays: 3,
    qualityLine: 50,
    meritCapture: 4,
    meritDefend: 3,
    lastInitiationDay: 25,
    debateSideHours: 12,
    debateOpeningDay: 2,
  },
  review: { timeoutHours: 24, remindBeforeHours: 6, doubleReviewRatio: 0.1, diffAlert: 10, w4DeadlineSlot: "noon" },
  war: { win: 15, lose: -5, bye: 5, tie: 5, giftWeeks: [2, 4] },
  supply: {
    tierBounds: [50, 65],
    tierGrain: [10, 20, 30],
    participationWeight: 40,
    qualityWeight: 40,
    summaryWeight: 20,
  },
  opening: { grain: 60, freeItems: 2, stockPerKind: null },
  items: {
    punchDownFactor: 0.5,
    commonPrice: 50,
    rarePrice: 80,
    rareStockPerKind: 2,
    epicStartPrice: 150,
    epicIncrement: 10,
    epicAuctionHours: 24,
    antiSnipeMinutes: 10,
    shopMaxItems: 3,
    shopMaxEpic: 1,
    loserChestEnabled: true,
    huanhun: { grainPerTask: 5, days: 7 },
    jianbi: { pts: 3 },
    dianhua: { bonusPerLand: 1, days: 3 },
    shengsi: { pts: 7, days: 4 },
    fatian: { pts: 10, minLands: 3 },
    danao: { win: 25, lose: -10 },
    jiuzhuan: { multiplier: 2, days: 5 },
    xiuli: { refundRatio: 0.5 },
    sanmei: { days: 3 },
    zijin: { pts: 5 },
    zhaoyao: { reflectMultiplier: 2 },
    beishui: { winMultiplier: 1.75, losePenalty: 10 },
    qiankun: { win: 12, lose: -8 },
    bagua: { dailyBonus: 1.5, lastDay: 28 },
    qibao: { ptsEach: 3 },
    disabled: [],
  },
  bigBattle: { lines8: [10, 15, 20, 25], lines6: [10, 18, 25], seizeDays: 5, noLandCompFactor: 0.8, mainWin: 12 },
  final: { grainPerPoint: 30 },
  scholarship: { rankDecay: 0.72, scoreExponent: 1.5, rankShare: 0.5 },
};

/** Deep-merge overrides onto the defaults (arrays are replaced, not merged). */
export function withParams(overrides: DeepPartial<SeasonParams> = {}, base: SeasonParams = DEFAULT_PARAMS): SeasonParams {
  return deepMerge(base, overrides) as SeasonParams;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Parameters are plain JSON, so a JSON round trip is a safe deep copy on every runtime (Node, Hermes, browsers). */
function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return clone(base);
  if (Array.isArray(over) || over === null || typeof over !== "object") return clone(over);
  const out: Record<string, unknown> = { ...(clone(base) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out;
}

/** Land counts for a server with `teams` teams (§4, §20.1). */
export function landCounts(teams: number): { edge: number; center: number } {
  if (teams < 2 || teams % 2 !== 0) throw new Error(`team count per server must be even and ≥ 2, got ${teams}`);
  return { edge: teams, center: teams / 2 };
}

/** Starter item stock per kind (§8, §20.1). */
export function openingStockPerKind(teams: number, p: SeasonParams): number {
  return p.opening.stockPerKind ?? teams / 2;
}

/** Big battle line values for a server with `teams` teams (§14, §20.1). */
export function battleLineValues(teams: number, p: SeasonParams): number[] {
  if (teams % 2 !== 0) throw new Error(`team count must be even, got ${teams}`);
  const n = teams / 2;
  if (teams === 8) return [...p.bigBattle.lines8];
  if (teams === 6) return [...p.bigBattle.lines6];
  if (n === 1) return [25];
  const lo = 10;
  const hi = 25;
  return Array.from({ length: n }, (_, i) => Math.round(lo + ((hi - lo) * i) / (n - 1)));
}

export interface ServerPlan {
  servers: number;
  teamsPerServer: number;
  /** Players per server, as even as possible. */
  playersPerServer: number[];
  /** Team sizes per server, as even as possible (differ by at most 1). */
  teamSizes: number[][];
}

/**
 * How many servers and how big the teams are (§4, §20.1): every server has
 * exactly 8 teams; one server takes up to 8 × 11 = 88 players, more players
 * open another server.
 */
export function planServers(players: number, p: SeasonParams): ServerPlan {
  const t = p.grouping.teamsPerServer;
  const cap = t * p.grouping.maxTeamSize;
  if (!Number.isInteger(players) || players < t) throw new Error(`need at least ${t} players, got ${players}`);
  const servers = Math.ceil(players / cap);
  const playersPerServer = splitEvenly(players, servers);
  return { servers, teamsPerServer: t, playersPerServer, teamSizes: playersPerServer.map((n) => splitEvenly(n, t)) };
}

function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
