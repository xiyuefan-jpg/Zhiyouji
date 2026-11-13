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

// ---- accounts and people (part 4 §2; part 8 §2.1, §3.1) ------------------------

/** One family account per parent phone number (student side logs in with it). */
export const families = pgTable("families", {
  id: id(),
  /** Mainland mobile number, 11 digits. */
  phone: text("phone").notNull().unique(),
  /** active | refused (parent pressed 不同意) | deleted */
  status: text("status").notNull().default("active"),
  /** Version of the three documents the parent last agreed to; null = not yet. */
  consentVersion: text("consent_version"),
  consentAt: ts("consent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** For the "2 years without login" clean-up (part 8 §4). */
  lastLoginAt: ts("last_login_at"),
});

/** Every agree / disagree the parent pressed (append-only). */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: id(),
    familyId: uuid("family_id").notNull().references(() => families.id),
    /** agree | disagree */
    choice: text("choice").notNull(),
    policyVersion: text("policy_version").notNull(),
    at: ts("at").notNull(),
  },
  (t) => [index("consent_records_family").on(t.familyId)],
);

/** The child is the subject of the data (daily tasks, journal, season player). */
export const children = pgTable(
  "children",
  {
    id: id(),
    familyId: uuid("family_id").notNull().references(() => families.id),
    nickname: text("nickname").notNull(),
    /** Preset avatar id (no photos of the child). */
    avatar: text("avatar").notNull().default("a1"),
    /** 1–9 = 一年级…初三, 10 = 高中. */
    grade: integer("grade").notNull(),
    /** voice | text */
    explainPref: text("explain_pref").notNull().default("voice"),
    /** active | deleted */
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("children_family").on(t.familyId)],
);

/** Grade history: the crossing score uses the grade on the day of the submission. */
export const gradeChanges = pgTable("grade_changes", {
  id: id(),
  childId: uuid("child_id").notNull().references(() => children.id),
  fromGrade: integer("from_grade"),
  toGrade: integer("to_grade").notNull(),
  /** auto | parent | admin | created */
  source: text("source").notNull(),
  at: ts("at").notNull(),
});

/** SMS login codes (only the hash is kept). */
export const loginCodes = pgTable(
  "login_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    ip: text("ip"),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: ts("used_at"),
  },
  (t) => [index("login_codes_phone").on(t.phone, t.createdAt)],
);

/** Login sessions of both sides; only the token hash is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    /** family | admin */
    kind: text("kind").notNull(),
    familyId: uuid("family_id").references(() => families.id),
    adminUserId: uuid("admin_user_id"),
    /** The child chosen on "我是谁" (family sessions). */
    childId: uuid("child_id").references(() => children.id),
    createdAt: ts("created_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("sessions_family").on(t.familyId)],
);

/** Admin console users: admins and reviewers (part 7 §0). */
export const adminUsers = pgTable("admin_users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  /** admin | reviewer */
  role: text("role").notNull(),
  passwordHash: text("password_hash"),
  /** Base32 TOTP secret (two-step verification). */
  totpSecret: text("totp_secret"),
  /** IANA zone for showing local time next to Beijing time. */
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  /** invited | active | disabled */
  status: text("status").notNull().default("invited"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  /** Last TOTP time step accepted (a code works once). */
  lastTotpStep: bigint("last_totp_step", { mode: "number" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastLoginAt: ts("last_login_at"),
});

/** One-time invitation links for new admin console users. */
export const adminInvites = pgTable("admin_invites", {
  id: id(),
  adminUserId: uuid("admin_user_id").notNull().references(() => adminUsers.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

// ---- message center and SMS (part 4 §9; part 8 §1) ------------------------------

/** In-site message center: every notification lands here. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    /** child | family | admin */
    recipientKind: text("recipient_kind").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    serverId: uuid("server_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Where tapping the message goes in the site, e.g. "/contest/K12". */
    link: text("link"),
    /** Same notification never stored twice (e.g. "attacked:K12"). */
    dedupeKey: text("dedupe_key"),
    createdAt: ts("created_at").notNull(),
    readAt: ts("read_at"),
  },
  (t) => [
    index("messages_recipient").on(t.recipientKind, t.recipientId, t.createdAt),
    uniqueIndex("messages_dedupe").on(t.recipientKind, t.recipientId, t.dedupeKey),
  ],
);

/** Outgoing SMS (login codes are sent directly; reminders go through here). */
export const smsOutbox = pgTable(
  "sms_outbox",
  {
    id: id(),
    phone: text("phone").notNull(),
    /** Reminder kind = template, e.g. "attacked". */
    kind: text("kind").notNull(),
    params: jsonb("params").notNull().default({}),
    /** Same reminder to the same phone is merged (e.g. two children in the attacked team). */
    mergeKey: text("merge_key").notNull(),
    /** Not before (quiet hours push it to 07:00 Beijing). */
    sendAfter: ts("send_after").notNull(),
    /** pending | sent | failed | dropped (over the daily cap) */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    providerId: text("provider_id"),
    createdAt: ts("created_at").notNull(),
    sentAt: ts("sent_at"),
  },
  (t) => [uniqueIndex("sms_outbox_merge").on(t.phone, t.mergeKey), index("sms_outbox_due").on(t.status, t.sendAfter)],
);

// ---- view log (part 4 §10; part 8 §3.1) ------------------------------------------

/** Every time an admin console user views or downloads a child's data (append-only). */
export const viewLog = pgTable(
  "view_log",
  {
    id: id(),
    adminUserId: uuid("admin_user_id").notNull(),
    childId: uuid("child_id"),
    /** work | recording | daily_task | survey | child_profile … */
    contentKind: text("content_kind").notNull(),
    objectId: text("object_id"),
    /** view | download */
    action: text("action").notNull(),
    at: ts("at").notNull(),
  },
  (t) => [index("view_log_admin").on(t.adminUserId, t.at), index("view_log_child").on(t.childId, t.at)],
);
