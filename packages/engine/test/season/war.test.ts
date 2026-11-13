import { describe, expect, it } from "vitest";
import { pts } from "../../src/index.js";
import { addPoints, pairWar, pointsOf, settleWar, useItem, warDeadline, warPairingAt, warWeeks, type SeasonState } from "../../src/season/index.js";
import { at, newSeason, ok } from "./fixture.js";

function ranked(): SeasonState {
  const s = newSeason();
  s.teamOrder.forEach((t, i) => addPoints(s, t, pts(100 - i * 10), "admin", at(1, 0)));
  return s;
}

describe("weekly war in the season (§11)", () => {
  it("has 4 weeks; pairs on Thursday evening, closes Sunday 21:00", () => {
    const s = ranked();
    expect(warWeeks(s)).toBe(4);
    expect(warPairingAt(s, 1)).toBe(at(4, 19));
    expect(warDeadline(s, 1)).toBe(at(7, 21));
    expect(pairWar(s, { week: 1, at: at(4, 18) })).toMatchObject({ refusal: "too_early" });
    expect(pairWar(s, { week: 5, at: at(32, 19) })).toMatchObject({ refusal: "bad_week" });
  });

  it("pairs by rank, then avoids repeat opponents", () => {
    let s = ok(pairWar(ranked(), { week: 1, at: at(4, 19) }));
    expect(s.wars[1]!.pairs).toEqual([["T1", "T2"], ["T3", "T4"], ["T5", "T6"], ["T7", "T8"]]);
    expect(pairWar(s, { week: 1, at: at(4, 19) })).toMatchObject({ refusal: "already_done" });
    s = ok(pairWar(s, { week: 2, at: at(11, 19) }));
    const keys = s.wars[2]!.pairs.map(([a, b]) => `${a}${b}`);
    expect(keys).not.toContain("T1T2");
    expect(keys).not.toContain("T3T4");
  });

  it("settles wins, losses, ties, missing work, chests and items", () => {
    let s = ranked();
    s.teams.T3!.items.push({ uid: "d", itemId: "danao", source: "shop", acquiredAt: 0 });
    s.teams.T4!.items.push({ uid: "y", itemId: "yujing", source: "opening", acquiredAt: 0 });
    s = ok(pairWar(s, { week: 1, at: at(4, 19) }));
    s = ok(useItem(s, { teamId: "T3", itemId: "danao", at: at(4, 20) }));
    s = ok(useItem(s, { teamId: "T4", itemId: "yujing", at: at(4, 20) }));
    const before = Object.fromEntries(s.teamOrder.map((t) => [t, pointsOf(s, t)]));
    expect(settleWar(s, { week: 1, at: at(7, 20), scores: {} })).toMatchObject({ refusal: "too_early" });
    s = ok(
      settleWar(s, {
        week: 1,
        at: at(8, 12),
        scores: { T1: 80, T2: 70, T3: 90, T4: 60, T5: 75, T6: 75, T7: 60, T8: null },
      }),
    );
    const delta = (t: string) => pointsOf(s, t) - before[t]!;
    expect(delta("T1")).toBe(pts(15));
    expect(delta("T2")).toBe(pts(-5));
    expect(delta("T3")).toBe(pts(25)); // 大闹天宫
    expect(delta("T4")).toBe(0); // 玉净瓶
    expect([delta("T5"), delta("T6")]).toEqual([pts(5), pts(5)]);
    expect(delta("T7")).toBe(pts(15));
    expect(delta("T8")).toBe(pts(-5));
    expect(s.teams.T1!.warWins).toBe(1);
    // chests only for losers of matches where both submitted
    expect(s.teams.T2!.items.map((i) => i.source)).toEqual(["chest"]);
    expect(s.teams.T4!.items.map((i) => i.source)).toEqual(["chest"]);
    expect(s.teams.T8!.items).toHaveLength(0);
    expect(s.teams.T6!.items).toHaveLength(0);
    expect(settleWar(s, { week: 1, at: at(8, 12), scores: {} })).toMatchObject({ refusal: "already_done" });
  });

  it("gives the bye +5 with an odd number of teams", () => {
    let s = ranked();
    s.teamOrder = s.teamOrder.filter((t) => t !== "T8");
    delete s.teams.T8;
    s = ok(pairWar(s, { week: 1, at: at(4, 19) }));
    expect(s.wars[1]!.bye).toBe("T7");
    const b = pointsOf(s, "T7");
    s = ok(settleWar(s, { week: 1, at: at(8, 12), scores: {} }));
    expect(pointsOf(s, "T7") - b).toBe(pts(5));
  });
});
