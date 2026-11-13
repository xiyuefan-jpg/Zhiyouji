import { describe, expect, it } from "vitest";
import { children, families } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";

const ADMIN = "admin:test";
const LANDS = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "C1", "C2", "C3", "C4"];

/**
 * A confirmed season with 16 players: family A (two siblings) and family B
 * log in through the API; 13 more children are put in the database. Child a1
 * and b1 share a team.
 */
async function playSetup() {
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
  const prompts = Object.fromEntries(LANDS.map((l) => [l, [`${l}-q1`, `${l}-q2`]]));
  const conf = await t.services.seasons.confirmGrouping(season.id, { prompts, landNames: { E1: "火焰山" } }, ADMIN);
  const serverId = conf.servers[0]!.serverId;

  /** Log in again and choose a child: one session per child. */
  async function as(phone: string, childId: string) {
    t.clock.advance(61_000);
    await t.call("POST", "/v1/auth/sms-code", { phone });
    const token = (await t.call("POST", "/v1/auth/login", { phone, code: t.sms.lastCode(phone) })).json().token as string;
    await t.call("POST", "/v1/session/child", { childId }, token);
    return (m: "GET" | "POST", url: string, body?: unknown) => t.call(m, url, body, token);
  }
  return { ...t, seasonId: season.id, serverId, a1, a2, b1, as, A, B };
}

describe("season play on the student website (part 5 D–E)", () => {
  it("before D0 evening the child waits; afterwards sees the season, the map and the team", async () => {
    const t = await playSetup();
    const a1 = await t.as("13800000001", t.a1);
    expect((await a1("GET", "/v1/season/me")).json()).toMatchObject({ status: "waiting", season: { name: "S3" } });
    expect((await a1("GET", "/v1/season/map")).json().error).toBe("no_season");

    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const me = (await a1("GET", "/v1/season/me")).json();
    expect(me).toMatchObject({ status: "playing", role: "member", canAct: false, season: { status: "running", day: 0 } });
    expect(me.members.length).toBeGreaterThanOrEqual(2);
    expect(me.members.find((m: { me: boolean }) => m.me).nickname).toBe("大毛");

    const map = (await a1("GET", "/v1/season/map")).json();
    expect(map.lands).toHaveLength(12);
    expect(map.lands[0]).toMatchObject({ id: "E1", name: "火焰山", kind: "edge", output: 1, owner: null });
    const team = (await a1("GET", "/v1/season/team")).json();
    expect(team).toMatchObject({ grain: 60, spendableGrain: 60, points: 0, items: [] });
    const ledger = (await a1("GET", "/v1/season/ledger?currency=grain")).json();
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ amount: 60, source: "opening" });
    expect((await a1("GET", "/v1/season/ranking")).json().ranking).toHaveLength(8);
    await t.close();
  });

  it("roles: claim, taken, hand-over waits for the receiver, members cannot act for the team", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    const b1 = await t.as("13800000002", t.b1);

    expect((await a1("POST", "/v1/season/roles/claim", { role: "leader" })).json()).toMatchObject({ role: "leader", canAct: true });
    const taken = await b1("POST", "/v1/season/roles/claim", { role: "leader" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ error: "taken", message: "这个位置已经有人了" });
    expect((await b1("POST", "/v1/season/roles/claim", { role: "deputy" })).json().role).toBe("deputy");

    // a1 hands the leader role to b1; nothing changes until b1 accepts
    expect((await a1("POST", "/v1/season/roles/offer", { role: "leader", to: t.b1 })).json().transfer.status).toBe("pending");
    expect((await a1("GET", "/v1/season/me")).json().role).toBe("leader");
    const pending = (await b1("GET", "/v1/season/roles/transfers")).json().transfers;
    expect(pending).toHaveLength(1);
    expect(pending[0].forMe).toBe(true);
    // a1 cannot accept on b1's behalf
    expect((await a1("POST", `/v1/season/roles/transfers/${pending[0].id}`, { accept: true })).statusCode).toBe(404);
    const acc = (await b1("POST", `/v1/season/roles/transfers/${pending[0].id}`, { accept: true })).json();
    expect(acc.role).toBe("leader");
    expect((await a1("GET", "/v1/season/me")).json()).toMatchObject({ role: "member", canAct: false });

    // the deputy seat is free again (default 6); a member's team action is refused
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 5, prefs: ["E1"] })).json()).toMatchObject({ error: "not_leader", message: "请组长或副组长操作" });
    // take-over: the leader b1 is active, so the deputy cannot take over
    expect((await a1("POST", "/v1/season/roles/claim", { role: "deputy" })).json().role).toBe("deputy");
    expect((await a1("POST", "/v1/season/roles/take-over")).json().error).toBe("leader_active");
    // three days later without b1 → a1 takes over
    t.clock.advance(3 * 24 * 3_600_000 + 60_000);
    const a1b = await t.as("13800000001", t.a1);
    expect((await a1b("POST", "/v1/season/roles/take-over")).json().role).toBe("leader");
    await t.close();
  });

  it("blind auction submission window, the auction result on the map, then a contest with a cost quote", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });

    // only edge lands, bid ≤ grain
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 5, prefs: ["C1"] })).json().error).toBe("bad_prefs");
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 61, prefs: ["E1"] })).json().error).toBe("not_enough_grain");
    const sub = (await a1("POST", "/v1/season/rounds/blind_auction", { bid: 20, prefs: ["E1", "E2"] })).json();
    expect(sub).toMatchObject({ open: true, closed: false, submission: { bid: 20, prefs: ["E1", "E2"] } });
    // starter items are not open yet
    expect((await a1("POST", "/v1/season/rounds/starter_items", { prefs: ["huanhun"] })).json().error).toBe("too_early");

    // D1 21:00: the auction runs; the highest bid gets its first choice
    t.clock.set(bj("2027-02-08", 21, 1));
    await t.services.scheduler.runDue(t.serverId);
    const map = (await a1("GET", "/v1/season/map")).json();
    expect(map.lands.find((l: { id: string }) => l.id === "E1")).toMatchObject({ mine: true });
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 1, prefs: ["E3"] })).json().error).toBe("too_late");
    expect((await a1("GET", "/v1/season/team")).json().grain).toBe(40);
    expect((await a1("POST", "/v1/season/rounds/starter_items", { prefs: ["huanhun", "bihuo", "zhencha"] })).json().error).toBe("bad_prefs");
    expect((await a1("POST", "/v1/season/rounds/starter_items", { prefs: ["huanhun", "bihuo"] })).json().submission.prefs).toEqual(["huanhun", "bihuo"]);

    // D2 10:00: attack another team's land
    t.clock.set(bj("2027-02-09", 10));
    const target = map.lands.find((l: { owner: unknown; mine: boolean; kind: string }) => l.owner && !l.mine && l.kind === "edge");
    const quote = (await a1("GET", `/v1/season/lands/${target.id}/quote`)).json();
    expect(quote.cost).toBeGreaterThan(0);
    const started = await a1("POST", "/v1/season/contests", { landId: target.id });
    expect(started.statusCode).toBe(200);
    const c = started.json().contest;
    expect(c).toMatchObject({ landId: target.id, paid: quote.cost });
    expect(c.promptId.startsWith(target.id)).toBe(true);
    expect((await a1("GET", "/v1/season/team")).json().grain).toBe(40 - quote.cost);
    const detail = (await a1("GET", `/v1/season/contests/${c.id}`)).json();
    expect(detail).toMatchObject({ status: "active", involved: true });
    expect((await a1("POST", "/v1/season/contests", { landId: "E1" })).json().error).toBe("own_land");
    expect((await a1("POST", "/v1/season/contests", { landId: target.id })).json().error).toBe("contest_in_progress");

    // the sibling in another team sees the contest on the map, not a1's items
    const a2 = await t.as("13800000001", t.a2);
    const m2 = (await a2("GET", "/v1/season/map")).json();
    expect(m2.lands.find((l: { id: string }) => l.id === target.id).contest.id).toBe(c.id);
    expect((await a2("GET", `/v1/season/contests/${c.id}`)).json().attackers[0].paid).toBeUndefined();
    await t.close();
  });
});
