import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  completeLineAssignment,
  createRng,
  formCamps,
  grainConversion,
  mainBattlefieldPoints,
  mainBattlefieldWinner,
  settleBattleLine,
} from "../src/index.js";

describe("camps (§14)", () => {
  it("snake by rank: 1,4,5,8 vs 2,3,6,7", () => {
    expect(formCamps(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"])).toEqual({
      a: ["r1", "r4", "r5", "r8"],
      b: ["r2", "r3", "r6", "r7"],
    });
    expect(formCamps(["r1", "r2", "r3", "r4", "r5", "r6"])).toEqual({ a: ["r1", "r4", "r5"], b: ["r2", "r3", "r6"] });
  });
  it("missing or invalid assignments are filled at random", () => {
    const camp = ["a", "b", "c", "d"];
    expect(completeLineAssignment(camp, 4, ["d", "c", "b", "a"], createRng(1))).toEqual(["d", "c", "b", "a"]);
    const r = completeLineAssignment(camp, 4, ["a", "a", "b", "c"], createRng(1));
    expect(new Set(r).size).toBe(4);
  });
});

describe("battle lines (§14, §20.5)", () => {
  it("winner takes the line and the loser's best land output for 5 days", () => {
    const [w, l] = settleBattleLine(20, { teamId: "W", score: 80, bestLand: "edge" }, { teamId: "L", score: 60, bestLand: "center" }, P);
    expect(w).toEqual({ teamId: "W", outcome: "win", linePoints: 2000, seized: 1000, compensation: false });
    expect(l).toEqual({ teamId: "L", outcome: "lose", linePoints: 0, seized: -1000, compensation: false });
  });
  it("no land: the winner gets 4 points of compensation, the loser loses nothing", () => {
    const [w, l] = settleBattleLine(10, { teamId: "W", score: 80, bestLand: null }, { teamId: "L", score: 60, bestLand: null }, P);
    expect(w.seized).toBe(400);
    expect(w.compensation).toBe(true);
    expect(l.seized).toBe(0);
  });
  it("坚城令 stops the seizing; 背水阵 ×1.75 or −10", () => {
    const [w, l] = settleBattleLine(
      20,
      { teamId: "W", score: 80, bestLand: "edge", beishui: true },
      { teamId: "L", score: 60, bestLand: "center", jiancheng: true, beishui: true },
      P,
    );
    expect(w.linePoints).toBe(3500);
    expect(w.seized).toBe(0);
    expect(l.linePoints).toBe(-1000);
    expect(l.seized).toBe(0);
  });
  it("ties split the line value; missing work", () => {
    const tie = settleBattleLine(25, { teamId: "A", score: 70, bestLand: "edge" }, { teamId: "B", score: 70, bestLand: "edge" }, P);
    expect(tie.map((x) => x.linePoints)).toEqual([1250, 1250]);
    const one = settleBattleLine(15, { teamId: "A", score: null, bestLand: "edge" }, { teamId: "B", score: 30, bestLand: "edge" }, P);
    expect(one.map((x) => x.outcome)).toEqual(["lose", "win"]);
    const none = settleBattleLine(15, { teamId: "A", score: null, bestLand: "edge" }, { teamId: "B", score: null, bestLand: "edge" }, P);
    expect(none.map((x) => x.linePoints)).toEqual([0, 0]);
  });
});

describe("main battlefield and final conversion", () => {
  it("+12 to every team of the winning camp; 乾坤圈 +12 / −8", () => {
    expect(mainBattlefieldWinner(80, 70)).toBe("a");
    expect(mainBattlefieldWinner(70, 70)).toBe("tie");
    expect(mainBattlefieldPoints("a", "a", false, P)).toBe(1200);
    expect(mainBattlefieldPoints("a", "a", true, P)).toBe(2400);
    expect(mainBattlefieldPoints("b", "a", true, P)).toBe(-800);
    expect(mainBattlefieldPoints("b", "tie", true, P)).toBe(0);
  });
  it("leftover grain: 30 to 1, one decimal, rounded down", () => {
    expect(grainConversion(100, P)).toBe(330);
    expect(grainConversion(30, P)).toBe(100);
    expect(grainConversion(29, P)).toBe(90);
    expect(grainConversion(0, P)).toBe(0);
  });
});
