import { children, families } from "@zhiyouji/db";
import { warDeadline } from "@zhiyouji/engine";
import type { SeasonStore } from "../src/index.js";
import { bj, setup } from "./helpers.js";

const ADMIN = "admin:test";
const LANDS = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "C1", "C2", "C3", "C4"];

/**
 * A confirmed season with 16 players: family A (two siblings) and family B
 * log in through the API; 13 more children are put in the database. Child a1
 * and b1 share a team.
 */
export async function playSetup(opts: { landNames?: Record<string, string>; seedBank?: boolean } = {}) {
  const t = await setup(bj("2027-02-01", 10));
  const A = await t.family("13800000001", [
    { nickname: "大毛", grade: 6 },
    { nickname: "二毛", grade: 4 },
  ]);
  const B = await t.family("13800000002", [{ nickname: "小明", grade: 6 }]);
  const others: string[] = [];
  for (let i = 0; i < 13; i++) {
    const [f] = await t.db.insert(families).values({ phone: `1390000${String(1000 + i)}`, consentVersion: t.cfg.policyVersion, consentAt: new Date() }).returning();
    const [c] = await t.db.insert(children).values({ familyId: f!.id, nickname: `组员${i}`, grade: 1 + (i % 9) }).returning();
    others.push(c!.id);
  }
  const [a1, a2] = A.childIds as [string, string];
  const [b1] = B.childIds as [string];

  const season = await t.services.seasons.create({ name: "S3", opening: "2027-02-07", seed: 11 }, ADMIN);
  await t.services.seasons.openEnrollment(season.id, ADMIN);
  await t.services.seasons.enroll(season.id, [a1, a2, b1, ...others].map((childId) => ({ childId })), ADMIN);
  let g = await t.services.seasons.generateGrouping(season.id, ADMIN);
  const where = (c: string) => {
    for (const [si, sv] of g.servers.entries()) for (const [ti, tm] of sv.teams.entries()) if (tm.members.some((m) => m.childId === c)) return [si, ti] as const;
    throw new Error("not placed");
  };
  const [, ta] = where(a1);
  if (where(b1)[1] !== ta) g = await t.services.seasons.movePlayer(season.id, b1, 0, ta, ADMIN);
  if (opts.seedBank) await t.services.bank.seedDefaults(ADMIN); // lands get their templates (subjects)
  const prompts = Object.fromEntries(LANDS.map((l) => [l, [`${l}-q1`, `${l}-q2`]]));
  const conf = await t.services.seasons.confirmGrouping(season.id, { prompts, landNames: opts.landNames ?? { E1: "火焰山" } }, ADMIN);
  const serverId = conf.servers[0]!.serverId;

  /** Log in again and choose a child: one session per child. */
  async function as(phone: string, childId: string) {
    t.clock.advance(61_000);
    await t.call("POST", "/v1/auth/sms-code", { phone });
    const token = (await t.call("POST", "/v1/auth/login", { phone, code: t.sms.lastCode(phone) })).json().token as string;
    await t.call("POST", "/v1/session/child", { childId }, token);
    return (m: "GET" | "POST" | "DELETE", url: string, body?: unknown) => t.call(m, url, body, token);
  }
  return { ...t, seasonId: season.id, serverId, a1, a2, b1, as, A, B };
}


/** The season up to D2 10:00: a1 leads its team, owns E1, and has just attacked another team's edge land. */
export async function contestSetup(opts: { landNames?: Record<string, string>; seedBank?: boolean } = {}) {
  const t = await playSetup(opts);
  t.clock.set(bj("2027-02-07", 19, 1));
  await t.services.scheduler.runDue(t.serverId);
  const a1 = await t.as("13800000001", t.a1);
  await a1("POST", "/v1/season/roles/claim", { role: "leader" });
  await a1("POST", "/v1/season/rounds/blind_auction", { bid: 10, prefs: ["E1"] });
  t.clock.set(bj("2027-02-08", 21, 1));
  await t.services.scheduler.runDue(t.serverId);
  t.clock.set(bj("2027-02-09", 10));
  const st = await t.services.store.state(t.serverId);
  const myTeam = (await a1("GET", "/v1/season/me")).json().team.id as string;
  const target = st.landOrder.find((l) => st.lands[l]!.kind === "edge" && st.lands[l]!.owner && st.lands[l]!.owner !== myTeam)!;
  const defender = st.lands[target]!.owner!;
  const contestId = (await a1("POST", "/v1/season/contests", { landId: target })).json().contest.id as string;
  return { ...t, a1api: a1, myTeam, target, defender, contestId };
}

/** Settle every paired war whose deadline has passed with no scores (what scoring does when nothing was handed in). */
export async function settleWars(t: { services: { store: SeasonStore }; serverId: string; clock: { now(): Date } }) {
  const st = await t.services.store.state(t.serverId);
  const now = +t.clock.now();
  for (const w of Object.values(st.wars))
    if (!w.settled && w.pairs.length > 0 && warDeadline(st, w.week) <= now) await t.services.store.apply(t.serverId, { type: "settle_war", week: w.week, at: now, scores: {} }, "system");
}
