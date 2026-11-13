import { describe, expect, it } from "vitest";
import { checkLedger, pts, withParams } from "../../src/index.js";
import {
  grainOf,
  pointsOf,
  settleDay,
  startContest,
  useItem,
  warStartAt,
  addPoints,
  type SeasonState,
} from "../../src/season/index.js";
import { at, defaultOwners, newSeason, ok, withOwners } from "./fixture.js";

function give(s: SeasonState, teamId: string, ...items: string[]): SeasonState {
  for (const itemId of items) s.teams[teamId]!.items.push({ uid: `${teamId}-${itemId}-${s.teams[teamId]!.items.length}`, itemId, source: "admin", acquiredAt: 0 });
  return s;
}

/** Ranks fixed by points: T1 first … T8 last. */
function ranked(s: SeasonState): SeasonState {
  s.teamOrder.forEach((t, i) => addPoints(s, t, pts(100 - i * 10), "admin", at(1, 0)));
  return s;
}

const base = () => ranked(withOwners(newSeason(), defaultOwners));

describe("useItem: general rules (§13.1)", () => {
  it("needs the item, is used once and is broadcast", () => {
    let s = give(base(), "T1", "jiuzhuan");
    expect(useItem(s, { teamId: "T2", itemId: "jiuzhuan", at: at(3, 10) })).toMatchObject({ refusal: "not_held" });
    const r = useItem(s, { teamId: "T1", itemId: "jiuzhuan", at: at(3, 10) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(r.notices[0]).toMatchObject({ kind: "item_used", broadcast: true, data: { teamId: "T1", itemId: "jiuzhuan" } });
    expect(s.teams.T1!.items).toHaveLength(0);
    expect(useItem(s, { teamId: "T1", itemId: "jiuzhuan", at: at(3, 11) })).toMatchObject({ refusal: "not_held" });
  });
  it("refuses passive, big-battle, disabled items and use outside the season", () => {
    const s = give(base(), "T1", "bihuo", "beishui", "zijin");
    expect(useItem(s, { teamId: "T1", itemId: "bihuo", at: at(3, 10) })).toMatchObject({ refusal: "passive_item" });
    expect(useItem(s, { teamId: "T1", itemId: "beishui", at: at(3, 10) })).toMatchObject({ refusal: "big_battle_item" });
    expect(useItem(s, { teamId: "T1", itemId: "zijin", at: at(34, 10), targetTeamId: "T2" })).toMatchObject({ refusal: "out_of_season" });
    const off = { ...s, params: withParams({ items: { disabled: ["zijin"] } }) };
    expect(useItem(off, { teamId: "T1", itemId: "zijin", at: at(3, 10), targetTeamId: "T2" })).toMatchObject({ refusal: "disabled" });
  });
});

describe("negative items", () => {
  it("紫金红葫芦: steals 5 from a higher-ranked team, 2.5 from a lower one", () => {
    const s = give(base(), "T4", "zijin", "zijin");
    const up = ok(useItem(s, { teamId: "T4", itemId: "zijin", at: at(3, 10), targetTeamId: "T1" }));
    expect(pointsOf(up, "T1")).toBe(pts(100 - 5));
    expect(pointsOf(up, "T4")).toBe(pts(70 + 5));
    const down = ok(useItem(s, { teamId: "T4", itemId: "zijin", at: at(3, 10), targetTeamId: "T8" }));
    expect(pointsOf(down, "T8")).toBe(pts(30 - 2.5));
    expect(useItem(s, { teamId: "T4", itemId: "zijin", at: at(3, 10), targetTeamId: "T4" })).toMatchObject({ refusal: "invalid_target" });
  });
  it("照妖镜 triggers before 辟火罩 and reflects at 2×; the blocked item counts as used", () => {
    let s = give(give(base(), "T4", "zijin"), "T1", "zhaoyao", "bihuo");
    s = ok(useItem(s, { teamId: "T4", itemId: "zijin", at: at(3, 10), targetTeamId: "T1" }));
    expect(pointsOf(s, "T4")).toBe(pts(70 - 10));
    expect(pointsOf(s, "T1")).toBe(pts(100 + 10));
    expect(s.teams.T1!.items.map((i) => i.itemId)).toEqual(["bihuo"]);
    expect(s.teams.T4!.items).toHaveLength(0);
    expect(s.usedItems.map((u) => u.itemId)).toEqual(["zhaoyao", "zijin"]);
    s = give(s, "T5", "zijin");
    s = ok(useItem(s, { teamId: "T5", itemId: "zijin", at: at(3, 11), targetTeamId: "T1" }));
    expect(pointsOf(s, "T5")).toBe(pts(60));
    expect(s.teams.T1!.items).toHaveLength(0);
  });
  it("七宝紫金钵: each target settled separately", () => {
    let s = give(give(base(), "T3", "qibao"), "T1", "bihuo");
    give(s, "T8", "zhaoyao");
    s = ok(useItem(s, { teamId: "T3", itemId: "qibao", at: at(3, 10) }));
    // T1 blocked; T2 higher → 3; T4..T7 lower → 1.5 each; T8 reflects 1.5 × 2 = 3 back
    expect(pointsOf(s, "T2")).toBe(pts(90 - 3));
    expect(pointsOf(s, "T5")).toBe(pts(60 - 1.5));
    expect(pointsOf(s, "T8")).toBe(pts(30 + 3));
    expect(pointsOf(s, "T3")).toBe(pts(80 + 3 + 4 * 1.5 - 3));
    expect(checkLedger(s.ledger)).toEqual([]);
  });
  it("三昧真火: moves the target's best land income for 3 days, half when punching down, stops on capture", () => {
    let s = give(base(), "T4", "sanmei", "sanmei");
    s.lands.C1!.owner = "T1";
    s.lands.C2!.owner = "T8";
    const up = ok(useItem(s, { teamId: "T4", itemId: "sanmei", at: at(3, 10), targetTeamId: "T1" }));
    expect(up.effects.at(-1)).toMatchObject({ kind: "sanmei", victim: "T1", beneficiary: "T4", landId: "C1", share: 1 });
    let x = up;
    for (let d = 3; d <= 6; d++) x = ok(settleDay(x, d));
    // T1 earns 2 + 1 per day, loses the C1 income (2) on D3, D4, D5 24:00 (3 days)
    expect(pointsOf(x, "T1") - pointsOf(s, "T1")).toBe(pts(4 * 3 - 3 * 2));
    expect(pointsOf(x, "T4") - pointsOf(s, "T4")).toBe(pts(4 * 1 + 3 * 2));
    const down = ok(useItem(s, { teamId: "T4", itemId: "sanmei", at: at(3, 10), targetTeamId: "T8" }));
    expect(down.effects.at(-1)).toMatchObject({ share: 0.5, landId: "C2" });
    s.lands.E5!.owner = null;
    expect(useItem(s, { teamId: "T4", itemId: "sanmei", at: at(3, 10), targetTeamId: "T5" })).toMatchObject({ refusal: "target_has_no_land" });
  });
});

describe("self items", () => {
  it("生死簿: +7 now, the land earns 0 for 4 days but keeps its place", () => {
    let s = give(base(), "T1", "shengsi");
    s.lands.C1!.owner = "T1";
    expect(useItem(s, { teamId: "T1", itemId: "shengsi", at: at(3, 10), landId: "E2" })).toMatchObject({ refusal: "not_own_land" });
    s = ok(useItem(s, { teamId: "T1", itemId: "shengsi", at: at(3, 10), landId: "C1" }));
    expect(pointsOf(s, "T1")).toBe(pts(107));
    for (let d = 3; d <= 7; d++) s = ok(settleDay(s, d));
    // D3..D6 24:00: C1 zeroed, E1 at position 2 → 1; D7: 2 + 1
    expect(pointsOf(s, "T1")).toBe(pts(107 + 4 * 1 + 3));
  });
  it("法天象地 needs 3 lands", () => {
    const s = give(base(), "T1", "fatian");
    expect(useItem(s, { teamId: "T1", itemId: "fatian", at: at(3, 10) })).toMatchObject({ refusal: "too_few_lands" });
    s.lands.C1!.owner = "T1";
    s.lands.C2!.owner = "T1";
    expect(pointsOf(ok(useItem(s, { teamId: "T1", itemId: "fatian", at: at(3, 10) })), "T1")).toBe(pts(110));
  });
  it("点化之术: +1 per land per day for 3 days, not diminished; 八卦炉: +1.5 while held, to D28", () => {
    let s = give(base(), "T1", "dianhua", "bagua");
    s.lands.C1!.owner = "T1";
    s.lands.E2!.owner = "T1";
    s = ok(useItem(s, { teamId: "T1", itemId: "dianhua", at: at(3, 10) }));
    s = ok(useItem(s, { teamId: "T1", itemId: "bagua", at: at(3, 10), landId: "E1" }));
    const before = pointsOf(s, "T1");
    for (let d = 3; d <= 6; d++) s = ok(settleDay(s, d));
    const income = 2 + 1 + 0.6;
    expect(pointsOf(s, "T1") - before).toBe(pts(4 * income + 3 * 3 + 4 * 1.5));
    const late = give(base(), "T2", "bagua");
    expect(useItem(late, { teamId: "T2", itemId: "bagua", at: at(29, 8), landId: "E2" })).toMatchObject({ refusal: "too_late" });
  });
  it("八卦炉 stops after D28", () => {
    let s = give(base(), "T1", "bagua");
    s = ok(useItem(s, { teamId: "T1", itemId: "bagua", at: at(27, 10), landId: "E1" }));
    const b = pointsOf(s, "T1");
    s = ok(settleDay(s, 28));
    s = ok(settleDay(s, 29));
    expect(pointsOf(s, "T1") - b).toBe(pts(1 + 1.5 + 1));
  });
  it("玉净瓶 / 大闹天宫 activate for the next war not yet started", () => {
    let s = give(base(), "T1", "yujing", "danao", "yujing");
    expect(warStartAt(s, 1)).toBe(at(5, 7));
    s = ok(useItem(s, { teamId: "T1", itemId: "yujing", at: at(5, 6, 59) }));
    expect(s.effects.at(-1)).toMatchObject({ kind: "yujing", week: 1 });
    s = ok(useItem(s, { teamId: "T1", itemId: "danao", at: at(5, 7) }));
    expect(s.effects.at(-1)).toMatchObject({ kind: "danao", week: 2 });
    expect(useItem(s, { teamId: "T1", itemId: "yujing", at: at(5, 8), week: 1 })).toMatchObject({ refusal: "war_started" });
    expect(useItem(s, { teamId: "T1", itemId: "yujing", at: at(26, 8) })).toMatchObject({ refusal: "no_war_week" });
  });
  it("袖里乾坤: cancels a contest on the team's land, half the grain back", () => {
    let s = give(base(), "T2", "xiuli");
    s = ok(startContest(s, { contestId: "K1", teamId: "T1", landId: "E2", at: at(2, 10) }));
    const paid = s.contests.K1!.attackers[0]!.paid;
    expect(useItem(s, { teamId: "T2", itemId: "xiuli", at: at(5, 21), contestId: "K1" })).toMatchObject({ refusal: "contest_closed" });
    const r = ok(useItem(s, { teamId: "T2", itemId: "xiuli", at: at(5, 20), contestId: "K1" }));
    expect(r.contests.K1!.status).toBe("cancelled");
    expect(grainOf(r, "T1")).toBe(60 - paid + Math.floor(paid / 2));
    expect(r.usedPrompts.E2).toHaveLength(1);
  });
});

describe("太虚幻镜 (§20.4)", () => {
  it("copies the latest non-epic item with a new target", () => {
    let s = give(give(base(), "T4", "zijin", "qibao"), "T6", "taixu");
    expect(useItem(s, { teamId: "T6", itemId: "taixu", at: at(3, 9) })).toMatchObject({ refusal: "nothing_to_copy" });
    s = ok(useItem(s, { teamId: "T4", itemId: "zijin", at: at(3, 10), targetTeamId: "T1" }));
    s = ok(useItem(s, { teamId: "T4", itemId: "qibao", at: at(3, 11) }));
    const before = pointsOf(s, "T2");
    s = ok(useItem(s, { teamId: "T6", itemId: "taixu", at: at(3, 12), targetTeamId: "T2" }));
    expect(pointsOf(s, "T2")).toBe(before - pts(5));
  });
  it("copying a triggered passive item gives a held copy", () => {
    let s = give(give(give(base(), "T4", "zijin"), "T1", "bihuo"), "T6", "taixu");
    s = ok(useItem(s, { teamId: "T4", itemId: "zijin", at: at(3, 10), targetTeamId: "T1" }));
    expect(s.usedItems.map((u) => u.itemId)).toEqual(["bihuo", "zijin"]);
    s.usedItems.pop(); // pretend the blocked 葫芦 was older
    s = ok(useItem(s, { teamId: "T6", itemId: "taixu", at: at(3, 12) }));
    expect(s.teams.T6!.items.map((i) => [i.itemId, i.source])).toEqual([["bihuo", "copy"]]);
  });
  it("must meet the copied item's conditions", () => {
    let s = give(give(base(), "T1", "fatian"), "T6", "taixu");
    s.lands.C1!.owner = "T1";
    s.lands.C2!.owner = "T1";
    s = ok(useItem(s, { teamId: "T1", itemId: "fatian", at: at(3, 10) }));
    expect(useItem(s, { teamId: "T6", itemId: "taixu", at: at(3, 12) })).toMatchObject({ refusal: "too_few_lands" });
  });
});
