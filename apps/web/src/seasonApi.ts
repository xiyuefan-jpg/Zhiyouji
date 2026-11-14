/**
 * The season endpoints (apps/server README "学生端 · 赛季"). Shapes are the
 * server's JSON; only what the pages use is typed.
 */

import { request } from "./api";

export interface Member {
  childId: string;
  nickname: string;
  avatar: string;
  gradeLabel: string;
  role: "leader" | "deputy" | "member";
  active: boolean;
  me: boolean;
}

export type SeasonMe =
  | { status: "none" }
  | { status: "waiting"; season: { id: string; name: string; statusLabel: string; opening: string } }
  | {
      status: "playing";
      season: { id: string; name: string; status: string; statusLabel: string; opening: string; day: number; paused: boolean; days?: { shopOpen: number; shopClose: number; bigBattle: number; end: number } };
      server: { id: string; name: string };
      team: { id: string; name: string; hasWechatQr: boolean };
      role: "leader" | "deputy" | "member";
      active: boolean;
      canAct: boolean;
      members: Member[];
    };

export interface LandView {
  id: string;
  name: string;
  kind: "edge" | "center";
  output: number;
  zeroed: boolean;
  owner: { id: string; name: string } | null;
  ownedSince?: number | null;
  /** Today's price of an unsold center land (after the D8 round). */
  price?: number | null;
  mine: boolean;
  /** The land's subject and question type (what a team must explain to win or keep it). */
  subject?: string | null;
  questionType?: string | null;
  contest: { id: string; defender: { id: string; name: string } | null; attackers: ({ id: string; name: string } | null)[]; joinDeadline: number; deadline: number; involved?: boolean } | null;
  effects: { kind: string; name?: string; until: number | null }[];
}

export interface TeamView {
  id: string;
  name: string;
  rank: number | null;
  /** After the final settlement: this team's scholarship (yuan). */
  scholarshipYuan?: number | null;
  points: number;
  grain: number;
  frozenGrain: number;
  spendableGrain: number;
  lands: string[];
  items: { uid: string; itemId: string; name: string; tier: string; passive: boolean; bigBattle: boolean; negative: boolean; source: string }[];
  contests: { id: string; landId: string; role: "attacker" | "defender"; status: string; deadline: number }[];
}

export interface FeedLine {
  kind: string;
  at: number;
  scope: "server" | "team";
  text: string;
}

export interface Quote {
  landId: string;
  contestId: string | null;
  defender: string;
  base: number;
  cost: number;
  exile: boolean;
  crusade: boolean;
  /** How the base is made: 基础 + 同时进行的场数 + 持有的地 (§3.2). */
  parts?: { label: string; amount: number }[];
  /** 流亡令 ×0.5, 讨伐令 ×0.7 when they apply. */
  factors?: { label: string; factor: number }[];
  /** Join deadline and work deadline of this contest (a new one: if started now). */
  joinDeadline?: number;
  deadline?: number;
  grain: number;
}

export type ItemTarget = "none" | "team" | "own_land" | "contest" | "week" | "line" | "passive";

export interface CatalogueItem {
  id: string;
  name: string;
  tier: "common" | "rare" | "epic";
  passive: boolean;
  negative: boolean;
  bigBattle: boolean;
  when: string;
  target: ItemTarget;
  effect: string;
  broadcast: boolean;
}

export interface HeldItem {
  uid: string;
  itemId: string;
  name: string;
  tier: string;
  passive: boolean;
  bigBattle: boolean;
  negative: boolean;
  source: string;
}

export interface TeamFull extends TeamView {
  effects: { kind: string; teamId?: string; victim?: string; beneficiary?: string; landId?: string; until?: number; week?: number; endedAt?: number }[];
  contests: (TeamView["contests"][number] & { joinDeadline: number; promptId: string; outcome: ContestOutcome | null })[];
}

export type ContestOutcome = { kind: "captured"; winner: string } | { kind: "defended" } | { kind: "nothing" } | { kind: "cancelled"; by: "xiuli" | "admin" };

export interface TaskInfo {
  title: string | null;
  body: string | null;
  audience: string;
  questionType: string | null;
  subject: string | null;
  landName: string | null;
  juniorHint: string | null;
}

export interface RubricGuide {
  id: string;
  name: string;
  dims: { key: string; name: string; max: number; hint: string }[];
  at50: string;
  at75: string;
}

export interface ContestDetail {
  id: string;
  landId: string;
  status: string;
  prompt: { title: string; body: string; audience: string | null; questionType: string | null } | null;
  task?: TaskInfo;
  rubric?: RubricGuide;
  requirements?: string;
  defender: { id: string; name: string };
  attackers: { id: string; name: string; order: number; joinedAt: number; paid?: number }[];
  startedAt: number;
  joinDeadline: number;
  deadline: number;
  involved: boolean;
  outcome: ContestOutcome | null;
  settledAt: number | null;
}

export type DebateView =
  | { debate: false }
  | {
      debate: true;
      mySide: "pro" | "con" | null;
      sideBy: string | null;
      sideDeadline: string;
      openingDeadline: string;
      deadline: string;
      stage: "opening" | "rebuttal" | "closed";
      noDefender: boolean;
      openings: { teamId: string; team: string; text: string | null; files: { id: string; kind: string; url: string }[] }[];
    };

export type RoundName = "blind_auction" | "starter_items" | "center_round" | "rare_round";

export interface RoundView {
  round: RoundName;
  opensAt: string | null;
  deadline: string | null;
  open: boolean;
  closed: boolean;
  submission: { bid: number | null; prefs: string[]; by: string; at: string } | null;
  /** Each choice with its land subject or item effect. */
  options?: { id: string; name: string; detail: string }[];
  /** The rules in plain words (cost, order). */
  rules?: string;
  /** Blind auction, after the deadline: every team's bid and land. */
  result?: { team: string; land: string; paid: number; mine: boolean }[] | null;
}

export interface UseItemBody {
  itemId: string;
  uid?: string;
  targetTeamId?: string;
  landId?: string;
  contestId?: string;
  week?: number;
  line?: number;
}

export interface UseItemResult extends TeamFull {
  used: {
    itemId: string;
    copied: { id: string; name: string } | null;
    outcomes: { teamId: string; team: string; outcome: "hit" | "blocked" | "reflected" }[];
    /** 侦察令: who the other camp has put on that line right now (only this team learns it). */
    scouted?: { line: number; opponent: { id: string; name: string } | null } | null;
  };
}

export interface Transfer {
  id: string;
  role: "leader" | "deputy";
  from: string;
  to: string;
  createdAt: string;
  forMe: boolean;
}

export const seasonApi = {
  me: () => request<SeasonMe>("GET", "/v1/season/me"),
  map: () => request<{ lands: LandView[]; teams: { id: string; name: string; mine: boolean }[] }>("GET", "/v1/season/map"),
  ranking: () =>
    request<{ final: { poolYuan: number } | null; ranking: { rank: number; teamId: string; name: string; points: number; lands: number; mine: boolean; scholarshipYuan: number | null }[] }>("GET", "/v1/season/ranking"),
  team: () => request<TeamView>("GET", "/v1/season/team"),
  ledger: (currency: "grain" | "points") => request<{ balance: number; entries: { id: string; amount: number; source: string; note: string | null; at: number }[] }>("GET", `/v1/season/ledger?currency=${currency}`),
  claim: (role: "leader" | "deputy") => request<SeasonMe>("POST", "/v1/season/roles/claim", { role }),
  quote: (landId: string) => request<Quote>("GET", `/v1/season/lands/${landId}/quote`),
  attack: (landId: string) => request<{ contest: { id: string; deadline: number; paid: number } }>("POST", "/v1/season/contests", { landId }),
  join: (contestId: string) => request<{ contest: { id: string; deadline: number; paid: number } }>("POST", `/v1/season/contests/${contestId}/join`),
  buyCenter: (landId: string) => request<TeamView>("POST", "/v1/season/center-lands/buy", { landId }),
  reports: () => request<{ reports: { id: string; publishAt: string; title: string }[] }>("GET", "/v1/season/reports"),
  report: (id: string) => request<{ id: string; title: string; lines: FeedLine[]; ranking: { rank: number; name: string; points: number; mine: boolean }[] }>("GET", `/v1/season/reports/${id}`),
  broadcasts: () => request<{ lines: FeedLine[] }>("GET", "/v1/season/broadcasts"),
  teamFeed: () => request<{ lines: FeedLine[] }>("GET", "/v1/season/team-feed"),
  teamFull: () => request<TeamFull>("GET", "/v1/season/team"),
  catalogue: () => request<{ items: CatalogueItem[]; punchDownFactor: number; taixuCopies: string | null }>("GET", "/v1/season/items"),
  useItem: (b: UseItemBody) => request<UseItemResult>("POST", "/v1/season/items/use", b),
  contest: (id: string) => request<ContestDetail>("GET", `/v1/season/contests/${encodeURIComponent(id)}`),
  debate: (id: string) => request<DebateView>("GET", `/v1/season/contests/${encodeURIComponent(id)}/debate`),
  chooseSide: (id: string, side: "pro" | "con") => request<DebateView>("POST", `/v1/season/contests/${encodeURIComponent(id)}/side`, { side }),
  transfers: () => request<{ transfers: Transfer[] }>("GET", "/v1/season/roles/transfers"),
  offerRole: (role: "leader" | "deputy", to: string) => request<{ transfer: { id: string; status: string } }>("POST", "/v1/season/roles/offer", { role, to }),
  answerTransfer: (id: string, accept: boolean) => request<SeasonMe>("POST", `/v1/season/roles/transfers/${id}`, { accept }),
  takeOver: () => request<SeasonMe>("POST", "/v1/season/roles/take-over"),
  round: (r: RoundName) => request<RoundView>("GET", `/v1/season/rounds/${r}`),
  submitRound: (r: RoundName, b: { bid?: number; prefs: string[] }) => request<RoundView>("POST", `/v1/season/rounds/${r}`, b),
};

/** Team points are stored in hundredths; shown with one decimal (CLAUDE.md). */
export function points(p: number): string {
  return (p / 100).toFixed(1);
}
