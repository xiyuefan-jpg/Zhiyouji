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
