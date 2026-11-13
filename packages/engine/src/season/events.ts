/**
 * One entry point for every season event, so the server can store events in
 * order and rebuild any state by replaying them (PRD part 2 §4: the ledger and
 * the event log are the source of truth; §16: re-running is idempotent).
 */

import { adjustLedger, adminGiveItem, adminRemoveItem, adminSetLandOwner, adminSetTeamRole, claimTeamRole, finalizeSeason, memberLeaves, pauseSeason, resumeSeason, reverseEntry, setLandPrompts, setParams, systemAssignLeaders, takeOverLeader, transferTeamRole } from "./admin.js";
import { formBigBattle, lockLines, settleBigBattle, submitLines, useBattleItem } from "./bigBattle.js";
import { adminCancelContest, joinContest, resettleContest, settleContest, startContest } from "./contests.js";
import { settleDay } from "./daily.js";
import { buyCenterLand, runBlindAuction, runCenterRound, runStarterItems } from "./rounds.js";
import { bidEpic, buyShopItem, closeEpicAuction, openEpicAuctions, runRareRound } from "./shop.js";
import { dailyTaskPassed, runParticipationAward, settleSupply } from "./tasks.js";
import { useItem } from "./useItem.js";
import { pairWar, settleWar } from "./war.js";
import type { Notice, Result, SeasonState } from "./state.js";
import type { AdminRefusal } from "./admin.js";
import type { BattleRefusal } from "./bigBattle.js";
import type { ContestRefusal } from "./contests.js";
import type { DailyRefusal } from "./daily.js";
import type { RoundRefusal } from "./rounds.js";
import type { SeasonShopRefusal } from "./shop.js";
import type { TaskRefusal } from "./tasks.js";
import type { ItemRefusal } from "./useItem.js";
import type { WarRefusal } from "./war.js";

/** Every reason the engine can refuse an event (the API turns these into Chinese messages). */
export type SeasonRefusal =
  | AdminRefusal
  | BattleRefusal
  | ContestRefusal
  | DailyRefusal
  | RoundRefusal
  | SeasonShopRefusal
  | TaskRefusal
  | ItemRefusal
  | WarRefusal
  | "unknown_event";

type Arg<F> = F extends (s: SeasonState, e: infer E) => unknown ? E : never;

const HANDLERS = {
  settle_day: (s: SeasonState, e: { day: number }) => settleDay(s, e.day),
  start_contest: startContest,
  join_contest: joinContest,
  settle_contest: settleContest,
  resettle_contest: resettleContest,
  cancel_contest: adminCancelContest,
  use_item: useItem,
  use_battle_item: useBattleItem,
  blind_auction: runBlindAuction,
  starter_items: runStarterItems,
  center_round: runCenterRound,
  buy_center_land: buyCenterLand,
  daily_task_passed: dailyTaskPassed,
  participation_award: runParticipationAward,
  settle_supply: settleSupply,
  buy_shop_item: buyShopItem,
  rare_round: runRareRound,
  open_epic_auctions: openEpicAuctions,
  bid_epic: bidEpic,
  close_epic_auction: closeEpicAuction,
  pair_war: pairWar,
  settle_war: settleWar,
  form_big_battle: formBigBattle,
  submit_lines: submitLines,
  lock_lines: lockLines,
  settle_big_battle: settleBigBattle,
  claim_role: claimTeamRole,
  transfer_role: transferTeamRole,
  take_over_leader: takeOverLeader,
  assign_leaders: systemAssignLeaders,
  admin_set_role: adminSetTeamRole,
  member_leaves: memberLeaves,
  pause: pauseSeason,
  resume: resumeSeason,
  adjust_ledger: adjustLedger,
  reverse_entry: reverseEntry,
  set_land_owner: adminSetLandOwner,
  give_item: adminGiveItem,
  remove_item: adminRemoveItem,
  finalize: finalizeSeason,
  set_params: setParams,
  set_land_prompts: setLandPrompts,
} as const;

export type SeasonEventType = keyof typeof HANDLERS;

export type SeasonEvent = { [K in SeasonEventType]: { type: K } & Arg<(typeof HANDLERS)[K]> }[SeasonEventType];

export function applyEvent(s: SeasonState, ev: SeasonEvent): Result<string> {
  const { type, ...payload } = ev;
  const h = HANDLERS[type] as (s: SeasonState, e: unknown) => Result<string>;
  if (!h) return { ok: false, refusal: "unknown_event" };
  return h(s, type === "settle_day" ? ev : payload);
}

export interface ReplayResult {
  state: SeasonState;
  notices: Notice[];
  /** Events that were refused, by index. Refused events leave the state unchanged. */
  refusals: { index: number; type: string; refusal: string; detail?: string }[];
}

export function replay(initial: SeasonState, events: readonly SeasonEvent[]): ReplayResult {
  let state = initial;
  const notices: Notice[] = [];
  const refusals: ReplayResult["refusals"] = [];
  events.forEach((ev, index) => {
    const r = applyEvent(state, ev);
    if (r.ok) {
      state = r.state;
      notices.push(...r.notices);
    } else refusals.push({ index, type: ev.type, refusal: r.refusal, detail: r.detail });
  });
  return { state, notices, refusals };
}
