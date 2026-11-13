import { describe, expect, it } from "vitest";
import { checkLedger, pts } from "../../src/index.js";
import {
  addGrain,
  addPoints,
  adjustLedger,
  adminGiveItem,
  adminRemoveItem,
  adminSetLandOwner,
  adminSetTeamRole,
  claimTeamRole,
  finalizeSeason,
  formBigBattle,
  grainOf,
  lockLines,
  memberLeaves,
  pausedBefore,
  pauseSeason,
  pointsOf,
  resumeSeason,
  reverseEntry,
  settleBigBattle,
  settleDay,
  startContest,
  systemAssignLeaders,
  takeOverLeader,
  transferTeamRole,
} from "../../src/season/index.js";
import { DAY } from "../../src/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

describe("roles (§5)", () => {
  it("claim, transfer, take over, system assign, admin set", () => {
    let s = newSeason();
    s = ok(claimTeamRole(s, { teamId: "T1", role: "leader", childId: "T1-m1", at: at(0, 19) }));
    expect(claimTeamRole(s, { teamId: "T1", role: "leader", childId: "T1-m2", at: at(0, 19) })).toMatchObject({ refusal: "taken" });
    expect(claimTeamRole(s, { teamId: "T1", role: "deputy", childId: "T2-m2", at: at(0, 19) })).toMatchObject({ refusal: "not_member" });
    s = ok(claimTeamRole(s, { teamId: "T1", role: "deputy", childId: "T1-m2", at: at(0, 19) }));
    s = ok(transferTeamRole(s, { teamId: "T1", role: "leader", from: "T1-m1", to: "T1-m3", at: at(1, 9) }));
    expect(s.teams.T1).toMatchObject({ leader: "T1-m3", deputy: "T1-m2" });
    expect(takeOverLeader(s, { teamId: "T1", deputyId: "T1-m2", leaderLastLoginAt: at(1, 9), at: at(3, 9) })).toMatchObject({ refusal: "leader_active" });
    s = ok(takeOverLeader(s, { teamId: "T1", deputyId: "T1-m2", leaderLastLoginAt: at(1, 9), at: at(1, 9) + 3 * DAY }));
    expect(s.teams.T1).toMatchObject({ leader: "T1-m2", deputy: null });
    expect(systemAssignLeaders(s, { at: at(1, 11) })).toMatchObject({ refusal: "too_early" });
    s = ok(systemAssignLeaders(s, { at: at(1, 12) }));
    expect(s.teams.T1!.leader).toBe("T1-m2");
    // highest grade is 9 (member 7)
    expect(s.teams.T2!.leader).toBe("T2-m7");
    expect(adminSetTeamRole(s, { teamId: "T2", role: "leader", childId: "T2-m1", at: at(2, 0), by: "admin", reason: "" })).toMatchObject({
      refusal: "needs_reason",
    });
    s = ok(adminSetTeamRole(s, { teamId: "T2", role: "leader", childId: "T2-m1", at: at(2, 0), by: "admin", reason: "家长要求" }));
    expect(s.teams.T2!.leader).toBe("T2-m1");
  });
  it("a member who leaves gives up the role", () => {
    let s = ok(claimTeamRole(newSeason(), { teamId: "T1", role: "leader", childId: "T1-m1", at: at(0, 19) }));
    s = ok(memberLeaves(s, { childId: "T1-m1", at: at(5, 0) }));
    expect(s.teams.T1!.leader).toBeNull();
    expect(s.teams.T1!.members[0]!.active).toBe(false);
    expect(claimTeamRole(s, { teamId: "T1", role: "leader", childId: "T1-m1", at: at(5, 1) })).toMatchObject({ refusal: "not_member" });
  });
});

describe("admin interventions (§16)", () => {
  it("pause stops territory income and records the paused time", () => {
    let s = withOwners(newSeason(), defaultOwners);
    s = ok(pauseSeason(s, { at: at(3, 10), reason: "服务器维护" }));
    expect(pauseSeason(s, { at: at(3, 11), reason: "x" })).toMatchObject({ refusal: "already_paused" });
    s = ok(settleDay(s, 3));
    expect(pointsOf(s, "T1")).toBe(0);
    s = ok(resumeSeason(s, { at: at(4, 10) }));
    expect(pausedBefore(s, at(5, 0))).toBe(DAY);
    expect(pausedBefore(s, at(3, 9))).toBe(0);
    s = ok(settleDay(s, 4));
    expect(pointsOf(s, "T1")).toBe(pts(1));
  });
  it("ledger adjustments need a reason; reversals cancel exactly once", () => {
    let s = newSeason();
    expect(adjustLedger(s, { teamId: "T1", currency: "grain", amount: 10, at: at(2, 0), by: "a", reason: " " })).toMatchObject({ refusal: "needs_reason" });
    s = ok(adjustLedger(s, { teamId: "T1", currency: "points", amount: pts(2.5), at: at(2, 0), by: "a", reason: "补发" }));
    expect(pointsOf(s, "T1")).toBe(250);
    const id = s.ledger.at(-1)!.id;
    s = ok(reverseEntry(s, { entryId: id, at: at(2, 1), by: "a", reason: "发错了" }));
    expect(pointsOf(s, "T1")).toBe(0);
    expect(reverseEntry(s, { entryId: id, at: at(2, 1), by: "a", reason: "x" })).toMatchObject({ refusal: "already_reversed" });
    expect(reverseEntry(s, { entryId: s.ledger.at(-1)!.id, at: at(2, 1), by: "a", reason: "x" })).toMatchObject({ refusal: "is_reversal" });
    expect(checkLedger(s.ledger)).toEqual([]);
  });
  it("sets a land owner by hand, but not during a contest", () => {
    let s = withOwners(newSeason(), defaultOwners);
    s = ok(adminSetLandOwner(s, { landId: "E1", teamId: "T2", at: at(3, 0), by: "a", reason: "改判" }));
    expect(s.lands.E1!.owner).toBe("T2");
    s = ok(startContest(s, { contestId: "K", teamId: "T1", landId: "E2", at: at(3, 10) }));
    expect(adminSetLandOwner(s, { landId: "E2", teamId: "T1", at: at(3, 11), by: "a", reason: "x" })).toMatchObject({ refusal: "contest_active" });
  });
  it("gives and removes items", () => {
    let s = ok(adminGiveItem(newSeason(), { teamId: "T1", itemId: "zijin", at: at(3, 0), by: "a", reason: "补偿" }));
    expect(adminGiveItem(s, { teamId: "T1", itemId: "nope", at: at(3, 0), by: "a", reason: "x" })).toMatchObject({ refusal: "unknown_item" });
    const uid = s.teams.T1!.items[0]!.uid;
    s = ok(adminRemoveItem(s, { teamId: "T1", uid, at: at(3, 0), by: "a", reason: "撤回" }));
    expect(s.teams.T1!.items).toHaveLength(0);
  });
});

describe("end of season (§15)", () => {
  it("converts grain at 30:1, ranks and splits the scholarship", () => {
    let s = withOwners(newSeason(), defaultOwners);
    s.teamOrder.forEach((t, i) => addPoints(s, t, pts(100 - i * 10), "admin", at(1, 0)));
    addGrain(s, "T8", 35, "admin", at(1, 0)); // 95 grain → 3.1
    expect(finalizeSeason(s, { at: at(35, 10), poolYuan: 10000 })).toMatchObject({ refusal: "battle_not_settled" });
    s = ok(formBigBattle(s, { at: at(29, 12) }));
    s = ok(lockLines(s, { at: at(29, 21) }));
    s = ok(settleBigBattle(s, { at: at(34, 12), lineScores: {}, mainScores: { a: null, b: null } }));
    s = ok(finalizeSeason(s, { at: at(35, 10), poolYuan: 10000 }));
    expect(pointsOf(s, "T8")).toBe(pts(30 + 3.1));
    expect(pointsOf(s, "T1")).toBe(pts(100 + 2));
    expect(s.final!.ranking[0]).toMatchObject({ teamId: "T1", rank: 1 });
    expect(s.final!.scholarship.reduce((a, b) => a + b.yuan, 0)).toBe(10000);
    expect(grainOf(s, "T1")).toBe(60);
    expect(finalizeSeason(s, { at: at(35, 10), poolYuan: 10000 })).toMatchObject({ refusal: "already_done" });
  });
});
