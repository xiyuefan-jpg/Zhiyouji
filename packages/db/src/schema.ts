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
  /**
   * Draft grouping (part 3 §4) between "生成分组" and "确认": servers → teams →
   * child ids, plus the team names. Kept after confirmation for reference.
   */
  grouping: jsonb("grouping"),
  /** Set when the admin confirms the grouping: servers, teams and the engine state exist from then on. */
  groupingLockedAt: ts("grouping_locked_at"),
  /** Enabled question-bank prompts per land code, passed to the engine at confirmation. */
  prompts: jsonb("prompts"),
});

/**
 * Season players (赛季玩家, part 4 §4): a child enabled for a season after
 * paying outside the app. Before grouping only `status` matters; the team
 * placement lives in `team_members` once the grouping is confirmed.
 */
export const seasonPlayers = pgTable(
  "season_players",
  {
    id: id(),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    childId: uuid("child_id").notNull().references(() => children.id),
    /** enrolled | revoked (admin undid the enabling before grouping) | withdrawn (left during the season) */
    status: text("status").notNull().default("enrolled"),
    enabledBy: text("enabled_by").notNull(),
    enabledAt: ts("enabled_at").notNull(),
    /** Order number or amount, for reconciling with the payment outside the app. */
    paymentNote: text("payment_note"),
    revokedBy: text("revoked_by"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("season_players_season_child").on(t.seasonId, t.childId), index("season_players_child").on(t.childId)],
);

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
  /** Admins were reminded that the QR code expires (WeChat group codes last 7 days). */
  qrRemindedAt: ts("qr_reminded_at"),
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
    /** Admin hid this line from the report (part 7 §8 战报预览); the row itself stays. */
    hiddenAt: ts("hidden_at"),
    hiddenBy: text("hidden_by"),
  },
  (t) => [index("feed_server_at").on(t.serverId, t.at)],
);

/** 战报 (part 4 §9): one per publication time; the lines are the feed rows in (fromAt, publishAt]. */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    fromAt: ts("from_at").notNull(),
    publishAt: ts("publish_at").notNull(),
    /** Ranking at the publication time: [{ teamId, rank, points }]. */
    ranking: jsonb("ranking").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("reports_server_publish").on(t.serverId, t.publishAt)],
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
  /** When the parent was told by SMS that the account will be deleted in 30 days. */
  inactiveNoticeAt: ts("inactive_notice_at"),
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
    /**
     * Keyed hash (HMAC-SHA256 with the server secret) of the parent phone that agreed (part 8 §2.1
     * "记录同意的手机号、时间、文件版本"): still proves who agreed after the account is deleted,
     * without keeping the number itself.
     */
    phoneHash: text("phone_hash"),
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
    /** Last request made as this child (leader take-over after 3 days away, part 3 §5). */
    lastActiveAt: ts("last_active_at"),
    /** 新手引导 seen or skipped (part 5 A5): kept on the account, so a new phone or browser does not show it again. */
    guideSeenAt: ts("guide_seen_at"),
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

/**
 * Emails to admins and reviewers (PRD part 8 §1.1–§1.2 "管理端 + 邮件"): only
 * the kinds that need someone soon. The text says what happened and links to
 * the console; it never carries a child's data (the readers may be abroad,
 * part 8 §2.2).
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    adminUserId: uuid("admin_user_id").notNull(),
    to: text("to").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    /** pending | sent | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    sendAfter: ts("send_after").notNull(),
    createdAt: ts("created_at").notNull(),
    sentAt: ts("sent_at"),
  },
  (t) => [uniqueIndex("email_outbox_dedupe").on(t.adminUserId, t.dedupeKey), index("email_outbox_due").on(t.status, t.sendAfter)],
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

// ---- season play (part 3 §5; part 4 §4) --------------------------------------------

/**
 * Leader / deputy hand-overs waiting for the receiver to accept (part 3 §5:
 * "对方确认后生效"). The change itself is an engine event once accepted.
 */
export const roleTransfers = pgTable(
  "role_transfers",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    /** leader | deputy */
    role: text("role").notNull(),
    fromChild: uuid("from_child").notNull(),
    toChild: uuid("to_child").notNull(),
    /** pending | accepted | declined | cancelled | failed */
    status: text("status").notNull().default("pending"),
    createdAt: ts("created_at").notNull(),
    decidedAt: ts("decided_at"),
  },
  (t) => [index("role_transfers_team").on(t.teamId, t.status)],
);

// ---- works and scoring (part 4 §6) -----------------------------------------------------

/**
 * Uploaded files. The website asks for an upload ticket, sends the bytes
 * straight to object storage (OSS; a local fake in development), then
 * confirms. Originals are kept while the child's account exists.
 */
export const files = pgTable(
  "files",
  {
    id: id(),
    /** Who owns it: the team's work materials or a child's daily task. */
    serverId: uuid("server_id").references(() => servers.id),
    teamId: uuid("team_id").references(() => teams.id),
    childId: uuid("child_id").notNull(),
    /** video | audio | image | pdf */
    kind: text("kind").notNull(),
    contentType: text("content_type").notNull(),
    filename: text("filename"),
    /** Size the website announced; checked against storage on completion. */
    size: bigint("size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    /** Big files go up in parts that can resume after a break (PRD part 2 §4.5, part 5 §5): the storage's multipart upload id. */
    multipartId: text("multipart_id"),
    /** Bytes per part of a multipart upload (the last part may be shorter). */
    partSize: integer("part_size"),
    /** uploading | uploaded | processed | failed */
    status: text("status").notNull().default("uploading"),
    durationSec: integer("duration_sec"),
    /** Speech-to-text of audio and video, or the text of a PDF (PRD part 6 T1, T3). */
    transcript: text("transcript"),
    /** Storage keys of key frames taken from a video (part 6 T2). */
    frames: jsonb("frames").notNull().default([]),
    processAttempts: integer("process_attempts").notNull().default(0),
    processError: text("process_error"),
    processedAt: ts("processed_at"),
    createdAt: ts("created_at").notNull(),
    uploadedAt: ts("uploaded_at"),
  },
  (t) => [index("files_team").on(t.teamId), index("files_status").on(t.status)],
);

/** 素材箱 (part 5 §3.3): what any team member puts in for one work slot, files or text. */
export const materials = pgTable(
  "materials",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    /** The work slot, e.g. "contest:K1a2b", "war:2", "line", "main". */
    slot: text("slot").notNull(),
    fileId: uuid("file_id").references(() => files.id),
    text: text("text"),
    addedBy: uuid("added_by").notNull(),
    createdAt: ts("created_at").notNull(),
    removedAt: ts("removed_at"),
  },
  (t) => [index("materials_slot").on(t.serverId, t.teamId, t.slot)],
);

/**
 * A submitted work: every submission before the deadline is a new version;
 * the last one counts (part 3 §10.3).
 */
export const works = pgTable(
  "works",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    /** contest | war | line | main (big battle main field) | supply_member | supply_summary */
    kind: text("kind").notNull(),
    /** The work slot (see materials.slot). */
    slot: text("slot").notNull(),
    /** Prompt the work answers (question bank id). */
    promptId: text("prompt_id"),
    version: integer("version").notNull(),
    submittedBy: uuid("submitted_by").notNull(),
    submittedAt: ts("submitted_at").notNull(),
    /** video | audio | images | text */
    mediaKind: text("media_kind").notNull(),
    fileIds: jsonb("file_ids").notNull().default([]),
    text: text("text"),
    /** 人机协作说明 */
    aiNote: text("ai_note"),
    /** Members who took part (signature). */
    members: jsonb("members").notNull().default([]),
    /** pending | pass | block (part 2 §4.7) */
    safety: text("safety").notNull().default("pending"),
    /** Difficulty level from the AI's first score (PRD part 6 T7; part 5 §4.1). */
    difficulty: integer("difficulty"),
    /** Knowledge tags "学科/子领域" (1–3) from the AI (part 4 v0.3; part 6 T7). */
    tags: jsonb("tags"),
  },
  (t) => [uniqueIndex("works_slot_version").on(t.serverId, t.teamId, t.slot, t.version), index("works_slot").on(t.serverId, t.slot)],
);

/** AI scores (append-only; one is official per work). */
export const aiScores = pgTable(
  "ai_scores",
  {
    id: id(),
    workId: uuid("work_id").notNull().references(() => works.id),
    /** Rubric family (A–E) and version used. */
    rubric: text("rubric").notNull(),
    model: text("model").notNull(),
    total: integer("total").notNull(),
    dims: jsonb("dims").notNull(),
    comment: text("comment").notNull(),
    flags: jsonb("flags").notNull().default([]),
    official: boolean("official").notNull().default(true),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("ai_scores_work").on(t.workId)],
);

/** Each work has a responsible reviewer (part 3 §10.5); 10 % get a second one. */
export const reviewAssignments = pgTable(
  "review_assignments",
  {
    id: id(),
    workId: uuid("work_id").notNull().references(() => works.id),
    reviewerId: uuid("reviewer_id").notNull().references(() => adminUsers.id),
    second: boolean("second").notNull().default(false),
    assignedAt: ts("assigned_at").notNull(),
    dueAt: ts("due_at").notNull(),
    /** pending | done | timeout | reassigned */
    status: text("status").notNull().default("pending"),
    remindedAt: ts("reminded_at"),
    doneAt: ts("done_at"),
  },
  (t) => [index("review_assignments_reviewer").on(t.reviewerId, t.status), index("review_assignments_work").on(t.workId)],
);

/** Human scores (append-only). */
export const humanScores = pgTable("human_scores", {
  id: id(),
  assignmentId: uuid("assignment_id").notNull().references(() => reviewAssignments.id),
  workId: uuid("work_id").notNull().references(() => works.id),
  reviewerId: uuid("reviewer_id").notNull(),
  total: integer("total").notNull(),
  dims: jsonb("dims").notNull(),
  comment: text("comment").notNull(),
  /** One comment per rubric dimension (哪里好、哪里扣分), starting from the AI's draft (part 7 §5.2). */
  reasons: jsonb("reasons").notNull().default({}),
  flags: jsonb("flags").notNull().default([]),
  at: ts("at").notNull(),
});

/** The score a settlement uses, and why (part 4 §6: human / AI after timeout / admin). */
export const settledScores = pgTable(
  "settled_scores",
  {
    id: id(),
    workId: uuid("work_id").notNull().references(() => works.id),
    score: integer("score").notNull(),
    /** human | ai_timeout | admin */
    basis: text("basis").notNull(),
    decidedAt: ts("decided_at").notNull(),
    decidedBy: text("decided_by").notNull(),
    note: text("note"),
  },
  (t) => [index("settled_scores_work").on(t.workId)],
);

/** Reviewer leave (part 4 §2): no new works are assigned on these days. */
export const reviewerLeaves = pgTable("reviewer_leaves", {
  id: id(),
  reviewerId: uuid("reviewer_id").notNull().references(() => adminUsers.id),
  fromDay: date("from_day").notNull(),
  toDay: date("to_day").notNull(),
  createdAt: ts("created_at").notNull(),
});

/** Slots closed for scoring: works frozen, AI scored, reviewers assigned (idempotency of the pipeline). */
export const scoringRounds = pgTable(
  "scoring_rounds",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    /** e.g. "contest:K1a2b", "war:2", "battle" */
    key: text("key").notNull(),
    closedAt: ts("closed_at").notNull(),
    /** open (waiting for reviews) | settled */
    status: text("status").notNull().default("open"),
    settledAt: ts("settled_at"),
  },
  (t) => [uniqueIndex("scoring_rounds_key").on(t.serverId, t.key)],
);

// ---- data rights (part 5 G4; part 8 §4) ------------------------------------------------

/** A parent's request to export or delete a child's (or the whole family's) data. */
export const dataRequests = pgTable(
  "data_requests",
  {
    id: id(),
    familyId: uuid("family_id").notNull().references(() => families.id),
    /** null = the whole family account. */
    childId: uuid("child_id"),
    /** export | delete */
    kind: text("kind").notNull(),
    /** pending | done | cancelled */
    status: text("status").notNull().default("pending"),
    requestedAt: ts("requested_at").notNull(),
    /** Deletions wait a few days so the parent can change their mind. */
    dueAt: ts("due_at").notNull(),
    doneAt: ts("done_at"),
    /** Export: where the file is (object storage key). */
    resultKey: text("result_key"),
  },
  (t) => [index("data_requests_family").on(t.familyId), index("data_requests_due").on(t.status, t.dueAt)],
);

// ---- daily tasks and the journal (part 4 §8; content library §8) -------------------------

/** One daily task a child handed in (evidence + explanation + a line on how AI was used). */
export const dailySubmissions = pgTable(
  "daily_submissions",
  {
    id: id(),
    childId: uuid("child_id").notNull().references(() => children.id),
    /** 1–6 (content library 8.1). */
    templateId: integer("template_id").notNull(),
    evidenceFileIds: jsonb("evidence_file_ids").notNull(),
    /** voice | text */
    explainKind: text("explain_kind").notNull(),
    explainFileId: uuid("explain_file_id"),
    explainText: text("explain_text"),
    aiNote: text("ai_note"),
    /** "没用 AI" (templates 3–6): human–AI level is "not applicable". */
    noAi: boolean("no_ai").notNull().default(false),
    submittedAt: ts("submitted_at").notNull(),
    /** Beijing date of the submission (the day it counts for). */
    day: date("day").notNull(),
    /** Grade on the day (crossing score, part 4 §2). */
    grade: integer("grade").notNull(),
    /** reviewing | passed | failed | error (AI kept failing: exception queue) */
    status: text("status").notNull().default("reviewing"),
    attempts: integer("attempts").notNull().default(0),
    nextTryAt: ts("next_try_at"),
    /** For the child when not passed: why and how to fix it. */
    failReason: text("fail_reason"),
    feedbackGood: text("feedback_good"),
    feedbackBetter: text("feedback_better"),
    /** Grain counted through the season engine (null: not a season player, or not counted). */
    grain: integer("grain"),
    counted: boolean("counted"),
    busyNoticeAt: ts("busy_notice_at"),
    decidedAt: ts("decided_at"),
    /** Made by the website for one hand-in (part 5 §3.1 自动重传): sending it again returns the same submission. */
    clientKey: uuid("client_key"),
  },
  (t) => [index("daily_child_day").on(t.childId, t.day), index("daily_status").on(t.status), uniqueIndex("daily_client_key").on(t.childId, t.clientKey)],
);

/** The review (AI or a person from the exception queue); background levels are never shown to the child. */
export const dailyReviews = pgTable(
  "daily_reviews",
  {
    id: id(),
    submissionId: uuid("submission_id").notNull().references(() => dailySubmissions.id),
    /** "ai:<model>" or "admin:<id>" */
    by: text("by").notNull(),
    passed: boolean("passed").notNull(),
    /** 表达档 0–4 */
    expression: integer("expression"),
    /** 人机协作档 0–4; null = not applicable */
    aiLevel: integer("ai_level"),
    aiTone: boolean("ai_tone").notNull().default(false),
    mainTag: text("main_tag"),
    subTag: text("sub_tag"),
    /** L1–L6 as 1–6 */
    difficulty: integer("difficulty"),
    /** difficulty − the level of the child's grade */
    crossing: integer("crossing"),
    /** Seconds of voice or characters of text. */
    length: integer("length"),
    raw: jsonb("raw"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("daily_reviews_submission").on(t.submissionId)],
);

/** 知识卡片 in the journal (修行日志). Only what the child said (PRD part 6 §0.4). */
export const knowledgeCards = pgTable(
  "knowledge_cards",
  {
    id: id(),
    childId: uuid("child_id").notNull().references(() => children.id),
    submissionId: uuid("submission_id").notNull().references(() => dailySubmissions.id),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    /** "物理与天文/力与运动" */
    tag: text("tag"),
    difficulty: integer("difficulty"),
    day: date("day").notNull(),
    visible: boolean("visible").notNull().default(true),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("knowledge_cards_child").on(t.childId, t.day)],
);

// ---- supply tasks (part 3 §12; part 4 §5.4) ------------------------------------------------

/** Each member's part (kind "member") and the leader's team summary (kind "summary"); every save is a new row, the latest counts. */
export const supplyEntries = pgTable(
  "supply_entries",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    /** "1a", "1b", … (planned events supply_publish / supply_deadline). */
    supplyId: text("supply_id").notNull(),
    childId: uuid("child_id").notNull(),
    /** member | summary */
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    fileIds: jsonb("file_ids").notNull().default([]),
    at: ts("at").notNull(),
  },
  (t) => [index("supply_entries_team").on(t.serverId, t.supplyId, t.teamId)],
);

/** The AI's scores per team and what the engine paid (part 4 §5.4 军需提交). */
export const supplyResults = pgTable(
  "supply_results",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    supplyId: text("supply_id").notNull(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    submittedMembers: integer("submitted_members").notNull(),
    quality: integer("quality").notNull(),
    summary: integer("summary").notNull(),
    model: text("model").notNull(),
    comment: text("comment"),
    at: ts("at").notNull(),
    /** 抽查改档 (part 7 §7): the grain tier an admin set (the difference is a ledger adjustment). */
    regradedGrain: integer("regraded_grain"),
    regradeNote: text("regrade_note"),
    regradedBy: text("regraded_by"),
    regradedAt: ts("regraded_at"),
  },
  (t) => [uniqueIndex("supply_results_team").on(t.serverId, t.supplyId, t.teamId)],
);

/** Weekly-war constraint cards (part 3 §11): what each team was offered, sent and received. */
export const warCards = pgTable(
  "war_cards",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    week: integer("week").notNull(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    /** Gift weeks: the 3 cards shown to this team. */
    offered: jsonb("offered").notNull().default([]),
    /** The card this team sends to its opponent (null until chosen; random at the deadline). */
    chosen: text("chosen"),
    chosenBy: text("chosen_by"),
    chosenAt: ts("chosen_at"),
    /** The card this team must follow (fixed card on fixed weeks; the opponent's choice on gift weeks). */
    received: text("received"),
    revealedAt: ts("revealed_at"),
  },
  (t) => [uniqueIndex("war_cards_team").on(t.serverId, t.week, t.teamId)],
);

// ---- question bank (part 4 §3; content library §4, §12) -----------------------------------------

/** Land templates reused across seasons; each server's lands are made from them. */
export const landTemplates = pgTable("land_templates", {
  id: id(),
  name: text("name").notNull().unique(),
  /** edge | center */
  kind: text("kind").notNull(),
  subject: text("subject").notNull(),
  /** Rubric family A–E. */
  rubric: text("rubric").notNull(),
  questionType: text("question_type").notNull(),
  defaultAudience: text("default_audience"),
  /** 小队友可以做什么 */
  juniorHint: text("junior_hint"),
  /** enabled | pending (【待定】) */
  status: text("status").notNull().default("enabled"),
  sort: integer("sort").notNull().default(0),
});

/** Prompts of every kind; only "enabled" ones are drawn (content library §12). */
export const prompts = pgTable(
  "prompts",
  {
    id: id(),
    /** land | war_theme | supply | battle_line | battle_main */
    category: text("category").notNull(),
    landTemplateId: uuid("land_template_id").references(() => landTemplates.id),
    questionType: text("question_type"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience"),
    rubric: text("rubric"),
    /** draft | enabled | disabled */
    status: text("status").notNull().default("draft"),
    /** 待补: still a placeholder. */
    todo: boolean("todo").notNull().default(false),
    /**
     * By category: a weekly war theme's fixed card (`fixedCard`, fixed weeks);
     * a supply task's per-person part and summary task (`perPerson`, `summaryTask`).
     */
    extra: jsonb("extra").notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("prompts_land").on(t.landTemplateId, t.status)],
);

/** 异步辩论 on debate lands (朱紫国、车迟国; part 3 §10.4): sides and the two stages. */
export const debates = pgTable(
  "debates",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    contestId: text("contest_id").notNull(),
    /** The defender's side: pro | con (attackers take the other). */
    defenderSide: text("defender_side"),
    /** defender | system (not chosen within 12 hours) */
    sideBy: text("side_by"),
    sideAt: ts("side_at"),
    sideDeadline: ts("side_deadline").notNull(),
    openingDeadline: ts("opening_deadline").notNull(),
    /** The defender handed in no opening: attackers rebut the 2 strongest arguments they imagine (part 3 §10.4). */
    noDefender: boolean("no_defender").notNull().default(false),
    openingsSharedAt: ts("openings_shared_at"),
  },
  (t) => [uniqueIndex("debates_contest").on(t.serverId, t.contestId)],
);

// ---- operations: announcements, camp QR codes, envoys (part 4 §4, §9; part 7 §8) ----------------

/** 公告: written by an admin, published at a chosen time to everyone, a season or a server. */
export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    /** all | season | server */
    scope: text("scope").notNull(),
    seasonId: uuid("season_id").references(() => seasons.id),
    serverId: uuid("server_id").references(() => servers.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    publishAt: ts("publish_at").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    sentAt: ts("sent_at"),
    withdrawnAt: ts("withdrawn_at"),
  },
  (t) => [index("announcements_publish").on(t.publishAt)],
);

/** WeChat group QR codes of the big-battle camps (teams keep theirs on the team row). */
export const campQrCodes = pgTable(
  "camp_qr_codes",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    /** a | b */
    camp: text("camp").notNull(),
    image: text("image").notNull(),
    uploadedAt: ts("uploaded_at").notNull(),
    remindedAt: ts("reminded_at"),
  },
  (t) => [uniqueIndex("camp_qr_codes_camp").on(t.serverId, t.camp)],
);

/** 使者 of the big battle's main field: registered by leaders and deputies (part 4 §5.6). */
export const envoys = pgTable(
  "envoys",
  {
    id: id(),
    serverId: uuid("server_id").notNull().references(() => servers.id),
    camp: text("camp").notNull(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    childId: uuid("child_id").notNull(),
    registeredBy: uuid("registered_by").notNull(),
    at: ts("at").notNull(),
  },
  (t) => [uniqueIndex("envoys_child").on(t.serverId, t.childId)],
);

/** 注册问卷 answers (part 4 §2; content library §10): every completion is kept, the latest counts. */
export const surveyAnswers = pgTable(
  "survey_answers",
  {
    id: id(),
    childId: uuid("child_id").notNull().references(() => children.id),
    version: text("version").notNull(),
    answers: jsonb("answers").notNull(),
    /** 好奇分 per subject. */
    curiosity: jsonb("curiosity").notNull(),
    /** fighter | strategist | healer | builder */
    style: text("style").notNull(),
    /** The 30-second challenge: the growth baseline (voice file or text). */
    challengeKind: text("challenge_kind"),
    challengeText: text("challenge_text"),
    challengeFileId: uuid("challenge_file_id"),
    completedAt: ts("completed_at").notNull(),
  },
  (t) => [index("survey_answers_child").on(t.childId, t.completedAt)],
);

/** 内容安全队列 (part 6 §7; part 7 §8): what the safety service did not pass. */
export const safetyQueue = pgTable(
  "safety_queue",
  {
    id: id(),
    /** work | daily_task | card */
    objectKind: text("object_kind").notNull(),
    objectId: uuid("object_id").notNull(),
    labels: jsonb("labels").notNull().default([]),
    /** pending | passed | removed */
    status: text("status").notNull().default("pending"),
    /** A reviewer's "转给管理员" note. */
    forwardNote: text("forward_note"),
    forwardedBy: text("forwarded_by"),
    handledBy: text("handled_by"),
    handledAt: ts("handled_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("safety_queue_status").on(t.status), uniqueIndex("safety_queue_object").on(t.objectKind, t.objectId)],
);

/** 周小结 / 月报告 (part 4 §8; part 6 T8). */
export const childSummaries = pgTable(
  "child_summaries",
  {
    id: id(),
    childId: uuid("child_id").notNull().references(() => children.id),
    /** week | month */
    kind: text("kind").notNull(),
    /** "2027-02-08" (the week's Monday) or "2027-02" */
    period: text("period").notNull(),
    content: jsonb("content").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("child_summaries_period").on(t.childId, t.kind, t.period)],
);

/** 赛季回顾 (part 4 §10; part 5 G6): generated after the final settlement, released by an admin. */
export const seasonReviews = pgTable(
  "season_reviews",
  {
    id: id(),
    childId: uuid("child_id").notNull().references(() => children.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    content: jsonb("content").notNull(),
    createdAt: ts("created_at").notNull(),
    releasedAt: ts("released_at"),
  },
  (t) => [uniqueIndex("season_reviews_child").on(t.childId, t.seasonId)],
);

// ---- AI gateway (part 2 §4.6; part 4 §10; part 6 §9) ---------------------------------------------

/** Which provider and model each AI task uses; switched in the admin console. */
export const aiConfigs = pgTable("ai_configs", {
  /** daily_review | work_score | supply_score | summary | transcribe | … */
  task: text("task").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  /** 0 = the built-in first draft (`BUILTIN_PROMPTS`), otherwise a saved version. */
  promptVersion: integer("prompt_version").notNull().default(0),
  fallbackProvider: text("fallback_provider"),
  fallbackModel: text("fallback_model"),
  /** Shadow mode: also run this model, log it, never use it. */
  shadowModel: text("shadow_model"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: id(),
    task: text("task").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("prompt_templates_task_version").on(t.task, t.version)],
);

/**
 * Price list per model (PRD part 6 §6.2; part 7 §4 cost board), in 0.0001 yuan:
 * per million input / output tokens, and per hour of audio for speech-to-text.
 * The admin console keeps it current; the gateway works out each call's cost.
 */
export const aiPrices = pgTable("ai_prices", {
  model: text("model").primaryKey(),
  inPerMillion: integer("in_per_million").notNull().default(0),
  outPerMillion: integer("out_per_million").notNull().default(0),
  perAudioHour: integer("per_audio_hour").notNull().default(0),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * 关于与 AI 公示 (PRD part 5 §8, part 7 §8): which model does what, with its
 * filing or registration number, as the website shows it. Kept by the admins
 * (update it when a model changes, part 6 §8).
 */
export const aiDisclosures = pgTable("ai_disclosures", {
  id: id(),
  /** What it is used for, e.g. "作品初评" */
  purpose: text("purpose").notNull(),
  /** The model's public name, e.g. "通义千问" */
  model: text("model").notNull(),
  /** Who provides it, e.g. "阿里云" */
  provider: text("provider").notNull(),
  /** 备案号或登记编号 */
  filingNo: text("filing_no"),
  sort: integer("sort").notNull().default(0),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * Rubric families A–E, saved versions (PRD part 6 §4.2–§4.3; part 7 §4 评分族):
 * dimensions with points and hints, the 50 and 75 point anchors. Version 1 is
 * the built-in copy (content library §3); every save is a new version, the
 * latest is live, and a work keeps the version it was scored with.
 */
export const rubricVersions = pgTable(
  "rubric_versions",
  {
    id: id(),
    family: text("family").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    /** [{ key, name, max, hint }] — maxima add up to 100 */
    dims: jsonb("dims").notNull(),
    at50: text("at50").notNull(),
    at75: text("at75").notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("rubric_versions_family_version").on(t.family, t.version)],
);

/**
 * Content the admins edit as one list (PRD part 7 §4): `war_cards` (the 24
 * constraint cards and the weeks each is allowed in) and `daily_templates`
 * (the six templates' names, prompts and evidence). Missing → the content
 * library drafts in `@zhiyouji/shared`.
 */
export const contentSettings = pgTable("content_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * 待补清单 (content library "待补清单"; PRD part 7 §1, §4): content still to be
 * written before a season, each with its hard deadline as a season day
 * ("D1 之前" = day 1). Reminders go to the admins a week and a day before.
 */
export const contentTodos = pgTable("content_todos", {
  id: id(),
  title: text("title").notNull(),
  /** 现状 */
  state: text("state"),
  /** 回来时要做什么 */
  action: text("action"),
  /** Season day it must be ready by (start of that day, Beijing). */
  dueDay: integer("due_day").notNull(),
  /** How the deadline is said, e.g. "D4（第一个周四晚间公布时刻）". */
  dueNote: text("due_note"),
  doneAt: ts("done_at"),
  doneBy: text("done_by"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull(),
});

/**
 * 校准 (PRD part 7 §4; part 6 §4.1): sample works (no child data — the user's
 * own examples), scored independently by several people and by candidate AI
 * set-ups, to compare AI and human by rubric family before launch and after
 * each season.
 */
export const calibSamples = pgTable("calib_samples", {
  id: id(),
  title: text("title").notNull(),
  /** Rubric family A–E. */
  family: text("family").notNull(),
  taskTitle: text("task_title").notNull(),
  taskBody: text("task_body"),
  audience: text("audience"),
  mediaKind: text("media_kind").notNull().default("text"),
  /** The work's text, or the transcript of its video or audio. */
  text: text("text").notNull(),
  aiNote: text("ai_note"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const calibScores = pgTable(
  "calib_scores",
  {
    id: id(),
    sampleId: uuid("sample_id").notNull().references(() => calibSamples.id),
    /** human | ai */
    kind: text("kind").notNull(),
    /** An admin user id (human) or a run label "model · 提示词第 N 版" (ai). */
    scorer: text("scorer").notNull(),
    total: integer("total").notNull(),
    dims: jsonb("dims").notNull(),
    rubric: text("rubric").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("calib_scores_one").on(t.sampleId, t.kind, t.scorer)],
);

/**
 * 美术资源 (PRD part 5 §7; part 7 §8): an image per slot ("map", "land:火焰山",
 * "item:zijin", "badge:1", "avatar:a1", "tudigong", "splash"), with its author
 * (credited on the 关于 page). Every upload is kept; one per slot is live.
 */
export const artAssets = pgTable(
  "art_assets",
  {
    id: id(),
    slot: text("slot").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    author: text("author").notNull(),
    note: text("note"),
    live: boolean("live").notNull().default(false),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: ts("uploaded_at").notNull(),
  },
  (t) => [index("art_assets_slot").on(t.slot, t.live)],
);

/** Every AI call (append-only): input, output, model, version, time, cost. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: id(),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    /** primary | fallback | shadow */
    role: text("role").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    /** Cost in 0.0001 yuan. */
    cost: integer("cost"),
    latencyMs: integer("latency_ms").notNull(),
    /** ok | error */
    status: text("status").notNull(),
    error: text("error"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("ai_calls_task_at").on(t.task, t.createdAt)],
);
