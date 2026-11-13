import { describe, expect, it } from "vitest";
import { checkLedger, DEFAULT_PARAMS, DAY } from "../../src/index.js";
import { applyEvent, planSeason, replay, shiftForPauses, type SeasonEvent } from "../../src/season/index.js";
import { at, newSeason, OPENING, TEAMS, EDGE } from "./fixture.js";

describe("planned events (§3)", () => {
  const plan = planSeason(OPENING, DEFAULT_PARAMS);
  const find = (key: string) => plan.find((e) => e.key === key)!;

  it("follows the season calendar", () => {
    expect(find("publish_groups").at).toBe(at(0, 19));
    expect(find("assign_leaders").at).toBe(at(1, 12));
    expect(find("blind_auction").at).toBe(at(1, 21));
    expect(find("starter_items").at).toBe(at(2, 21));
    expect(find("supply_publish:1a").at).toBe(at(2, 19));
    expect(find("supply_deadline:1a").at).toBe(at(3, 21));
    expect(find("war_pairing:1").at).toBe(at(4, 19));
    expect(find("war_start:1").at).toBe(at(5, 7));
    expect(find("supply_publish:1b").at).toBe(at(6, 9)); // Saturday: rest day
    expect(find("war_deadline:1").at).toBe(at(7, 21));
    expect(find("participation_award:1").at).toBe(at(8, 0));
    expect(find("center_round").at).toBe(at(8, 21));
    expect(find("gift_deadline:2").at).toBe(at(12, 7));
    expect(plan.some((e) => e.key === "gift_deadline:1")).toBe(false);
    expect(find("shop_open").at).toBe(at(15, 7));
    expect(find("epic_close").at).toBe(at(16, 19));
    expect(find("shop_close").at).toBe(at(17, 21));
    expect(find("contests_close").at).toBe(at(25, 21));
    expect(find("form_big_battle").at).toBe(at(29, 12));
    expect(find("lines_publish").at).toBe(at(30, 7));
    expect(find("battle_deadline").at).toBe(at(33, 21));
    expect(plan.filter((e) => e.kind === "settle_day")).toHaveLength(33);
    expect(plan.filter((e) => e.kind === "war_pairing")).toHaveLength(4);
    expect(plan.filter((e) => e.kind === "participation_award")).toHaveLength(4);
    expect(new Set(plan.map((e) => e.key)).size).toBe(plan.length);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.at).toBeGreaterThanOrEqual(plan[i - 1]!.at);
  });

  it("uses rest-day times from the admin calendar (winter break)", () => {
    const winter = planSeason(OPENING, DEFAULT_PARAMS, { "2027-01-04": "rest" });
    expect(winter.find((e) => e.key === "assign_leaders")!.at).toBe(at(1, 14));
  });

  it("shifts later events by the paused time", () => {
    const pauses = [{ from: at(3, 10), until: at(4, 10) }];
    expect(shiftForPauses(at(5, 7), pauses, at(10, 0))).toBe(at(5, 7) + DAY);
    expect(shiftForPauses(at(3, 9), pauses, at(10, 0))).toBe(at(3, 9));
    expect(planSeason(OPENING, DEFAULT_PARAMS).find((e) => e.kind === "settle_day")!.shiftable).toBe(false);
  });
});

describe("applyEvent / replay", () => {
  it("dispatches by type and reports refusals without changing the state", () => {
    const s = newSeason();
    const r = applyEvent(s, { type: "settle_day", day: 0 });
    expect(r).toMatchObject({ ok: false, refusal: "out_of_season" });
    const events: SeasonEvent[] = [
      { type: "claim_role", teamId: "T1", role: "leader", childId: "T1-m1", at: at(0, 19) },
      { type: "blind_auction", at: at(1, 21), bids: TEAMS.map((teamId, i) => ({ teamId, bid: i * 3, prefs: [...EDGE], submittedAt: at(1, 9) })) },
      { type: "settle_day", day: 1 },
      { type: "settle_day", day: 1 },
      { type: "start_contest", contestId: "K1", teamId: "T1", landId: "E1", at: at(2, 10), by: "T1-m1" },
    ];
    const out = replay(s, events);
    expect(out.refusals.map((x) => [x.index, x.refusal])).toEqual([[3, "already_settled"]]);
    expect(out.state.lands.E8!.owner).toBe("T1");
    expect(out.state.teams.T1!.leader).toBe("T1-m1");
    expect(out.state.contests.K1!.defender).toBe("T8");
    expect(out.notices.some((n) => n.kind === "auction_result")).toBe(true);
    // same events → same state (deterministic)
    expect(JSON.stringify(replay(s, events).state)).toBe(JSON.stringify(out.state));
    expect(checkLedger(out.state.ledger)).toEqual([]);
  });
});
