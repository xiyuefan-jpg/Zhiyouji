/**
 * §16 "暂停期间所有计划事件顺延" and §18 "截止时间自动顺延暂停的时长" for the
 * windows that come from the calendar (war, shop, big battle, contest start),
 * and §14 "结算 W4 后" for forming the camps.
 */

import { describe, expect, it } from "vitest";
import { DAY } from "../../src/index.js";
import {
  afterPauses,
  battleDeadline,
  formBigBattle,
  pairWar,
  pauseSeason,
  resumeSeason,
  settleWar,
  shopClosesAt,
  startContest,
  warDeadline,
  warStartAt,
} from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, TEAMS, withOwners } from "./fixture.js";


const base = () => withOwners(newSeason(), defaultOwners);

describe("calendar windows move with finished pauses", () => {
  it("afterPauses: only finished pauses that began before the time count, chained", () => {
    const s = { pauses: [{ from: 100, until: 150 }, { from: 160, until: 200 }, { from: 500, until: null }] };
    expect(afterPauses(s, 50)).toBe(50);
    expect(afterPauses(s, 120)).toBe(210); // +50 → 170, then 170 > 160 → +40
    expect(afterPauses(s, 120 + 1000)).toBe(1120 + 90); // the open pause does not count yet
  });

  it("a one-day pause in week 2 moves the W2 deadline, W2 start, the shop and the big battle by a day", () => {
    let s = base();
    const before = { w2: warDeadline(s, 2), w2start: warStartAt(s, 2), shop: shopClosesAt(s), battle: battleDeadline(s), w1: warDeadline(s, 1) };
    s = ok(pauseSeason(s, { at: at(9, 10), reason: "维护" }));
    // still open: nothing moves yet
    expect(warDeadline(s, 2)).toBe(before.w2);
    s = ok(resumeSeason(s, { at: at(10, 10) }));
    expect(warDeadline(s, 2)).toBe(before.w2 + DAY);
    expect(warStartAt(s, 2)).toBe(before.w2start + DAY);
    expect(shopClosesAt(s)).toBe(before.shop + DAY);
    expect(battleDeadline(s)).toBe(before.battle + DAY);
    // W1 ended before the pause: unchanged
    expect(warDeadline(s, 1)).toBe(before.w1);
  });

  it("the last day to start a contest moves by the paused time", () => {
    let s = base();
    const last = s.params.contest.lastInitiationDay;
    const late = at(last, 21, 30);
    expect(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: late })).toMatchObject({ refusal: "not_in_window" });
    s = ok(pauseSeason(s, { at: at(5, 10), reason: "维护" }));
    s = ok(resumeSeason(s, { at: at(5, 11) }));
    expect(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: late }).ok).toBe(true);
  });
});

describe("§14 the camps form only after the last war is settled", () => {
  it("refused while W4 is unsettled; formed once it is", () => {
    let s = base();
    const weeks = Math.floor((s.params.time.bigBattleStartDay - 1) / 7);
    const scores = Object.fromEntries(TEAMS.map((t, i) => [t, 50 + i]));
    for (let w = 1; w <= weeks; w++) {
      s = ok(pairWar(s, { week: w, at: at(7 * w - 3, 21) }));
      if (w < weeks) s = ok(settleWar(s, { week: w, at: at(7 * w + 1, 12), scores }));
    }
    const camps = at(s.params.time.bigBattleStartDay, 12);
    expect(formBigBattle(s, { at: camps })).toMatchObject({ ok: false, refusal: "war_unsettled" });
    s = ok(settleWar(s, { week: weeks, at: camps, scores }));
    expect(formBigBattle(s, { at: camps + 60_000 }).ok).toBe(true);
  });
});
