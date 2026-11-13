import { DEFAULT_PARAMS, beijingInstant, dateOfSeasonDay, type SeasonParams } from "../../src/index.js";
import { createSeasonState, type SeasonState, type Result } from "../../src/season/index.js";

export const OPENING = "2027-01-03"; // a Sunday

export const TEAMS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];
export const EDGE = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"];
export const CENTER = ["C1", "C2", "C3", "C4"];

/** Beijing wall-clock time on season day d. */
export function at(d: number, hour: number, minute = 0): number {
  return beijingInstant(dateOfSeasonDay(OPENING, d), hour, minute);
}

export function newSeason(params: SeasonParams = DEFAULT_PARAMS, prompts = 5): SeasonState {
  return createSeasonState({
    seasonId: "S3",
    seed: 42,
    opening: OPENING,
    params,
    teams: TEAMS.map((id, i) => ({
      id,
      name: `组${i + 1}`,
      members: Array.from({ length: 8 }, (_, j) => ({ childId: `${id}-m${j + 1}`, grade: 3 + (j % 7) })),
    })),
    lands: [...EDGE.map((id) => ({ id, kind: "edge" as const })), ...CENTER.map((id) => ({ id, kind: "center" as const }))],
    prompts: Object.fromEntries([...EDGE, ...CENTER].map((l) => [l, Array.from({ length: prompts }, (_, i) => `${l}-q${i + 1}`)])),
    at: at(0, 19),
  });
}

/** Test shortcut: give lands to teams directly (T1 → E1, …). */
export function withOwners(s: SeasonState, owners: Record<string, string>): SeasonState {
  for (const [landId, teamId] of Object.entries(owners)) {
    const l = s.lands[landId]!;
    l.owner = teamId;
    l.ownedSince = at(1, 21);
  }
  return s;
}

export function ok<R extends string>(r: Result<R>): SeasonState {
  if (!r.ok) throw new Error(`refused: ${r.refusal} ${r.detail ?? ""}`);
  return r.state;
}

export const defaultOwners = Object.fromEntries(EDGE.map((l, i) => [l, TEAMS[i]!]));
