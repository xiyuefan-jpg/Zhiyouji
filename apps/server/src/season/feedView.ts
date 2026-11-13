/**
 * What each team may see of the engine's notices, and one line of Chinese for
 * each (PRD part 5 F1 战报, F2 全服广播, E1 组内动态; part 3 §1.2).
 *
 * - Broadcast notices (§1.2) are shown at once to the whole server.
 * - Results (not broadcast) go into the next report (战报) at the next
 *   publication time.
 * - What a team holds (items from starter picks, chests, the shop, the rare
 *   round, admin gifts) is only shown to that team (part 7 §7: 孩子之间保密).
 * - Team matters (roles, members leaving, daily tasks counted, ledger
 *   corrections) are the team feed; line-ups go to the camp only.
 */

import { itemDef, type Notice } from "@zhiyouji/engine";

export type Scope = "server" | "team" | "hidden";

export interface FeedNames {
  team: (id: string | null | undefined) => string;
  land: (id: string | null | undefined) => string;
  child: (id: string | null | undefined) => string;
}

export interface FeedLine {
  kind: string;
  at: number;
  scope: Exclude<Scope, "hidden">;
  text: string;
  data: Record<string, unknown>;
}

type Data = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const item = (id: unknown) => {
  try {
    return itemDef(String(id)).name;
  } catch {
    return String(id);
  }
};
const pts = (v: unknown) => (typeof v === "number" ? (v / 100).toFixed(1) : "?");

/** Kinds that concern one team only (data.teamId). */
const TEAM_KINDS = new Set([
  "role_claimed",
  "role_transferred",
  "role_takeover",
  "role_admin_set",
  "member_left",
  "daily_task_counted",
  "ledger_adjusted",
  "item_given",
  "item_removed",
  "shop_bought",
]);

const HIDDEN_KINDS = new Set(["daily_settled", "daily_skipped_paused", "entry_reversed"]);

/**
 * The notice as `teamId` (in `camp`) may see it, or null. Allocation lists are
 * cut down to the team's own entry.
 */
export function viewFor(n: Pick<Notice, "kind" | "data" | "broadcast">, teamId: string, campTeams: readonly string[] = []): { scope: Exclude<Scope, "hidden">; data: Data } | null {
  const d = n.data as Data;
  if (HIDDEN_KINDS.has(n.kind)) return null;
  if (TEAM_KINDS.has(n.kind)) return d.teamId === teamId ? { scope: "team", data: d } : null;
  switch (n.kind) {
    case "starter_items": {
      const mine = ((d.allocations as { teamId: string }[]) ?? []).filter((a) => a.teamId === teamId);
      return mine.length ? { scope: "team", data: { allocations: mine } } : null;
    }
    case "rare_round": {
      const mine = ((d.allocations as { teamId: string }[]) ?? []).filter((a) => a.teamId === teamId);
      return { scope: "server", data: { allocations: mine } };
    }
    case "leaders_assigned": {
      const mine = ((d.assigned as { teamId: string }[]) ?? []).filter((a) => a.teamId === teamId);
      return mine.length ? { scope: "team", data: { assigned: mine } } : null;
    }
    case "war_result": {
      const results = ((d.results as { teamId: string; chestItem: string | null }[]) ?? []).map((r) => (r.teamId === teamId ? r : { ...r, chestItem: null }));
      return { scope: "server", data: { ...d, results } };
    }
    case "lines_submitted":
      return campTeams.includes(String(d.teamId)) || d.teamId === teamId ? { scope: "team", data: d } : null;
    case "item_used":
      // 侦察令 is not broadcast (§13.4): only the team that used it knows.
      if (!n.broadcast) return d.teamId === teamId ? { scope: "team", data: d } : null;
      return { scope: "server", data: d };
    default:
      return { scope: "server", data: d };
  }
}

/** One line of Chinese for a (visible) notice. */
export function describe(kind: string, d: Data, names: FeedNames, teamId: string): string {
  const T = names.team;
  const L = names.land;
  const C = names.child;
  switch (kind) {
    case "contest_started":
      return `${T(str(d.attacker))}向${T(str(d.defender))}的${L(str(d.landId))}发起了进攻`;
    case "contest_joined":
      return `${T(str(d.attacker))}加入了对${L(str(d.landId))}的进攻`;
    case "contest_captured":
      return `${T(str(d.winner))}夺下了${L(str(d.landId))}`;
    case "contest_defended":
      return `${T(str(d.defender))}守住了${L(str(d.landId))}`;
    case "contest_nothing":
      return `${L(str(d.landId))}的争夺没有结果，地块不变`;
    case "contest_cancelled":
      return d.by === "xiuli" ? `${T(str(d.teamId))}用袖里乾坤撤回了进攻` : `一场争夺被管理员取消了`;
    case "auction_result":
      return "第 1 批选地（盲拍）结果公布了";
    case "starter_items":
      return `开营法宝发下来了：${((d.allocations as { item: string }[]) ?? []).map((a) => item(a.item)).join("、")}`;
    case "center_round":
      return "中心地逆序购买结果公布了";
    case "center_bought":
      return `${T(str(d.teamId))}买下了中心地${L(str(d.landId))}`;
    case "shop_bought":
      return `本组在商店买了${item(d.itemId)}`;
    case "rare_round": {
      const mine = (d.allocations as { item: string }[]) ?? [];
      return mine.length ? `灵品分配完成，本组分到：${mine.map((a) => item(a.item)).join("、")}` : "灵品分配完成";
    }
    case "epic_auctions_open":
      return "仙品竞价开始了";
    case "epic_bid":
      return `${T(str(d.teamId))}对${item(d.itemId)}出价 ${d.amount} 粮草`;
    case "epic_auction_closed":
      return d.winner ? `${T(str(d.winner))}以 ${d.amount} 粮草拍得${item(d.itemId)}` : `${item(d.itemId)}流拍了`;
    case "war_paired":
      return `第 ${d.week} 周周战争配对公布了`;
    case "war_result":
      return `第 ${d.week} 周周战争结果公布了`;
    case "participation_award":
      return `第 ${d.week} 周全员参与奖发放了`;
    case "supply_result":
      return "军需任务结果公布了";
    case "big_battle_formed":
      return "大团战分阵营了";
    case "lines_submitted":
      return `${C(str(d.by))}更新了战线分配`;
    case "lines_locked":
      return "大团战战线锁定了";
    case "big_battle_result":
      return "大团战结果公布了";
    case "season_paused":
      return "赛季暂停了";
    case "season_resumed":
      return "赛季恢复了";
    case "season_final":
      return "终局结算公布了";
    case "land_owner_set":
      return `管理员把${L(str(d.landId))}的主人改成了${d.to ? T(str(d.to)) : "无主"}`;
    case "item_used": {
      const who = T(str(d.teamId));
      const target = d.targetTeamId ? `对${T(str(d.targetTeamId))}` : d.landId ? `在${L(str(d.landId))}上` : "";
      return `${who}${target}使用了${item(d.itemId)}`;
    }
    case "item_outcome":
      return d.outcome === "blocked" ? `${item(d.itemId)}被挡下了` : d.outcome === "reflected" ? `${item(d.itemId)}被照妖镜反弹了` : `${item(d.itemId)}生效了`;
    case "role_claimed":
    case "role_transferred":
    case "role_takeover":
    case "role_admin_set":
    case "leaders_assigned": {
      if (kind === "leaders_assigned") {
        const a = ((d.assigned as { teamId: string; leader: string }[]) ?? []).find((x) => x.teamId === teamId);
        return a ? `没有人认领组长，系统指定${C(a.leader)}为组长` : "系统指定了组长";
      }
      const parts = [d.leader ? `组长：${C(str(d.leader))}` : "组长：空缺", d.deputy ? `副组长：${C(str(d.deputy))}` : "副组长：空缺"];
      const verb = { role_claimed: "认领", role_transferred: "移交", role_takeover: "接任", role_admin_set: "管理员调整" }[kind];
      return `组长变动（${verb}）：${parts.join("，")}`;
    }
    case "member_left":
      return `${C(str(d.childId))}退出了赛季`;
    case "daily_task_counted":
      return d.counted ? `${C(str(d.childId))}的每日任务通过了，本组粮草 +${d.grain}` : `${C(str(d.childId))}的每日任务通过了（今天或本周已计满，记进修行日志）`;
    case "ledger_adjusted":
      return `管理员调整了本组的${d.currency === "grain" ? "粮草" : "团队分"}：${d.currency === "grain" ? d.amount : pts(d.amount)}（${d.reason}）`;
    case "item_given":
      return `管理员发给本组一件${item(d.itemId)}`;
    case "item_removed":
      return `管理员收回了本组的${item(d.itemId)}`;
    default:
      return kind;
  }
}
