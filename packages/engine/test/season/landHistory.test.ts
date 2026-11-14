import { describe, expect, it } from "vitest";
import { adminSetLandOwner, cloneState, resettleContest, settleContest, settleDay, startContest } from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

describe("归属历史 (part 5 D2): every change of owner is kept", () => {
  it("captured, rejudged back, then set by an admin; the history only grows", () => {
    let s = withOwners(newSeason(), defaultOwners);
    const before = s.landHistory.length;
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    for (let d = 1; d <= 5; d++) s = ok(settleDay(s, d));
    s = ok(settleContest(s, { contestId: "K1", at: at(6, 12), scores: { T1: 80, T2: 70 } }));
    s = ok(resettleContest(s, { contestId: "K1", scores: { T1: 60, T2: 70 }, at: at(8, 10), by: "admin:x", reason: "复查" }));
    s = ok(adminSetLandOwner(s, { landId: "E2", teamId: null, at: at(9, 10), by: "admin:x", reason: "退赛" }));
    const e2 = s.landHistory.slice(before).filter((h) => h.landId === "E2");
    expect(e2).toEqual([
      { landId: "E2", from: "T2", to: "T1", at: at(6, 12), how: "captured", contestId: "K1" },
      { landId: "E2", from: "T1", to: "T2", at: at(8, 10), how: "rejudged", contestId: "K1" },
      { landId: "E2", from: "T2", to: null, at: at(9, 10), how: "admin" },
    ]);
    expect(s.lands.E2!.ownedSince).toBeNull();
  });

  it("a state saved before the history existed still clones and records", () => {
    const s0 = withOwners(newSeason(), defaultOwners) as unknown as Record<string, unknown>;
    delete s0.landHistory;
    const s = cloneState(s0 as never);
    expect(s.landHistory).toEqual([]);
  });
});
