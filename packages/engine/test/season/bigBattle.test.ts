import { describe, expect, it } from "vitest";
import { pts } from "../../src/index.js";
import {
  addPoints,
  campsFormAt,
  formBigBattle,
  linesDeadline,
  linesPublishedAt,
  lockLines,
  pointsOf,
  settleBigBattle,
  submitLines,
  useBattleItem,
  useItem,
  type SeasonState,
} from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

function ranked(): SeasonState {
  const s = withOwners(newSeason(), defaultOwners);
  s.teamOrder.forEach((t, i) => addPoints(s, t, pts(100 - i * 10), "admin", at(1, 0)));
  return s;
}

function give(s: SeasonState, teamId: string, ...items: string[]): SeasonState {
  for (const itemId of items) s.teams[teamId]!.items.push({ uid: `${teamId}-${itemId}`, itemId, source: "shop", acquiredAt: 0 });
  return s;
}

const formed = () => ok(formBigBattle(ranked(), { at: at(29, 12) }));

describe("big battle in the season (§14)", () => {
  it("forms camps at the D29 noon publication by snake draft", () => {
    const s0 = ranked();
    expect(campsFormAt(s0)).toBe(at(29, 12));
    expect(formBigBattle(s0, { at: at(29, 11) })).toMatchObject({ refusal: "too_early" });
    const s = formed();
    expect(s.bigBattle!.camps).toEqual({ a: ["T1", "T4", "T5", "T8"], b: ["T2", "T3", "T6", "T7"] });
    expect(s.bigBattle!.lineValues).toEqual([10, 15, 20, 25]);
    expect(formBigBattle(s, { at: at(29, 12) })).toMatchObject({ refusal: "already_done" });
  });

  it("takes the latest valid submission from any camp leader; locks at 21:00, random for missing", () => {
    let s = formed();
    s.teams.T1!.leader = "T1-m1";
    s.teams.T4!.deputy = "T4-m2";
    expect(submitLines(s, { teamId: "T1", lines: ["T1", "T4", "T5", "T2"], at: at(29, 13) })).toMatchObject({ refusal: "bad_assignment" });
    expect(submitLines(s, { teamId: "T1", lines: ["T1", "T4", "T5"], at: at(29, 13) })).toMatchObject({ refusal: "bad_assignment" });
    expect(submitLines(s, { teamId: "T1", lines: ["T1", "T4", "T5", "T8"], at: at(29, 13), by: "T1-m2" })).toMatchObject({ refusal: "not_leader" });
    s = ok(submitLines(s, { teamId: "T1", lines: ["T1", "T4", "T5", "T8"], at: at(29, 13), by: "T1-m1" }));
    s = ok(submitLines(s, { teamId: "T4", lines: ["T8", "T5", "T4", "T1"], at: at(29, 20), by: "T4-m2" }));
    expect(submitLines(s, { teamId: "T4", lines: ["T1", "T4", "T5", "T8"], at: linesDeadline(s) })).toMatchObject({ refusal: "too_late" });
    expect(lockLines(s, { at: at(29, 20, 59) })).toMatchObject({ refusal: "too_early" });
    s = ok(lockLines(s, { at: at(29, 21) }));
    expect(s.bigBattle!.final!.a).toEqual(["T8", "T5", "T4", "T1"]);
    expect([...s.bigBattle!.final!.b].sort()).toEqual(["T2", "T3", "T6", "T7"]);
  });

  it("侦察令 shows the opponent on our line from their current submission, without broadcast", () => {
    let s = give(formed(), "T1", "zhencha");
    s = ok(submitLines(s, { teamId: "T2", lines: ["T2", "T3", "T6", "T7"], at: at(29, 13) }));
    expect(useBattleItem(s, { teamId: "T1", itemId: "zhencha", at: at(29, 14) })).toMatchObject({ refusal: "no_assignment" });
    s = ok(submitLines(s, { teamId: "T1", lines: ["T4", "T1", "T5", "T8"], at: at(29, 13) }));
    const r = useBattleItem(s, { teamId: "T1", itemId: "zhencha", at: at(29, 14) });
    expect(r.ok && r.notices[0]).toMatchObject({ broadcast: false, data: { line: 1, opponent: "T3" } });
  });

  it("调兵符 swaps with a teammate within 12 hours after the D30 publication", () => {
    let s = give(formed(), "T5", "diaobing");
    s = ok(submitLines(s, { teamId: "T1", lines: ["T1", "T4", "T5", "T8"], at: at(29, 13) }));
    s = ok(lockLines(s, { at: at(29, 21) }));
    expect(linesPublishedAt(s)).toBe(at(30, 7));
    expect(useBattleItem(s, { teamId: "T5", itemId: "diaobing", at: at(30, 6), line: 3 })).toMatchObject({ refusal: "too_early" });
    expect(useBattleItem(s, { teamId: "T5", itemId: "diaobing", at: at(30, 19), line: 3 })).toMatchObject({ refusal: "too_late" });
    expect(useBattleItem(s, { teamId: "T5", itemId: "diaobing", at: at(30, 8), line: 2 })).toMatchObject({ refusal: "bad_line" });
    s = ok(useBattleItem(s, { teamId: "T5", itemId: "diaobing", at: at(30, 8), line: 3 }));
    expect(s.bigBattle!.final!.a).toEqual(["T1", "T4", "T8", "T5"]);
  });

  it("battle items are refused by the general useItem and need the battle formed", () => {
    const s = give(ranked(), "T1", "beishui");
    expect(useItem(s, { teamId: "T1", itemId: "beishui", at: at(20, 10) })).toMatchObject({ refusal: "big_battle_item" });
    expect(useBattleItem(s, { teamId: "T1", itemId: "beishui", at: at(20, 10) })).toMatchObject({ refusal: "not_formed" });
  });

  it("settles lines (背水阵, 坚城令, seizing, no-land compensation) and the main battlefield (乾坤圈)", () => {
    let s = give(give(give(formed(), "T1", "beishui"), "T2", "jiancheng"), "T4", "qiankun");
    s.lands.C1!.owner = "T3";
    s.lands.E7!.owner = null; // T7 has no land
    s = ok(useBattleItem(s, { teamId: "T1", itemId: "beishui", at: at(29, 13) }));
    s = ok(useBattleItem(s, { teamId: "T2", itemId: "jiancheng", at: at(29, 13) }));
    expect(useBattleItem(s, { teamId: "T1", itemId: "beishui", at: at(29, 14) })).toMatchObject({ refusal: "not_held" });
    s = ok(submitLines(s, { teamId: "T1", lines: ["T1", "T4", "T5", "T8"], at: at(29, 13) }));
    s = ok(submitLines(s, { teamId: "T2", lines: ["T2", "T3", "T6", "T7"], at: at(29, 13) }));
    s = ok(lockLines(s, { at: at(29, 21) }));
    s = ok(useBattleItem(s, { teamId: "T4", itemId: "qiankun", at: at(33, 20) }));
    const before = Object.fromEntries(s.teamOrder.map((t) => [t, pointsOf(s, t)]));
    expect(settleBigBattle(s, { at: at(33, 20), lineScores: {}, mainScores: { a: 1, b: 0 } })).toMatchObject({ refusal: "too_early" });
    s = ok(
      settleBigBattle(s, {
        at: at(34, 12),
        // line 10: T1 beats T2 (坚城令: nothing seized); line 15: T3 (center) beats T4;
        // line 20: tie; line 25: T8 beats T7 (no land → 4)
        lineScores: { T1: 80, T2: 70, T3: 90, T4: 60, T5: 70, T6: 70, T8: 75, T7: 60 },
        mainScores: { a: 80, b: 70 },
      }),
    );
    const d = (t: string) => pointsOf(s, t) - before[t]!;
    expect(d("T1")).toBe(pts(17.5 + 12));
    expect(d("T2")).toBe(0);
    expect(d("T3")).toBe(pts(15 + 5));
    expect(d("T4")).toBe(pts(-5 + 12 + 12));
    expect(d("T5")).toBe(pts(10 + 12));
    expect(d("T6")).toBe(pts(10));
    expect(d("T8")).toBe(pts(25 + 4 + 12));
    expect(d("T7")).toBe(0);
    expect(settleBigBattle(s, { at: at(34, 12), lineScores: {}, mainScores: { a: 1, b: 0 } })).toMatchObject({ refusal: "already_done" });
  });
});
