/**
 * Structural invariants of a season state (PRD part 9 §2 "不变量").
 *
 * `checkInvariants` returns a list of human-readable problems; an empty list
 * means the state is sound. It is pure and cheap enough to run after every
 * event in bot seasons and server tests.
 *
 * Checked:
 * - every land has at most one owner, the owner is a known team, and
 *   `ownedSince` is set exactly when there is an owner;
 * - every land has at most one active contest; an active contest's defender
 *   owns the land, and no attacker is the defender or appears twice;
 * - no team's grain balance is negative, and frozen grain never exceeds it;
 * - leader and deputy are distinct active members of their own team;
 * - item copies have unique ids across the server.
 */
import { checkLedger } from "../ledger.js";
import { frozenGrain, grainOf, type SeasonState } from "./state.js";

export function checkInvariants(s: SeasonState, o: { ledger?: boolean } = {}): string[] {
  const out: string[] = [];

  for (const id of s.landOrder) {
    const l = s.lands[id];
    if (!l) {
      out.push(`land ${id} listed but missing`);
      continue;
    }
    if (l.owner !== null && !s.teams[l.owner]) out.push(`land ${id} owned by unknown team ${l.owner}`);
    if ((l.owner === null) !== (l.ownedSince === null)) out.push(`land ${id}: owner and ownedSince disagree`);
  }

  const activeOn = new Map<string, string>();
  for (const cid of s.contestOrder) {
    const c = s.contests[cid];
    if (!c) {
      out.push(`contest ${cid} listed but missing`);
      continue;
    }
    if (c.status !== "active") continue;
    const prev = activeOn.get(c.landId);
    if (prev) out.push(`land ${c.landId} has two active contests (${prev}, ${c.id})`);
    else activeOn.set(c.landId, c.id);
    const land = s.lands[c.landId];
    if (!land) out.push(`contest ${c.id} on unknown land ${c.landId}`);
    else if (land.owner !== c.defender) out.push(`contest ${c.id}: defender ${c.defender} does not own ${c.landId} (${land.owner})`);
    const seen = new Set<string>();
    for (const a of c.attackers) {
      if (a.teamId === c.defender) out.push(`contest ${c.id}: defender ${a.teamId} is also an attacker`);
      if (seen.has(a.teamId)) out.push(`contest ${c.id}: attacker ${a.teamId} twice`);
      seen.add(a.teamId);
    }
  }

  const uids = new Set<string>();
  for (const tid of s.teamOrder) {
    const t = s.teams[tid];
    if (!t) {
      out.push(`team ${tid} listed but missing`);
      continue;
    }
    const grain = grainOf(s, tid);
    if (grain < 0) out.push(`team ${tid}: grain ${grain} < 0`);
    const frozen = frozenGrain(s, tid);
    if (frozen > grain) out.push(`team ${tid}: frozen grain ${frozen} > balance ${grain}`);
    const active = new Set(t.members.filter((m) => m.active).map((m) => m.childId));
    if (t.leader !== null && !active.has(t.leader)) out.push(`team ${tid}: leader ${t.leader} is not an active member`);
    if (t.deputy !== null && !active.has(t.deputy)) out.push(`team ${tid}: deputy ${t.deputy} is not an active member`);
    if (t.leader !== null && t.leader === t.deputy) out.push(`team ${tid}: ${t.leader} is both leader and deputy`);
    for (const h of t.items) {
      if (uids.has(h.uid)) out.push(`item copy ${h.uid} held twice`);
      uids.add(h.uid);
    }
  }

  if (o.ledger) out.push(...checkLedger(s.ledger));
  return out;
}
