import { describe, expect, it } from "vitest";
import { checkInvariants, startContest } from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

const base = () => withOwners(newSeason(), defaultOwners);

describe("checkInvariants (PRD part 9 §2)", () => {
  it("a fresh season and a season with a contest are sound", () => {
    expect(checkInvariants(newSeason(), { ledger: true })).toEqual([]);
    const s = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    expect(checkInvariants(s, { ledger: true })).toEqual([]);
  });

  it("finds two active contests on one land", () => {
    const s = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s.contests.K2 = { ...structuredClone(s.contests.K1!), id: "K2" };
    s.contestOrder.push("K2");
    expect(checkInvariants(s)).toEqual([expect.stringContaining("two active contests")]);
  });

  it("finds a defender who does not own the land, and an attacker who is the defender", () => {
    const s = ok(startContest(base(), { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    s.lands.E2!.owner = "T5";
    s.contests.K1!.attackers.push({ teamId: "T2", order: 1, paid: 0, joinedAt: at(2, 11) });
    const p = checkInvariants(s);
    expect(p.some((x) => x.includes("does not own"))).toBe(true);
    expect(p.some((x) => x.includes("is also an attacker"))).toBe(true);
  });

  it("finds unknown owners, owner/ownedSince mismatch, bad leaders and duplicate item copies", () => {
    const s = base();
    s.lands.E1!.owner = "T99";
    s.lands.E2!.ownedSince = null;
    s.teams.T3!.leader = "T3-m1";
    s.teams.T3!.deputy = "T3-m1";
    s.teams.T4!.leader = "T5-m1";
    s.teams.T1!.items.push({ uid: "X", itemId: "zhaoyao", source: "admin", acquiredAt: 0 });
    s.teams.T2!.items.push({ uid: "X", itemId: "zhaoyao", source: "admin", acquiredAt: 0 });
    const p = checkInvariants(s).join("\n");
    expect(p).toContain("unknown team T99");
    expect(p).toContain("owner and ownedSince disagree");
    expect(p).toContain("both leader and deputy");
    expect(p).toContain("leader T5-m1 is not an active member");
    expect(p).toContain("held twice");
  });

  it("finds negative grain", () => {
    const s = base();
    s.ledger.push({ ...structuredClone(s.ledger.find((e) => e.teamId === "T1")!), id: "neg", amount: -1000 } as never);
    expect(checkInvariants(s).some((x) => x.includes("grain"))).toBe(true);
  });
});
