/**
 * 法宝图鉴 text (PRD part 5 E5, §3.4; part 3 §13.4): when an item can be
 * used, what it needs as a target, and its effect — with the numbers taken
 * from the season's parameters, so changing a parameter changes the text.
 */

import type { SeasonParams } from "@zhiyouji/engine";

/** What the website asks for before using the item. */
export type ItemTarget =
  | "none" // just confirm
  | "team" // another team
  | "own_land" // one of our lands
  | "contest" // a contest on one of our lands
  | "week" // a weekly war that has not started
  | "line" // a big-battle line (调兵符)
  | "passive"; // works while held, cannot be "used"

export interface ItemGuide {
  when: string;
  target: ItemTarget;
  effect: string;
  /** Broadcast to the whole server when used (all but 侦察令 and passive items). */
  broadcast: boolean;
}

const n = (x: number) => String(Math.round(x * 100) / 100);

export function itemGuide(id: string, p: SeasonParams): ItemGuide {
  const i = p.items;
  const down = `目标排名比你们低时 × ${n(i.punchDownFactor)}`;
  const g = (when: string, target: ItemTarget, effect: string, broadcast = target !== "passive"): ItemGuide => ({ when, target, effect, broadcast });
  switch (id) {
    case "huanhun":
      return g("任意时间", "none", `之后 ${i.huanhun.days} 天里，本组每通过一次每日任务得 ${i.huanhun.grainPerTask} 粮草。`);
    case "yujing":
      return g("周战争开始（周五早间公布）之前", "week", "这一周的周战争如果输了，不扣分（宝箱照开）。");
    case "jianbi":
      return g("持有就生效，触发一次后用掉", "passive", `守住一块地时，每个进攻方 −${n(i.jianbi.pts)} 分，本组每方 +${n(i.jianbi.pts)} 分。`);
    case "bihuo":
      return g("持有就生效", "passive", "自动挡下下一件对本组用的负面法宝。");
    case "taixu":
      return g("任意时间", "none", "复制全服最近一次被使用的法宝（不能复制太虚幻镜）。");
    case "zhencha":
      return g("大团战战线截止之前", "none", "看到本组战线上，对方阵营现在派的是哪个组。", false);
    case "dianhua":
      return g("任意时间", "none", `之后 ${i.dianhua.days} 天里，本组每块地每天多 +${n(i.dianhua.bonusPerLand)} 分。`);
    case "shengsi":
      return g("任意时间", "own_land", `选本组的一块地：立刻 +${n(i.shengsi.pts)} 分，这块地之后 ${i.shengsi.days} 天没有产出。`);
    case "fatian":
      return g(`本组同时有至少 ${i.fatian.minLands} 块地时`, "none", `立刻 +${n(i.fatian.pts)} 分。`);
    case "danao":
      return g("周战争开始（周五早间公布）之前", "week", `这一周的周战争：赢了 +${n(i.danao.win)} 分，输了 ${n(i.danao.lose)} 分。和玉净瓶一起用，输了不扣分。`);
    case "jiuzhuan":
      return g("任意时间", "none", `之后 ${i.jiuzhuan.days} 天里，本组得到的战功 × ${n(i.jiuzhuan.multiplier)}。`);
    case "xiuli":
      return g("一场进攻本组地块的争夺截止之前", "contest", `取消这场争夺；每个进攻方退还 ${Math.round(i.xiuli.refundRatio * 100)}% 的粮草；这道题算用过了。`);
    case "sanmei":
      return g("任意时间", "team", `选一个组：它产出最高的一块地，之后 ${i.sanmei.days} 天的产出归你们（${down}）。`);
    case "zijin":
      return g("任意时间", "team", `选一个组：从它那里抢 ${n(i.zijin.pts)} 分（${down}）。`);
    case "zhaoyao":
      return g("持有就生效", "passive", `挡下下一件对本组用的负面法宝，并把它以 ${n(i.zhaoyao.reflectMultiplier)} 倍效果反弹给使用的组。`);
    case "beishui":
      return g("大团战战线截止之前", "none", `本组战线赢了：战线分 × ${n(i.beishui.winMultiplier)}；输了：再 −${n(i.beishui.losePenalty)} 分。`);
    case "jiancheng":
      return g("大团战战线截止之前", "none", "本组战线输了时，对方拿不走本组地的产出。");
    case "qiankun":
      return g("大团战主战场截止之前", "none", `本阵营主战场赢了 +${n(i.qiankun.win)} 分，输了 ${n(i.qiankun.lose)} 分。`);
    case "bagua":
      return g(`第 ${p.time.bigBattleStartDay} 天之前`, "own_land", `选本组的一块地：只要还是本组的，每天多 +${n(i.bagua.dailyBonus)} 分，到第 ${i.bagua.lastDay} 天为止。`);
    case "qibao":
      return g("任意时间", "none", `从其他每个组各抢 ${n(i.qibao.ptsEach)} 分（排名比你们低的组 × ${n(i.punchDownFactor)}）。`);
    case "diaobing":
      return g("大团战战线公布后 12 小时内", "line", "选一条战线，和本阵营在那条线上的组交换位置。");
    default:
      return g("", "none", "");
  }
}
