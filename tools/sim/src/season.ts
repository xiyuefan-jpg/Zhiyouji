/**
 * Bot teams play a whole season through the rules engine (PRD part 9 §2).
 *
 * Every step goes through `applyEvent`, in time order, following the planned
 * events from `planSeason`. Bots submit bids, preferences, daily tasks,
 * supply tasks, war and contest works (scores drawn from each team's skill),
 * start and join contests, buy land and items and use every kind of item.
 * The run is fully determined by the seed.
 */

import {
  DEFAULT_PARAMS,
  activeContestOnLand,
  applyEvent,
  checkInvariants,
  checkLedger,
  createRng,
  createSeasonState,
  dateOfSeasonDay,
  beijingInstant,
  grainOf,
  itemDef,
  landsOf,
  linesPublishedAt,
  planSeason,
  pointsOf,
  quoteAttack,
  rankingAt,
  seasonDayOf,
  spendableGrain,
  standardLands,
  type Notice,
  type PlannedEvent,
  type Rng,
  type SeasonEvent,
  type SeasonParams,
  type SeasonState,
} from "@zhiyouji/engine";

export interface BotTeam {
  id: string;
  /** Mean work score, 0–100. */
  skill: number;
  /** Chance a member does the daily task on a given day. */
  effort: number;
  /** How often the team attacks. */
  aggression: number;
}

export interface SimOptions {
  seed: number;
  params?: SeasonParams;
  /** Sunday, Beijing date. */
  opening?: string;
  teams?: number;
  membersPerTeam?: number;
  poolYuan?: number;
  promptsPerLand?: number;
}

export interface SimResult {
  /** The state before the first event: replaying `events` on it must give `state`. */
  initial: SeasonState;
  state: SeasonState;
  bots: BotTeam[];
  events: SeasonEvent[];
  notices: Notice[];
  refusals: { type: string; refusal: string; at: number }[];
  stats: {
    contests: number;
    captures: number;
    defended: number;
    nothing: number;
    cancelled: number;
    itemsUsed: number;
    dailyTasks: number;
  };
  ledgerProblems: string[];
  /** Structural invariants broken after some event (checked after every accepted event; empty when sound). */
  invariantProblems: { at: number; type: string; problems: string[] }[];
}

interface Step {
  at: number;
  seq: number;
  run: (s: SeasonState) => SeasonEvent[];
}

const HOUR = 3_600_000;
const MIN = 60_000;

export function simulateSeason(o: SimOptions): SimResult {
  const p = o.params ?? DEFAULT_PARAMS;
  const opening = o.opening ?? "2027-01-03";
  const nTeams = o.teams ?? 8;
  const nMembers = o.membersPerTeam ?? 8;
  const rng = createRng(o.seed ^ 0x5eed);
  const bots: BotTeam[] = Array.from({ length: nTeams }, (_, i) => ({
    id: `T${i + 1}`,
    skill: 50 + rng.next() * 35,
    effort: 0.3 + rng.next() * 0.6,
    aggression: 0.2 + rng.next() * 0.8,
  }));
  const bot = new Map(bots.map((b) => [b.id, b]));
  const lands = standardLands(nTeams);
  let state = createSeasonState({
    seasonId: `sim-${o.seed}`,
    seed: o.seed,
    opening,
    params: p,
    teams: bots.map((b, i) => ({
      id: b.id,
      name: `组${i + 1}`,
      members: Array.from({ length: nMembers }, (_, j) => ({ childId: `${b.id}-m${j + 1}`, grade: 2 + Math.floor(rng.next() * 8) })),
    })),
    lands,
    prompts: Object.fromEntries(lands.map((l) => [l.id, Array.from({ length: o.promptsPerLand ?? 8 }, (_, i) => `${l.id}-q${i + 1}`)])),
    at: beijingInstant(opening, 19),
  });

  const initial = state;
  const at = (d: number, h: number, m = 0) => beijingInstant(dateOfSeasonDay(opening, d), h, m);
  const day = (t: number) => seasonDayOf(opening, t);
  const score = (teamId: string, submitProb: number): number | null =>
    rng.next() < submitProb ? Math.max(0, Math.min(100, Math.round(normal(rng, bot.get(teamId)!.skill, 12)))) : null;

  const queue: Step[] = [];
  let seq = 0;
  /** Keep the queue sorted by time, then insertion order. */
  const push = (t: number, run: Step["run"]) => {
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (queue[mid]!.at <= t) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, { at: t, seq: seq++, run });
  };
  const events: SeasonEvent[] = [];
  const notices: Notice[] = [];
  const refusals: SimResult["refusals"] = [];
  const stats = { contests: 0, captures: 0, defended: 0, nothing: 0, cancelled: 0, itemsUsed: 0, dailyTasks: 0 };
  const leaderOf = (s: SeasonState, t: string) => s.teams[t]!.leader ?? s.teams[t]!.deputy ?? undefined;

  // ---- planned events -----------------------------------------------------
  for (const row of planSeason(opening, p)) push(row.at, (s) => planned(s, row));

  function planned(s: SeasonState, row: PlannedEvent): SeasonEvent[] {
    switch (row.kind) {
      case "publish_groups":
        for (const b of bots)
          if (rng.next() < 0.75) {
            push(row.at + 5 * MIN, () => [{ type: "claim_role", teamId: b.id, role: "leader", childId: `${b.id}-m1`, at: row.at + 5 * MIN }]);
            push(row.at + 6 * MIN, () => [{ type: "claim_role", teamId: b.id, role: "deputy", childId: `${b.id}-m2`, at: row.at + 6 * MIN }]);
          }
        return [];
      case "assign_leaders":
        return [{ type: "assign_leaders", at: row.at }];
      case "blind_auction":
        return [
          {
            type: "blind_auction",
            at: row.at,
            bids: bots
              .filter(() => rng.next() < 0.9)
              .map((b, i) => ({
                teamId: b.id,
                bid: Math.floor(rng.next() * Math.min(40, grainOf(s, b.id))),
                prefs: rng.shuffle(s.landOrder.filter((l) => s.lands[l]!.kind === "edge")),
                submittedAt: row.at - (i + 1) * HOUR,
              })),
          },
        ];
      case "starter_items":
        return [{ type: "starter_items", at: row.at, prefs: Object.fromEntries(bots.map((b) => [b.id, rng.shuffle(["huanhun", "yujing", "jianbi", "bihuo", "taixu"])])) }];
      case "supply_deadline":
        push(row.at + HOUR, (s2) => [
          {
            type: "settle_supply",
            supplyId: String(row.data.supplyId),
            at: row.at + HOUR,
            results: bots.map((b) => {
              const active = s2.teams[b.id]!.members.filter((m) => m.active).length;
              const submitted = Math.round(active * Math.min(1, b.effort + rng.next() * 0.3));
              return { teamId: b.id, submittedMembers: submitted, quality: (b.skill / 100) * 40, summary: rng.next() < 0.8 ? 15 : 0 };
            }),
          },
        ]);
        return [];
      case "war_pairing": {
        const week = Number(row.data.week);
        for (const b of bots)
          push(row.at + HOUR, (s2) => {
            const out: SeasonEvent[] = [];
            for (const it of ["yujing", "danao"] as const)
              if (s2.teams[b.id]!.items.some((i) => i.itemId === it) && rng.next() < 0.6)
                out.push({ type: "use_item", teamId: b.id, itemId: it, at: row.at + HOUR, by: leaderOf(s2, b.id), week });
            return out;
          });
        return [{ type: "pair_war", week, at: row.at }];
      }
      case "war_deadline": {
        const week = Number(row.data.week);
        const settleAt = row.at + 15 * HOUR;
        push(settleAt, () => [{ type: "settle_war", week, at: settleAt, scores: Object.fromEntries(bots.map((b) => [b.id, score(b.id, 0.9)])) }]);
        return [];
      }
      case "participation_award":
        return [{ type: "participation_award", week: Number(row.data.week), at: row.at }];
      case "center_round":
        return [
          {
            type: "center_round",
            at: row.at,
            requests: bots
              .filter((b) => spendableGrain(s, b.id) >= p.centerLand.price && rng.next() < 0.7)
              .map((b) => ({ teamId: b.id, prefs: rng.shuffle(s.landOrder.filter((l) => s.lands[l]!.kind === "center")) })),
          },
        ];
      case "shop_open":
        for (const b of bots)
          push(row.at + 2 * HOUR, (s2) => {
            const kinds = rng.shuffle(["huanhun", "yujing", "jianbi", "bihuo", "taixu", "zhencha"]).slice(0, 1 + rng.int(2));
            return kinds.map((itemId) => ({ type: "buy_shop_item", teamId: b.id, itemId, at: row.at + 2 * HOUR, by: leaderOf(s2, b.id) }));
          });
        return [];
      case "rare_round": {
        const rares = ["dianhua", "shengsi", "fatian", "danao", "jiuzhuan", "xiuli", "sanmei", "zijin", "zhaoyao", "beishui", "jiancheng", "qiankun"];
        for (const b of bots)
          push(row.at + 3 * HOUR, (s2) =>
            rng.next() < 0.4 ? [{ type: "buy_shop_item", teamId: b.id, itemId: rng.pick(rares), at: row.at + 3 * HOUR, by: leaderOf(s2, b.id) }] : [],
          );
        return [{ type: "rare_round", at: row.at, prefs: Object.fromEntries(bots.map((b) => [b.id, rng.shuffle(rares).slice(0, 3)])) }];
      }
      case "epic_open": {
        for (const offset of [1, 8, 20, 23.95])
          push(row.at + offset * HOUR, (s2) => {
            const out: SeasonEvent[] = [];
            for (const b of rng.shuffle(bots)) {
              const open = s2.shop.auctions.filter((a) => !a.closed);
              if (open.length === 0 || rng.next() > 0.35) continue;
              const a = rng.pick(open);
              const lead = a.bids[a.bids.length - 1];
              const amount = lead ? lead.amount + p.items.epicIncrement * (1 + rng.int(3)) : p.items.epicStartPrice;
              out.push({ type: "bid_epic", teamId: b.id, itemId: a.itemId, amount, at: row.at + offset * HOUR, by: leaderOf(s2, b.id) });
              break;
            }
            return out;
          });
        return [{ type: "open_epic_auctions", at: row.at }];
      }
      case "epic_close":
        closeAuctions(row.at);
        return [];
      case "form_big_battle":
        push(row.at + HOUR, (s2) => {
          const bb = s2.bigBattle;
          if (!bb) return [];
          return (["a", "b"] as const)
            .filter(() => rng.next() < 0.85)
            .map((camp) => ({ type: "submit_lines", teamId: bb.camps[camp][0]!, lines: rng.shuffle(bb.camps[camp]), at: row.at + HOUR }));
        });
        push(row.at + 2 * HOUR, (s2) => battleItems(s2, row.at + 2 * HOUR, ["zhencha", "beishui", "jiancheng", "qiankun"]));
        return [{ type: "form_big_battle", at: row.at }];
      case "lines_deadline":
        push(linesPublishedAt(s) + HOUR, (s2) => battleItems(s2, linesPublishedAt(s2) + HOUR, ["diaobing"]));
        return [{ type: "lock_lines", at: row.at }];
      case "battle_deadline": {
        const settleAt = row.at + 36 * HOUR;
        push(settleAt, () => [
          {
            type: "settle_big_battle",
            at: settleAt,
            lineScores: Object.fromEntries(bots.map((b) => [b.id, score(b.id, 0.9)])),
            mainScores: { a: Math.round(normal(rng, 70, 10)), b: Math.round(normal(rng, 70, 10)) },
          },
        ]);
        push(settleAt + 12 * HOUR, () => [{ type: "finalize", at: settleAt + 12 * HOUR, poolYuan: o.poolYuan ?? 10000 }]);
        return [];
      }
      case "settle_day":
        return [{ type: "settle_day", day: Number(row.data.day) }];
      default:
        return [];
    }
  }

  function closeAuctions(t: number): void {
    push(t, (s) => {
      const out: SeasonEvent[] = [];
      for (const a of s.shop.auctions) {
        if (a.closed) continue;
        if (a.endAt <= t) out.push({ type: "close_epic_auction", itemId: a.itemId, at: t });
        else closeAuctions(a.endAt);
      }
      return out;
    });
  }

  function battleItems(s: SeasonState, t: number, kinds: string[]): SeasonEvent[] {
    const out: SeasonEvent[] = [];
    for (const b of bots)
      for (const it of s.teams[b.id]!.items) {
        if (!kinds.includes(it.itemId)) continue;
        const line = s.bigBattle?.final ? rng.int(s.bigBattle.lineValues.length) : undefined;
        out.push({ type: "use_battle_item", teamId: b.id, itemId: it.itemId as "zhencha", at: t, by: leaderOf(s, b.id), line });
      }
    return out;
  }

  // ---- daily bot behaviour ------------------------------------------------
  for (let d = 0; d <= p.time.seasonDays; d++) {
    for (const b of bots)
      for (let m = 1; m <= nMembers; m++) {
        const n = rng.next() < b.effort ? (rng.next() < 0.5 ? 1 : 3) : 0;
        for (let k = 0; k < n; k++) {
          const sub = at(d, 17, m * 5 + k);
          push(sub + 90 * MIN, () => [{ type: "daily_task_passed", taskId: `${b.id}-m${m}-d${d}-${k}`, childId: `${b.id}-m${m}`, submittedAt: sub, at: sub + 90 * MIN }]);
        }
      }
    if (d >= 2 && d <= p.contest.lastInitiationDay) push(at(d, 10), (s) => attacks(s, at(d, 10)));
    if (d >= 2 && d <= p.contest.lastInitiationDay) push(at(d, 13), (s) => joins(s, at(d, 13)));
    if (d > p.centerLand.openDay) push(at(d, 12), (s) => centerBuys(s, at(d, 12)));
    if (d >= 2) push(at(d, 11), (s) => itemUses(s, at(d, 11)));
  }

  function attacks(s: SeasonState, t: number): SeasonEvent[] {
    const out: SeasonEvent[] = [];
    let n = Object.keys(s.contests).length;
    for (const b of rng.shuffle(bots)) {
      if (rng.next() > b.aggression * 0.35) continue;
      const targets = s.landOrder.filter((l) => {
        const owner = s.lands[l]!.owner;
        return owner !== null && owner !== b.id && !activeContestOnLand(s, l) && !out.some((e) => e.type === "start_contest" && e.landId === l);
      });
      if (targets.length === 0) continue;
      const landId = rng.pick(targets);
      const owner = s.lands[landId]!.owner!;
      if (spendableGrain(s, b.id) < quoteAttack(s, b.id, owner, t).cost + 15) continue;
      const contestId = `K${++n}`;
      out.push({ type: "start_contest", contestId, teamId: b.id, landId, at: t, by: leaderOf(s, b.id) });
      // defender may answer with 袖里乾坤
      push(t + 2 * HOUR, (s2) =>
        s2.teams[owner]!.items.some((i) => i.itemId === "xiuli") && rng.next() < 0.5
          ? [{ type: "use_item", teamId: owner, itemId: "xiuli", contestId, at: t + 2 * HOUR, by: leaderOf(s2, owner) }]
          : [],
      );
      const settle = (s2: SeasonState): SeasonEvent[] => {
        const c = s2.contests[contestId];
        if (!c || c.status !== "active") return [];
        const at2 = c.deadline + 15 * HOUR;
        const scores: Record<string, number | null> = { [c.defender]: score(c.defender, 0.85) };
        for (const a of c.attackers) scores[a.teamId] = score(a.teamId, 0.95);
        return [{ type: "settle_contest", contestId, at: at2, scores }];
      };
      // the deadline is day 3 21:00; settle 15 hours later
      push(t + 4 * 24 * HOUR, settle);
    }
    return out;
  }

  function joins(s: SeasonState, t: number): SeasonEvent[] {
    const out: SeasonEvent[] = [];
    for (const id of s.contestOrder) {
      const c = s.contests[id]!;
      if (c.status !== "active" || t >= c.joinDeadline) continue;
      for (const b of bots) {
        if (b.id === c.defender || c.attackers.some((a) => a.teamId === b.id)) continue;
        if (rng.next() > 0.08) continue;
        if (spendableGrain(s, b.id) < quoteAttack(s, b.id, c.defender, t).cost + 15) continue;
        out.push({ type: "join_contest", contestId: id, teamId: b.id, at: t, by: leaderOf(s, b.id) });
      }
    }
    return out;
  }

  function centerBuys(s: SeasonState, t: number): SeasonEvent[] {
    const unsold = s.landOrder.filter((l) => s.lands[l]!.kind === "center" && s.lands[l]!.owner === null);
    if (unsold.length === 0) return [];
    const b = rng.pick(bots);
    if (rng.next() > 0.3 || spendableGrain(s, b.id) < 60) return [];
    return [{ type: "buy_center_land", teamId: b.id, landId: rng.pick(unsold), at: t, by: leaderOf(s, b.id) }];
  }

  function itemUses(s: SeasonState, t: number): SeasonEvent[] {
    const out: SeasonEvent[] = [];
    const ranking = rankingAt(s, t);
    const d = day(t);
    for (const b of bots) {
      const by = leaderOf(s, b.id);
      const mine = landsOf(s, b.id);
      for (const it of s.teams[b.id]!.items) {
        const def = itemDef(it.itemId);
        if (def.passive || def.bigBattle || it.itemId === "yujing" || it.itemId === "danao" || it.itemId === "xiuli") continue;
        if (rng.next() > 0.3) continue;
        const top = ranking.find((r) => r.teamId !== b.id && (it.itemId !== "sanmei" || landsOf(s, r.teamId).length > 0))?.teamId;
        const base = { type: "use_item" as const, teamId: b.id, itemId: it.itemId, uid: it.uid, at: t, by };
        switch (it.itemId) {
          case "zijin":
          case "sanmei":
          case "taixu":
            if (top) out.push({ ...base, targetTeamId: top });
            break;
          case "shengsi":
            if (mine.length >= 2) out.push({ ...base, landId: mine[mine.length - 1]!.id });
            break;
          case "bagua":
            if (mine.length > 0 && d < p.time.bigBattleStartDay) out.push({ ...base, landId: mine[0]!.id });
            break;
          case "fatian":
            if (mine.length >= p.items.fatian.minLands) out.push(base);
            break;
          default:
            out.push(base);
        }
        break; // at most one item per team per day
      }
    }
    return out;
  }

  // ---- run ----------------------------------------------------------------
  const invariantProblems: SimResult["invariantProblems"] = [];
  while (queue.length > 0) {
    const step = queue.shift()!;
    for (const ev of step.run(state)) {
      events.push(ev);
      const r = applyEvent(state, ev);
      if (!r.ok) {
        refusals.push({ type: ev.type, refusal: r.refusal, at: step.at });
        continue;
      }
      state = r.state;
      const broken = checkInvariants(state);
      if (broken.length > 0) invariantProblems.push({ at: step.at, type: ev.type, problems: broken });
      for (const n of r.notices) {
        notices.push(n);
        if (n.kind === "contest_started") stats.contests++;
        else if (n.kind === "contest_captured") stats.captures++;
        else if (n.kind === "contest_defended") stats.defended++;
        else if (n.kind === "contest_nothing") stats.nothing++;
        else if (n.kind === "contest_cancelled") stats.cancelled++;
        else if (n.kind === "item_used") stats.itemsUsed++;
        else if (n.kind === "daily_task_counted") stats.dailyTasks++;
      }
    }
  }
  return { initial, state, bots, events, notices, refusals, stats, ledgerProblems: checkLedger(state.ledger), invariantProblems };
}

function normal(rng: Rng, mean: number, sd: number): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Final table: team, points (as shown), grain, lands, scholarship. */
export function summary(r: SimResult): { teamId: string; rank: number; points: number; grain: number; lands: number; yuan: number }[] {
  const s = r.state;
  const yuan = new Map((s.final?.scholarship ?? []).map((x) => [x.teamId, x.yuan]));
  return (s.final?.ranking ?? rankingAt(s, 0)).map((x) => ({
    teamId: x.teamId,
    rank: x.rank,
    points: pointsOf(s, x.teamId) / 100,
    grain: grainOf(s, x.teamId),
    lands: landsOf(s, x.teamId).length,
    yuan: yuan.get(x.teamId) ?? 0,
  }));
}

