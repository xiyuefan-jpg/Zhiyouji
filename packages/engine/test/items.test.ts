import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  DAY,
  ITEMS,
  baguaDailyBonus,
  fatianPoints,
  itemDef,
  jianbiTransfers,
  punchDownFactor,
  resolveHit,
  taixuCopyTarget,
  useQibao,
  useSanmei,
  useZijin,
  withParams,
  xiuliRefund,
} from "../src/index.js";

const none = { zhaoyao: false, bihuo: false };

describe("item catalog", () => {
  it("has the 21 items of §13.4", () => {
    expect(ITEMS).toHaveLength(21);
    expect(ITEMS.filter((i) => i.tier === "common")).toHaveLength(6);
    expect(ITEMS.filter((i) => i.tier === "rare")).toHaveLength(12);
    expect(ITEMS.filter((i) => i.tier === "epic")).toHaveLength(3);
    expect(ITEMS.filter((i) => i.negative).map((i) => i.id)).toEqual(["sanmei", "zijin", "qibao"]);
    expect(itemDef("zhaoyao").name).toBe("玄天照妖镜");
  });
});

describe("negative items (§13.1, §20.4)", () => {
  it("punch-down factor halves effects on lower-ranked targets", () => {
    expect(punchDownFactor(3, 1, P)).toBe(1);
    expect(punchDownFactor(1, 3, P)).toBe(0.5);
    expect(punchDownFactor(1, 3, withParams({ items: { punchDownFactor: 1 } }))).toBe(1);
  });
  it("照妖镜 triggers before 辟火罩", () => {
    expect(resolveHit({ zhaoyao: true, bihuo: true }, P)).toEqual({ kind: "reflected", consumed: "zhaoyao", multiplier: 2 });
    expect(resolveHit({ zhaoyao: false, bihuo: true }, P)).toEqual({ kind: "blocked", consumed: "bihuo" });
  });
  it("紫金红葫芦 steals 5, 2.5 from a lower-ranked team, and reflects at 2×", () => {
    expect(useZijin({ teamId: "U", rank: 4 }, { teamId: "T", rank: 1, defenses: none }, P).transfer).toEqual({
      from: "T",
      to: "U",
      amount: 500,
    });
    expect(useZijin({ teamId: "U", rank: 1 }, { teamId: "T", rank: 4, defenses: none }, P).transfer?.amount).toBe(250);
    expect(
      useZijin({ teamId: "U", rank: 4 }, { teamId: "T", rank: 1, defenses: { zhaoyao: true, bihuo: false } }, P).transfer,
    ).toEqual({ from: "U", to: "T", amount: 1000 });
    expect(useZijin({ teamId: "U", rank: 4 }, { teamId: "T", rank: 1, defenses: { zhaoyao: false, bihuo: true } }, P).transfer).toBeNull();
  });
  it("七宝紫金钵 settles each target separately", () => {
    const r = useQibao(
      { teamId: "U", rank: 3 },
      [
        { teamId: "A", rank: 1, defenses: none },
        { teamId: "B", rank: 2, defenses: { zhaoyao: false, bihuo: true } },
        { teamId: "U", rank: 3, defenses: none },
        { teamId: "C", rank: 4, defenses: none },
        { teamId: "D", rank: 5, defenses: { zhaoyao: true, bihuo: false } },
      ],
      P,
    );
    expect(r.map((x) => x.transfer)).toEqual([
      { from: "A", to: "U", amount: 300 },
      null,
      { from: "C", to: "U", amount: 150 },
      { from: "U", to: "D", amount: 300 },
    ]);
  });
  it("三昧真火 moves the target's best land output for 3 days; reflected, the user's at 2×", () => {
    const hit = useSanmei(
      { teamId: "U", rank: 2, bestLandId: "uL" },
      { teamId: "T", rank: 1, bestLandId: "tL", defenses: none },
      1000,
      P,
    );
    expect(hit.effect).toMatchObject({ victim: "T", beneficiary: "U", landId: "tL", share: 1, until: 1000 + 3 * DAY });
    const back = useSanmei(
      { teamId: "U", rank: 1, bestLandId: "uL" },
      { teamId: "T", rank: 2, bestLandId: "tL", defenses: { zhaoyao: true, bihuo: false } },
      1000,
      P,
    );
    expect(back.effect).toMatchObject({ victim: "U", beneficiary: "T", landId: "uL", share: 1 });
  });
});

describe("other items", () => {
  it("法天象地 needs 3 lands", () => {
    expect(fatianPoints(2, P)).toBeNull();
    expect(fatianPoints(3, P)).toBe(1000);
  });
  it("袖里乾坤 refunds half, rounded down", () => {
    expect(xiuliRefund(45, P)).toBe(22);
  });
  it("坚壁清野: −3 per attacker to the defender", () => {
    expect(jianbiTransfers("D", ["A", "B"], P)).toEqual([
      { from: "A", to: "D", amount: 300 },
      { from: "B", to: "D", amount: 300 },
    ]);
  });
  it("太虚幻镜 copies the latest non-epic item other than itself", () => {
    expect(taixuCopyTarget(["qibao", "taixu", "bihuo", "zijin"])).toBe("bihuo");
    expect(taixuCopyTarget(["bagua", "qibao"])).toBeNull();
  });
  it("八卦炉 pays 1.5 a day through D28 while the land is held", () => {
    expect(baguaDailyBonus(true, 28, P)).toBe(150);
    expect(baguaDailyBonus(true, 29, P)).toBe(0);
    expect(baguaDailyBonus(false, 20, P)).toBe(0);
  });
});
