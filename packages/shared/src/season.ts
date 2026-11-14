/**
 * Season setup in the admin console (PRD part 7 §2–§3; part 3 §2, §4):
 * request shapes the admin console and the server agree on.
 */

import { z } from "zod";

/** Season states (part 3 §2, part 4 §4). */
export const SEASON_STATUSES = ["draft", "enrolling", "grouped", "running", "big_battle", "final_pending", "ended", "archived"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const SEASON_STATUS_LABELS: Readonly<Record<SeasonStatus, string>> = {
  draft: "草稿",
  enrolling: "报名中",
  grouped: "已分组",
  running: "进行中",
  big_battle: "大团战",
  final_pending: "待终局结算",
  ended: "已结束",
  archived: "已归档",
};

/**
 * Team names: places from Journey to the West (part 3 §4) that are not land
 * names (the 12 lands use 大唐长安城、五行山、火焰山、兜率宫、五庄观、通天河、
 * 朱紫国、车迟国、谛听台、小雷音寺、盘丝洞、女儿国). Enough for two servers.
 */
export const TEAM_NAME_POOL = [
  "花果山",
  "方寸山",
  "高老庄",
  "流沙河",
  "黑风山",
  "白虎岭",
  "宝象国",
  "乌鸡国",
  "火云洞",
  "黑水河",
  "金兜山",
  "狮驼岭",
  "比丘国",
  "陷空山",
  "凤仙郡",
  "玉华州",
  "天竺国",
  "鹰愁涧",
  "灵台山",
  "祭赛国",
] as const;

/** Server names in order. */
export const SERVER_NAMES = ["一服", "二服", "三服", "四服"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bad_request");

export const seasonCreate = z.object({
  name: z.string().trim().min(1).max(40),
  /** D0, must be a Sunday (part 3 §20.2). */
  opening: isoDate,
  seed: z.number().int().min(1).max(2_147_483_646).optional(),
  /** Copy the current parameters of an earlier season (part 7 §2). */
  copyParamsFrom: z.uuid().optional(),
});
export type SeasonCreate = z.infer<typeof seasonCreate>;

export const seasonUpdate = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  opening: isoDate.optional(),
});

export const enrollRequest = z.object({
  /** One or many (the admin console's batch enabling from a table). */
  players: z
    .array(z.object({ childId: z.uuid(), paymentNote: z.string().trim().max(100).optional() }))
    .min(1)
    .max(500),
});
export type EnrollRequest = z.infer<typeof enrollRequest>;

/** 表格批量开通 (part 7 §3): rows of a pasted or uploaded table. */
export const enrollTableRequest = z.object({
  rows: z
    .array(
      z.object({
        phone: z.string().trim().regex(/^1\d{10}$/),
        nickname: z.string().trim().min(1).max(12).optional(),
        paymentNote: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const revokeRequest = z.object({ reason: z.string().trim().min(1).max(200) });

export const moveRequest = z.object({
  childId: z.uuid(),
  server: z.number().int().min(0),
  team: z.number().int().min(0),
});

export const renameTeamRequest = z.object({
  server: z.number().int().min(0),
  team: z.number().int().min(0),
  name: z.string().trim().min(1).max(12),
});

export const confirmGroupingRequest = z.object({
  /** Land display names by land code (E1 → 火焰山 …); default: the code. */
  landNames: z.record(z.string(), z.string().trim().min(1).max(12)).optional(),
  /** Enabled question-bank prompt ids per land code (until the question bank is in the database). */
  prompts: z.record(z.string(), z.array(z.string().min(1)).max(200)).optional(),
});

export const childSearchQuery = z.object({
  q: z.string().trim().min(1).max(40),
});

// ---- running a season (part 7 §2, §7, §9) ----------------------------------------------------

const reason = z.string().trim().min(1).max(300);

export const paramsUpdate = z.object({
  /** Only the parameters that change, in the shape of SeasonParams (PRD part 3 §17). */
  patch: z.record(z.string(), z.unknown()),
  note: reason,
});

export const calendarQuery = z.object({ from: isoDate, to: isoDate });
export const calendarSet = z.object({ kind: z.enum(["school", "rest"]).nullable(), note: z.string().trim().max(100).nullable().optional() });

export const rescheduleRequest = z.object({ runAt: z.coerce.date(), reason });
export const pauseRequest = z.object({ reason });
export const finalizeRequest = z.object({ poolYuan: z.number().int().min(0).max(10_000_000) });
export const hideFeedRequest = z.object({ reason });

export const interventionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("adjust_ledger"), teamId: z.uuid(), currency: z.enum(["grain", "points"]), amount: z.number().int(), reason }),
  z.object({ action: z.literal("reverse_entry"), entryId: z.string().min(1).max(40), reason }),
  z.object({ action: z.literal("set_land_owner"), landId: z.string().min(1).max(10), teamId: z.uuid().nullable(), reason }),
  z.object({ action: z.literal("give_item"), teamId: z.uuid(), itemId: z.string().min(1).max(20), reason }),
  z.object({ action: z.literal("remove_item"), teamId: z.uuid(), uid: z.string().min(1).max(40), reason }),
  z.object({ action: z.literal("cancel_contest"), contestId: z.string().min(1).max(40), refund: z.boolean(), reason }),
  z.object({ action: z.literal("set_role"), teamId: z.uuid(), role: z.enum(["leader", "deputy"]), childId: z.uuid().nullable(), reason }),
  z.object({ action: z.literal("withdraw"), childId: z.uuid(), reason }),
  /** §16 改截止时间: "contest:<id>", "war:<week>" or "battle". */
  z.object({ action: z.literal("set_deadline"), target: z.string().regex(/^(contest:[A-Za-z0-9]{1,40}|war:[1-9]|battle)$/), deadline: z.coerce.date(), reason }),
]);

export const opLogQuery = z.object({
  actor: z.string().max(80).optional(),
  action: z.string().max(80).optional(),
  object: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

// ---- 题库 (part 7 §4; content library §12) ---------------------------------------------------

export const PROMPT_CATEGORIES = ["land", "war_theme", "supply", "battle_line", "battle_main"] as const;
export const PROMPT_STATUSES = ["draft", "enabled", "disabled"] as const;

export const promptCreate = z.object({
  category: z.enum(PROMPT_CATEGORIES),
  landTemplateId: z.uuid().nullable().optional(),
  questionType: z.string().trim().max(60).nullable().optional(),
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(5000),
  audience: z.string().trim().max(100).nullable().optional(),
  rubric: z.enum(["A", "B", "C", "D", "E"]).nullable().optional(),
  status: z.enum(PROMPT_STATUSES).optional(),
  todo: z.boolean().optional(),
  /** 周战争主题: the fixed card of a fixed week; 军需任务: what each member hands in and the summary task. */
  extra: z
    .object({
      fixedCard: z.string().trim().max(200).nullable().optional(),
      perPerson: z.string().trim().max(500).nullable().optional(),
      summaryTask: z.string().trim().max(500).nullable().optional(),
    })
    .optional(),
});
export const promptUpdate = promptCreate.partial();
export const promptImport = z.object({ prompts: z.array(promptCreate).min(1).max(500) });
export const promptQuery = z.object({
  category: z.enum(PROMPT_CATEGORIES).optional(),
  landTemplateId: z.uuid().optional(),
  status: z.enum(PROMPT_STATUSES).optional(),
});
export const landTemplateUpdate = z.object({
  name: z.string().trim().min(1).max(12).optional(),
  subject: z.string().trim().min(1).max(40).optional(),
  rubric: z.enum(["A", "B", "C", "D", "E"]).optional(),
  questionType: z.string().trim().min(1).max(60).optional(),
  defaultAudience: z.string().trim().max(100).nullable().optional(),
  juniorHint: z.string().trim().max(200).nullable().optional(),
  status: z.enum(["enabled", "pending"]).optional(),
  sort: z.number().int().min(0).max(100).optional(),
});

// ---- 公告, QR codes (part 7 §3, §8) ------------------------------------------------------------

export const announcementCreate = z.object({
  scope: z.enum(["all", "season", "server"]),
  seasonId: z.uuid().nullable().optional(),
  serverId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(3000),
  publishAt: z.coerce.date(),
});
export const qrTicketRequest = z.object({ contentType: z.string().min(1).max(40), size: z.number().int().positive() });
export const qrSetRequest = z.object({ key: z.string().min(1).max(300) });
