/**
 * 对拍 (PRD part 9 §2): the same scenarios through the Python simulator
 * (tools/sim-python/parity.py → tools/parity/cases.json) and the rules engine.
 *
 * Differences that are by design:
 * - the engine rounds every points entry to 0.01, the simulator keeps floats
 *   → points are compared within a small tolerance.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  addPoints,
  attackCost,
  centerLandPrice,
  createSeasonState,
  grainConversion,
  joinContest,
  participationAward,
  pointsOf,
  settleContest,
  settleDay,
  settleWarMatch,
  standardLands,
  startContest,
  supplyGrain,
  useItem,
  beijingInstant,
  dateOfSeasonDay,
  type SeasonState,
  type TaskCount,
} from "@zhiyouji/engine";

interface Case {
  kind: string;
  input: Record<string, unknown>;
  expect: unknown;
}

const { cases } = JSON.parse(readFileSync(new URL("../../parity/cases.json", import.meta.url), "utf8")) as { cases: Case[] };

const OPENING = "2027-01-03";
const at = (d: number, h: number) => beijingInstant(dateOfSeasonDay(OPENING, d), h);
const TEAMS = Array.from({ length: 8 }, (_, i) => `T${i + 1}`);

function season(): SeasonState {
  return createSeasonState({
    seasonId: "parity",
    seed: 1,
    opening: OPENING,
    params: P,
    teams: TEAMS.map((id) => ({ id, name: id, members: [{ childId: `${id}-m1`, grade: 5 }] })),
    lands: standardLands(8),
    prompts: Object.fromEntries(standardLands(8).map((l) => [l.id, ["q1", "q2"]])),
  });
}

/** Rank i + 1 for T(i+1): 100, 90, … points. */
function ranked(): SeasonState {
  const s = season();
  TEAMS.forEach((t, i) => addPoints(s, t, (100 - 10 * i) * 100, "admin", at(1, 0)));
  return s;
}

function ok(r: { ok: boolean; state?: SeasonState; refusal?: string }): SeasonState {
  if (!r.ok) throw new Error(`refused: ${r.refusal}`);
  return r.state!;
}

const near = (engineHundredths: number, py: number, tol = 0.02) => expect(Math.abs(engineHundredths / 100 - py)).toBeLessThanOrEqual(tol);

const byKind = (k: string) => cases.filter((c) => c.kind === k);

describe("parity with the Python simulator", () => {
  it("has the scenarios", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });

  it.each(byKind("attack_cost").map((c) => [JSON.stringify(c.input), c] as const))("attack cost %s", (_, c) => {
    const i = c.input as { active: number; held: number; leader: boolean };
    expect(attackCost({ activeAttacks: i.active, heldLands: i.held, targetOwnerIsFirst: i.leader }, P).cost).toBe(c.expect);
  });

  it.each(byKind("center_price").map((c) => [c.input.day, c] as const))("center land price on D%s", (_, c) => {
    expect(centerLandPrice(c.input.day as number, P)).toBe(c.expect);
  });

  it.each(byKind("territory").map((c) => [JSON.stringify(c.input), c] as const))("daily territory income %s", (_, c) => {
    const i = c.input as { center: number; edge: number; zero?: "center" | "edge"; dianhua?: boolean; bagua?: "center" | "edge" };
    const s = season();
    const lands = [...Array.from({ length: i.center }, (_, k) => `C${k + 1}`), ...Array.from({ length: i.edge }, (_, k) => `E${k + 1}`)];
    for (const l of lands) s.lands[l]!.owner = "T1";
    const day = 10;
    const pick = (k: "center" | "edge") => (k === "center" ? "C1" : "E1");
    if (i.zero) s.effects.push({ kind: "shengsi", teamId: "T1", landId: pick(i.zero), from: at(day, 0), until: at(day + 2, 0) });
    if (i.dianhua) s.effects.push({ kind: "dianhua", teamId: "T1", bonusPerLand: 1, from: at(day, 0), until: at(day + 2, 0) });
    if (i.bagua) s.effects.push({ kind: "bagua", teamId: "T1", landId: pick(i.bagua), from: at(day, 0) });
    near(pointsOf(ok(settleDay(s, day)), "T1"), c.expect as number);
  });

  it.each(byKind("contest").map((c) => [JSON.stringify(c.input), c] as const))("contest %s", (_, c) => {
    const i = c.input as { attackers: number[]; defender: number | null; jiuzhuan?: boolean; jiuzhuan_defender?: boolean; jianbi?: boolean };
    const e = c.expect as { owner: string; points: Record<string, number> };
    let s = season();
    s.lands.E1!.owner = "T8";
    const atk = i.attackers.map((_, k) => `T${k + 2}`);
    const role = (t: string) => (t === "T8" ? "defender" : `attacker${atk.indexOf(t)}`);
    if (i.jiuzhuan) s.effects.push({ kind: "jiuzhuan", teamId: atk[0]!, from: at(2, 0), until: at(9, 0) });
    if (i.jiuzhuan_defender) s.effects.push({ kind: "jiuzhuan", teamId: "T8", from: at(2, 0), until: at(9, 0) });
    if (i.jianbi) s.teams.T8!.items.push({ uid: "j", itemId: "jianbi", source: "opening", acquiredAt: 0 });
    s = ok(startContest(s, { contestId: "K", teamId: atk[0]!, landId: "E1", at: at(2, 10) }));
    for (const t of atk.slice(1)) s = ok(joinContest(s, { contestId: "K", teamId: t, at: at(2, 11) }));
    const before = Object.fromEntries([...atk, "T8"].map((t) => [t, pointsOf(s, t)]));
    const scores: Record<string, number | null> = Object.fromEntries(atk.map((t, k) => [t, i.attackers[k]!]));
    scores.T8 = i.defender;
    s = ok(settleContest(s, { contestId: "K", at: at(6, 12), scores }));
    expect(role(s.lands.E1!.owner!)).toBe(e.owner);
    for (const t of [...atk, "T8"]) near(pointsOf(s, t) - before[t]!, e.points[role(t)]!, 0.001);
  });

  it.each(byKind("war").map((c) => [JSON.stringify(c.input), c] as const))("weekly war %s", (_, c) => {
    const i = c.input as { winner_danao: boolean; loser_danao: boolean; loser_yujing: boolean };
    const e = c.expect as { winner: number; loser: number };
    const [w, l] = settleWarMatch(
      { teamId: "W", score: 80, danao: i.winner_danao },
      { teamId: "L", score: 70, danao: i.loser_danao, yujing: i.loser_yujing },
      P,
    );
    near(w.points, e.winner, 0);
    near(l.points, e.loser, 0);
  });

  it.each(byKind("zijin").map((c) => [JSON.stringify(c.input), c] as const))("紫金红葫芦 %s", (_, c) => {
    const i = c.input as { userRank: number; targetRank: number; defenses: string[] };
    let s = ranked();
    const user = `T${i.userRank}`;
    const target = `T${i.targetRank}`;
    s.teams[user]!.items.push({ uid: "z", itemId: "zijin", source: "shop", acquiredAt: 0 });
    const ids: Record<string, string> = { 辟火罩: "bihuo", 玄天照妖镜: "zhaoyao" };
    for (const d of i.defenses) s.teams[target]!.items.push({ uid: d, itemId: ids[d]!, source: "shop", acquiredAt: 0 });
    const before = Object.fromEntries(TEAMS.map((t) => [t, pointsOf(s, t)]));
    s = ok(useItem(s, { teamId: user, itemId: "zijin", targetTeamId: target, at: at(10, 10) }));
    const exp = c.expect as Record<string, number>;
    for (const [k, t] of TEAMS.entries()) near(pointsOf(s, t) - before[t]!, exp[String(k + 1)] ?? 0, 0.001);
  });

  it.each(byKind("qibao").map((c) => [JSON.stringify(c.input), c] as const))("七宝紫金钵 %s", (_, c) => {
    const i = c.input as { userRank: number; bihuoRank: number; zhaoyaoRank: number };
    let s = ranked();
    const user = `T${i.userRank}`;
    s.teams[user]!.items.push({ uid: "q", itemId: "qibao", source: "auction", acquiredAt: 0 });
    s.teams[`T${i.bihuoRank}`]!.items.push({ uid: "b", itemId: "bihuo", source: "shop", acquiredAt: 0 });
    s.teams[`T${i.zhaoyaoRank}`]!.items.push({ uid: "z", itemId: "zhaoyao", source: "shop", acquiredAt: 0 });
    const before = Object.fromEntries(TEAMS.map((t) => [t, pointsOf(s, t)]));
    s = ok(useItem(s, { teamId: user, itemId: "qibao", at: at(10, 10) }));
    const exp = c.expect as Record<string, number>;
    for (const [k, t] of TEAMS.entries()) near(pointsOf(s, t) - before[t]!, exp[String(k + 1)] ?? 0, 0.001);
  });

  it.each(byKind("grain_points").map((c) => [c.input.grain, c] as const))("grain conversion %s", (_, c) => {
    near(grainConversion(c.input.grain as number, P), c.expect as number, 0);
  });

  it.each(byKind("participation").map((c) => [JSON.stringify(c.input), c] as const))("participation award %s", (_, c) => {
    const i = c.input as { members: number; doneTwice: number };
    const members = Array.from({ length: i.members }, (_, k) => ({ childId: `m${k}`, active: true }));
    const counts: TaskCount[] = [];
    for (let k = 0; k < i.doneTwice; k++)
      for (let n = 0; n < 2; n++) counts.push({ id: `${k}-${n}`, childId: `m${k}`, teamId: "T", seasonDay: 2, week: 1, counted: true, grain: 3 });
    near(participationAward(1, members, counts, P), c.expect as number, 0);
  });

  it.each(byKind("supply").map((c) => [c.input.score, c] as const))("supply grain for score %s", (_, c) => {
    expect(supplyGrain(c.input.score as number, true, P)).toBe(c.expect);
  });
});
