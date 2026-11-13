import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  beijingInstant,
  countDailyTasks,
  dateOfSeasonDay,
  participationAward,
  type PassedTask,
} from "../src/index.js";

const OPENING = "2027-03-07";
const at = (day: number, hour: number, minute = 0) => beijingInstant(dateOfSeasonDay(OPENING, day), hour, minute);
let n = 0;
const task = (childId: string, t: number, teamId = "T"): PassedTask => ({ id: `t${++n}`, childId, teamId, submittedAt: t });

describe("daily task grain (§7, §20.2)", () => {
  it("D0 tasks go into the journal only", () => {
    const [c] = countDailyTasks([task("kid", at(0, 20))], OPENING, P);
    expect(c).toMatchObject({ counted: false, grain: 0, reason: "before_grain_start" });
  });
  it("at most 2 per day and 4 per week, counted in submission order", () => {
    const r = countDailyTasks(
      [
        task("kid", at(1, 8)),
        task("kid", at(1, 12)),
        task("kid", at(1, 23, 30)),
        task("kid", at(2, 8)),
        task("kid", at(2, 9)),
        task("kid", at(3, 8)),
        task("kid", at(8, 8)),
      ],
      OPENING,
      P,
    );
    expect(r.map((c) => c.counted)).toEqual([true, true, false, true, true, false, true]);
    expect(r[2]!.reason).toBe("day_cap");
    expect(r[5]!.reason).toBe("week_cap");
    expect(r[6]!.week).toBe(2);
    expect(r.filter((c) => c.counted).every((c) => c.grain === 3)).toBe(true);
  });
  it("caps are per child", () => {
    const r = countDailyTasks([task("a", at(1, 8)), task("a", at(1, 9)), task("b", at(1, 10))], OPENING, P);
    expect(r.every((c) => c.counted)).toBe(true);
  });
  it("还魂金丹 pays 5 grain per task for 7 days", () => {
    const used = at(2, 10);
    const r = countDailyTasks(
      [task("kid", at(2, 9)), task("kid", at(2, 12)), task("kid", at(9, 9, 59)), task("kid", at(9, 10))],
      OPENING,
      P,
      [{ teamId: "T", usedAt: used }],
    );
    expect(r.map((c) => c.grain)).toEqual([3, 5, 5, 3]);
  });
  it("tasks after D33 earn nothing", () => {
    const [c] = countDailyTasks([task("kid", at(34, 9))], OPENING, P);
    expect(c!.reason).toBe("after_season");
  });
});

describe("participation award (§7)", () => {
  const counts = (perChild: Record<string, number>, week = 1) =>
    countDailyTasks(
      Object.entries(perChild).flatMap(([kid, k]) =>
        Array.from({ length: k }, (_, i) => task(kid, at((week - 1) * 7 + 1 + i, 9))),
      ),
      OPENING,
      P,
    );
  const members = ["a", "b", "c", "d"].map((childId) => ({ childId, active: true }));
  it("+3 when ≥ 75% of active members have ≥ 2 counted tasks", () => {
    expect(participationAward(1, members, counts({ a: 2, b: 2, c: 3, d: 0 }), P)).toBe(300);
    expect(participationAward(1, members, counts({ a: 2, b: 2, c: 1, d: 0 }), P)).toBe(0);
  });
  it("members who left are not in the denominator", () => {
    const m = members.map((x) => (x.childId === "d" ? { ...x, active: false } : x));
    expect(participationAward(1, m, counts({ a: 2, b: 2, c: 2 }), P)).toBe(300);
  });
  it("only weeks 1–4", () => {
    expect(participationAward(5, members, counts({ a: 2, b: 2, c: 2, d: 2 }, 5), P)).toBe(0);
  });
});
