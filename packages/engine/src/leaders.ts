/**
 * Team leader and deputy (PRD part 3 §5).
 * - Claim: first come, first served; one person holds at most one role.
 * - Transfer: the holder hands the role to another member, who confirms (the
 *   server keeps the pending request; this applies the confirmed transfer).
 * - Takeover: the deputy may take the leader role after the leader has not
 *   logged in for 3 days.
 * - If nobody claimed the leader role by the D1 noon publication, the system
 *   makes the highest-grade member leader (ties at random).
 * - The admin may set either role at any time.
 */

import type { SeasonParams } from "./params.js";
import type { Rng } from "./rng.js";
import { DAY, type Instant } from "./time.js";

export type Role = "leader" | "deputy";

export interface TeamRoles {
  leader: string | null;
  deputy: string | null;
}

export type RoleRefusal = "not_member" | "taken" | "holds_other_role" | "not_holder" | "same_person" | "not_deputy" | "leader_active";

const other = (r: Role): Role => (r === "leader" ? "deputy" : "leader");

export function claimRole(roles: TeamRoles, role: Role, childId: string, members: readonly string[]): TeamRoles | RoleRefusal {
  if (!members.includes(childId)) return "not_member";
  if (roles[role] !== null) return "taken";
  if (roles[other(role)] === childId) return "holds_other_role";
  return { ...roles, [role]: childId };
}

export function transferRole(
  roles: TeamRoles,
  role: Role,
  from: string,
  to: string,
  members: readonly string[],
): TeamRoles | RoleRefusal {
  if (roles[role] !== from) return "not_holder";
  if (from === to) return "same_person";
  if (!members.includes(to)) return "not_member";
  const next: TeamRoles = { ...roles, [role]: to };
  // Whoever receives a role gives up the other one; it becomes open to claim.
  if (next[other(role)] === to) next[other(role)] = null;
  return next;
}

export function canTakeOver(roles: TeamRoles, deputyId: string, leaderLastLoginAt: Instant, now: Instant, p: SeasonParams): boolean {
  return roles.deputy === deputyId && roles.leader !== null && now - leaderLastLoginAt >= p.team.leaderInactiveDays * DAY;
}

export function takeOver(roles: TeamRoles, deputyId: string, leaderLastLoginAt: Instant, now: Instant, p: SeasonParams): TeamRoles | RoleRefusal {
  if (roles.deputy !== deputyId) return "not_deputy";
  if (!canTakeOver(roles, deputyId, leaderLastLoginAt, now, p)) return "leader_active";
  return { leader: deputyId, deputy: null };
}

/** D1 noon: no leader yet → the highest-grade member becomes leader (a deputy who is picked moves up). */
export function systemAssignLeader(
  roles: TeamRoles,
  members: readonly { childId: string; grade: number }[],
  rng: Rng,
): TeamRoles {
  if (roles.leader !== null || members.length === 0) return roles;
  const top = Math.max(...members.map((m) => m.grade));
  const pick = rng.pick(members.filter((m) => m.grade === top).map((m) => m.childId).sort());
  return { leader: pick, deputy: roles.deputy === pick ? null : roles.deputy };
}

/** Admin override: set either role directly. */
export function adminSetRole(roles: TeamRoles, role: Role, childId: string | null): TeamRoles {
  const next: TeamRoles = { ...roles, [role]: childId };
  if (childId !== null && next[other(role)] === childId) next[other(role)] = null;
  return next;
}
