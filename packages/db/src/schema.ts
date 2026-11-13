/**
 * Database tables (PRD part 4). Phase 1: what the season runtime needs —
 * seasons, parameter versions, calendar, servers, teams, members, lands, the
 * engine event log and snapshots, planned events, the two ledgers, allocation
 * rounds, the feed and the operation log. Accounts, works and reviews follow.
 *
 * Conventions (part 4 §1): UUID keys; times in UTC (timestamptz); points in
 * hundredths and grain as integers; append-only tables are never updated.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);

// ---- season structure (part 4 §4) ------------------------------------------

export const seasons = pgTable("seasons", {
  id: id(),
  name: text("name").notNull(),
  /** draft → enrolling → grouped → running → big_battle → final_pending → ended → archived */
  status: text("status").notNull().default("draft"),
  /** D0, a Sunday (Beijing date). */
  openingDate: date("opening_date").notNull(),
  /** Seed for every random draw of the season (replayable). */
  seed: integer("seed").notNull(),
  currentParamVersion: integer("current_param_version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Every parameter change is a new version (part 4 §4). */
export const paramVersions = pgTable(
  "param_versions",
  {
    id: id(),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    version: integer("version").notNull(),
    params: jsonb("params").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [uniqueIndex("param_versions_season_version").on(t.seasonId, t.version)],
);

/** Shared calendar: school day or rest day (part 3 §1.1). */
export const calendarDays = pgTable("calendar_days", {
  day: date("day").primaryKey(),
  kind: text("kind").notNull(),
  source: text("source").notNull().default("admin"),
  note: text("note"),
});

export const servers = pgTable("servers", {
  id: id(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  name: text("name").notNull(),
});

export const teams = pgTable("teams", {
  id: id(),
  serverId: uuid("server_id").notNull().references(() => servers.id),
  name: text("name").notNull(),
  /** Admin-uploaded WeChat group QR code (part 4 v0.6). */
  qrImage: text("qr_image"),
  qrUploadedAt: ts("qr_uploaded_at"),
});

/** Season players (赛季玩家). childId refers to the child profile (accounts come in a later phase). */
export const teamMembers = pgTable(
  "team_members",
  {
    id: id(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    childId: text("child_id").notNull(),
    grade: integer("grade").notNull(),
    active: boolean("active").notNull().default(true),
    enabledBy: text("enabled_by"),
    enabledAt: ts("enabled_at").notNull().defaultNow(),
    paymentNote: text("payment_note"),
  },
  (t) => [uniqueIndex("team_members_team_child").on(t.teamId, t.childId)],
);

export const lands = pgTable("lands", {
  id: id(),
  serverId: uuid("server_id").notNull().references(() => servers.id),
  /** Engine id, e.g. "E1", "C2". */
  code: text("code").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  templateId: text("template_id"),
});

// ---- engine event log (part 2 §4.1–4.3) ------------------------------------

/**
 * Every engine event that changed the state, in order. Replaying them from
 * the initial state rebuilds the state exactly. Refused events are not stored
 * here (they changed nothing); the API reports the refusal to the caller.
 */
export const seasonEvents = pgTable(
  "season_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    /** Who caused it: "system", "admin:<id>", "child:<id>". */
    actor: text("actor").notNull(),
    paramVersion: integer("param_version").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("season_events_server_seq").on(t.serverId, t.seq)],
);

/** The initial state (seq 0) and periodic snapshots so loading does not replay everything. */
export const seasonSnapshots = pgTable(
  "season_snapshots",
  {
    id: serial("id").primaryKey(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    seq: integer("seq").notNull(),
    state: jsonb("state").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("season_snapshots_server_seq").on(t.serverId, t.seq)],
);

// ---- planned events (part 4 §5.1) -------------------------------------------

export const plannedEvents = pgTable(
  "planned_events",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    /** Idempotency key, unique per server, e.g. "settle_day:3". */
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    runAt: ts("run_at").notNull(),
    params: jsonb("params").notNull().default({}),
    /** pending → running → done | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    doneAt: ts("done_at"),
    /** Moves with pauses (false for the daily 24:00 settlement). */
    shiftable: boolean("shiftable").notNull().default(true),
  },
  (t) => [uniqueIndex("planned_events_server_key").on(t.serverId, t.key), index("planned_events_due").on(t.status, t.runAt)],
);

// ---- allocation rounds (part 4 §5.2) ------------------------------------------

export const allocationSubmissions = pgTable(
  "allocation_submissions",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    /** blind_auction | starter_items | center_round | rare_round */
    round: text("round").notNull(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    bid: integer("bid"),
    prefs: jsonb("prefs").notNull(),
    submittedBy: text("submitted_by").notNull(),
    submittedAt: ts("submitted_at").notNull(),
  },
  (t) => [uniqueIndex("allocation_submissions_round_team").on(t.serverId, t.round, t.teamId)],
);

// ---- ledgers (part 4 §7) --------------------------------------------------------

const ledgerColumns = () => ({
  /** Engine entry id, unique per server ("L17"). */
  entryId: text("entry_id").notNull(),
  serverId: uuid("server_id").notNull().references(() => servers.id),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  amount: integer("amount").notNull(),
  source: text("source").notNull(),
  refId: text("ref_id"),
  note: text("note"),
  at: ts("at").notNull(),
  reverses: text("reverses"),
  paramVersion: integer("param_version").notNull(),
  /** The event that wrote it. */
  eventSeq: integer("event_seq").notNull(),
});

export const grainLedger = pgTable("grain_ledger", { id: id(), ...ledgerColumns() }, (t) => [
  uniqueIndex("grain_ledger_entry").on(t.serverId, t.entryId),
  index("grain_ledger_team").on(t.teamId),
]);

/** Amounts in hundredths of a point. */
export const pointsLedger = pgTable("points_ledger", { id: id(), ...ledgerColumns() }, (t) => [
  uniqueIndex("points_ledger_entry").on(t.serverId, t.entryId),
  index("points_ledger_team").on(t.teamId),
]);

// ---- feed and logs (part 4 §9, §10) -------------------------------------------

/** Broadcasts, results for the report, team feed (engine notices). */
export const feed = pgTable(
  "feed",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    eventSeq: integer("event_seq").notNull(),
    kind: text("kind").notNull(),
    broadcast: boolean("broadcast").notNull(),
    data: jsonb("data").notNull(),
    at: ts("at").notNull(),
  },
  (t) => [index("feed_server_at").on(t.serverId, t.at)],
);

export const opLog = pgTable("op_log", {
  id: id(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  object: text("object"),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  at: ts("at").notNull().defaultNow(),
});
