/**
 * Chinese text for every engine refusal (shown to children and admins).
 * Typed against the engine's union, so a new refusal without text fails the
 * type check.
 */

import type { SeasonRefusal } from "@zhiyouji/engine";

export const REFUSAL_TEXT: Record<SeasonRefusal, string> = {
  // general
  unknown_event: "系统不认识这个操作",
  unknown_team: "找不到这个小组",
  unknown_child: "找不到这个组员",
  unknown_land: "找不到这块地",
  unknown_contest: "找不到这场争夺",
  unknown_item: "找不到这件法宝",
  unknown_entry: "找不到这条账目",
  unknown_auction: "找不到这场竞价",
  not_leader: "请组长或副组长操作",
  out_of_season: "现在不在赛季时间里",
  war_unsettled: "周战争还没结算完",
  bad_deadline: "新的截止时间不对（不能早于现在）",
  too_early: "还没到时间",
  too_late: "已经过了截止时间",
  already_done: "这件事已经做过了",
  already_settled: "已经结算过了",
  before_deadline: "还没到截止时间",
  disabled: "这件法宝本季没有开放",
  not_enough_grain: "粮草不够",
  not_integer: "数量必须是整数",
  needs_reason: "请填写原因",
  duplicate: "重复提交了",
  bad_week: "没有这一周",
  // roles
  not_member: "这个人不是本组成员",
  taken: "这个位置已经有人了",
  holds_other_role: "已经担任另一个职务了，不能同时当组长和副组长",
  not_holder: "你不是这个职务的担任者",
  same_person: "不能移交给自己",
  not_deputy: "只有副组长可以接任",
  leader_active: "组长最近登录过，还不能接任",
  // admin
  already_reversed: "这条账目已经冲正过了",
  is_reversal: "冲正记录不能再冲正",
  already_paused: "赛季已经暂停了",
  not_paused: "赛季没有暂停",
  not_held: "本组没有这件法宝",
  // contests
  not_in_window: "现在不能发起进攻（D1 盲拍之后到 D25 21:00 之间才可以）",
  unowned_land: "这块地还没有主人，不能进攻",
  own_land: "不能进攻自己的地",
  contest_in_progress: "这块地正在被争夺",
  no_prompts: "这块地的题库空了，请联系管理员",
  duplicate_id: "重复的操作",
  join_closed: "加入进攻的时间已经过了",
  is_defender: "守方不能加入进攻",
  already_in: "本组已经在这场争夺里了",
  not_active: "这场争夺已经结束了",
  // rounds
  auction_pending: "盲拍还没结束",
  round_pending: "中心地逆序购买还没结束",
  not_center: "这不是中心地",
  sold: "这块地已经被买走了",
  // shop
  shop_limit: "本组在商店里最多买 3 件",
  epic_limit: "每组最多拍得 1 件仙品",
  already_have_kind: "本组已经有这种法宝了",
  out_of_stock: "这件法宝卖完了",
  not_open: "竞价还没开始",
  closed: "竞价已经结束了",
  too_low: "出价太低了",
  already_leading: "本组已经是最高价了",
  leading_elsewhere: "本组正在另一件仙品的竞价里领先",
  shop_closed: "商店没有开放",
  rare_round_pending: "灵品还没分配完",
  not_ended: "竞价还没结束",
  epic_use_auction: "仙品只能通过竞价获得",
  // items
  passive_item: "这件法宝持有就生效，不用手动使用",
  big_battle_item: "这件法宝只能在大团战里用",
  needs_target: "请选择目标",
  invalid_target: "不能对这个目标使用",
  target_has_no_land: "对方没有地",
  not_own_land: "只能用在本组的地上",
  too_few_lands: "本组的地不够",
  no_war_week: "已经没有可以用的周战争了",
  war_started: "这一周的周战争已经开始了",
  nothing_to_copy: "还没有可以复制的法宝",
  owner_changed: "这块地已经换了主人",
  not_settled: "这场争夺还没有结算",
  later_contest: "这块地之后又被争夺过，请手动调整",
  contest_active: "这块地正在被争夺",
  contest_closed: "这场争夺已经结束了",
  not_defender: "只有守方能用",
  // war
  not_paired: "本周没有配对",
  // big battle
  not_formed: "大团战还没分阵营",
  not_locked: "战线还没锁定",
  bad_assignment: "战线分配不对：每条线派一个本阵营的组，每组一条线",
  not_in_camp: "本组不在这个阵营里",
  not_battle_item: "这不是大团战法宝",
  already_active: "这件法宝已经生效了",
  no_assignment: "还没有战线分配",
  bad_line: "没有这条战线",
  battle_not_settled: "大团战还没结算",
};

export function refusalText(code: string): string {
  return (REFUSAL_TEXT as Record<string, string>)[code] ?? "现在不能这样做";
}
