import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, battleLineValues, landCounts, openingStockPerKind, paramsProblems, planServers, withParams } from "../src/index.js";

describe("params", () => {
  it("land counts per server (§4, §20.1)", () => {
    expect(landCounts(8)).toEqual({ edge: 8, center: 4 });
    expect(landCounts(6)).toEqual({ edge: 6, center: 3 });
    expect(() => landCounts(7)).toThrow();
  });
  it("starter stock defaults to teams / 2", () => {
    expect(openingStockPerKind(8, DEFAULT_PARAMS)).toBe(4);
    expect(openingStockPerKind(6, DEFAULT_PARAMS)).toBe(3);
    expect(openingStockPerKind(8, withParams({ opening: { stockPerKind: 9 } }))).toBe(9);
  });
  it("big battle lines (§14, §20.1)", () => {
    expect(battleLineValues(8, DEFAULT_PARAMS)).toEqual([10, 15, 20, 25]);
    expect(battleLineValues(6, DEFAULT_PARAMS)).toEqual([10, 18, 25]);
    expect(battleLineValues(4, DEFAULT_PARAMS)).toEqual([10, 25]);
    expect(battleLineValues(10, DEFAULT_PARAMS)).toEqual([10, 14, 18, 21, 25]);
  });
  it("withParams deep-merges and does not mutate defaults", () => {
    const p = withParams({ contest: { qualityLine: 60 }, war: { giftWeeks: [1] } });
    expect(p.contest.qualityLine).toBe(60);
    expect(p.contest.baseCost).toBe(30);
    expect(p.war.giftWeeks).toEqual([1]);
    expect(DEFAULT_PARAMS.contest.qualityLine).toBe(50);
    expect(DEFAULT_PARAMS.war.giftWeeks).toEqual([2, 4]);
  });
  it("8 teams per server, up to 88 players per server (§20.1)", () => {
    expect(planServers(72, DEFAULT_PARAMS)).toEqual({
      servers: 1,
      teamsPerServer: 8,
      playersPerServer: [72],
      teamSizes: [[9, 9, 9, 9, 9, 9, 9, 9]],
    });
    expect(planServers(50, DEFAULT_PARAMS).teamSizes[0]).toEqual([7, 7, 6, 6, 6, 6, 6, 6]);
    expect(planServers(88, DEFAULT_PARAMS).servers).toBe(1);
    const two = planServers(120, DEFAULT_PARAMS);
    expect(two.servers).toBe(2);
    expect(two.playersPerServer).toEqual([60, 60]);
    expect(two.teamSizes[0]).toEqual([8, 8, 8, 8, 7, 7, 7, 7]);
    expect(() => planServers(5, DEFAULT_PARAMS)).toThrow();
  });
});

describe("parameters that contradict each other", () => {
  it("the defaults are consistent; a big battle length that does not fit the season is reported", () => {
    expect(paramsProblems(DEFAULT_PARAMS)).toEqual([]);
    expect(paramsProblems(withParams({ time: { bigBattleDays: 6 } }))).toEqual(["大团战天数（6）要等于 赛季天数（33）− 大团战开始日（D29）+ 1 = 5"]);
    expect(paramsProblems(withParams({ time: { bigBattleStartDay: 28, bigBattleDays: 6 } }))).toEqual([]);
    expect(paramsProblems(withParams({ supply: { tierBounds: [65, 50] }, war: { giftOffered: 0 } }))).toHaveLength(2);
    expect(paramsProblems(withParams({ time: { shopCloseDay: 30 } }))).toEqual(["商店要在大团战（D29）之前关闭"]);
  });
});
