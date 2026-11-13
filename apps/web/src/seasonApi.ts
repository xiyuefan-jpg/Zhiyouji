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
      season: { id: string; name: string; status: string; statusLabel: string; opening: string; day: number; paused: boolean };
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
  mine: boolean;
  contest: { id: string; defender: { id: string; name: string } | null; attackers: ({ id: string; name: string } | null)[]; joinDeadline: number; deadline: number } | null;
  effects: { kind: string; until: number | null }[];
}

export interface TeamView {
  id: string;
  name: string;
  rank: number | null;
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
  grain: number;
}

export const seasonApi = {
  me: () => request<SeasonMe>("GET", "/v1/season/me"),
  map: () => request<{ lands: LandView[]; teams: { id: string; name: string; mine: boolean }[] }>("GET", "/v1/season/map"),
  ranking: () => request<{ ranking: { rank: number; teamId: string; name: string; points: number; lands: number; mine: boolean }[] }>("GET", "/v1/season/ranking"),
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
};

/** Team points are stored in hundredths; shown with one decimal (CLAUDE.md). */
export function points(p: number): string {
  return (p / 100).toFixed(1);
}
