/**
 * Season actions on the student website (PRD part 5 D–E): request shapes.
 */

import { z } from "zod";

export const roleSchema = z.enum(["leader", "deputy"]);

export const claimRoleRequest = z.object({ role: roleSchema });
export const offerRoleRequest = z.object({ role: roleSchema, to: z.uuid() });
export const answerTransferRequest = z.object({ accept: z.boolean() });

export const landRequest = z.object({ landId: z.string().min(1).max(10) });
export const itemRequest = z.object({ itemId: z.string().min(1).max(20) });
export const bidRequest = z.object({ itemId: z.string().min(1).max(20), amount: z.number().int().positive() });

export const useItemRequest = z.object({
  itemId: z.string().min(1).max(20),
  uid: z.string().min(1).max(40).optional(),
  targetTeamId: z.uuid().optional(),
  landId: z.string().min(1).max(10).optional(),
  contestId: z.string().min(1).max(40).optional(),
  week: z.number().int().min(1).max(5).optional(),
  line: z.number().int().min(0).max(10).optional(),
});

export const ROUND_NAMES = ["blind_auction", "starter_items", "center_round", "rare_round"] as const;
export const roundParam = z.object({ round: z.enum(ROUND_NAMES) });
export const roundSubmission = z.object({
  /** Blind auction only: grain bid. */
  bid: z.number().int().min(0).optional(),
  /** Land ids (auction, D8) or item ids (starter items, rare round), most wanted first. */
  prefs: z.array(z.string().min(1).max(20)).max(20),
});

export const linesRequest = z.object({ lines: z.array(z.uuid()).min(1).max(10) });

export const ledgerQuery = z.object({ currency: z.enum(["grain", "points"]).default("points") });

// ---- 作品工坊 (part 5 E4, §3.3) -------------------------------------------------------------

export const FILE_KINDS = ["video", "audio", "image", "pdf"] as const;
export const MEDIA_KINDS = ["video", "audio", "images", "text"] as const;

export const uploadRequest = z.object({
  kind: z.enum(FILE_KINDS),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  filename: z.string().trim().max(200).optional(),
});

export const slotParam = z.object({ slot: z.string().regex(/^(contest:[A-Za-z0-9]+|war:\d+|line|main:[ab])$/) });

export const materialRequest = z.object({
  fileId: z.uuid().optional(),
  text: z.string().max(5000).optional(),
});

export const workSubmit = z.object({
  mediaKind: z.enum(MEDIA_KINDS),
  fileIds: z.array(z.uuid()).max(20).default([]),
  /** Written explanation (and the whole work when mediaKind is "text"). */
  text: z.string().max(10000).optional(),
  /** 人机协作说明 */
  aiNote: z.string().max(1000).optional(),
  /** Members who took part (signature). */
  members: z.array(z.uuid()).min(1).max(20),
});

// ---- review (part 7 §5) ------------------------------------------------------------------------

export const reviewSubmit = z.object({
  /** Score per rubric dimension key, e.g. { accuracy: 20, teach: 25, … }. */
  dims: z.record(z.string(), z.number().int().min(0).max(100)),
  comment: z.string().trim().min(1).max(3000),
  flags: z.array(z.enum(["plagiarism", "inappropriate", "needs_admin"])).max(3).optional(),
});
export const reassignRequest = z.object({ reviewerId: z.uuid() });
export const leaveRequest = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const ruleRequest = z.object({ score: z.number().int().min(0).max(100), note: z.string().trim().min(1).max(300) });

// ---- 军需任务 (part 3 §12; content library §6) ----------------------------------------------

/** Draft supply tasks (content library §6, 【待补】) until the question bank is in the database. */
export const SUPPLY_PRESETS = [
  { id: "Q1", title: "好奇心接力", perPerson: "一个这周真实产生的问题，找答案的方法和找到的答案", summary: "最值得继续探索的问题，以及理由" },
  { id: "Q2", title: "本周学习地图", perPerson: "从自己本周的每日任务里挑一条知识，用一句话讲给组员听", summary: "把大家的知识分成几类，画成一张图" },
  { id: "Q3", title: "社区问题接力", perPerson: "一个身边真实的问题：地点、具体表现、影响了谁", summary: "选出最值得关注的一个，说明理由" },
  { id: "Q4", title: "公共场所里的一个设计", perPerson: "一张照片，加上“它好在哪里”或“可以怎么改”", summary: "全组最好的一个设计" },
  { id: "Q5", title: "长辈的过去", perPerson: "采访一位长辈，至少 3 个问题的问答记录", summary: "过去和现在最大的不同" },
  { id: "Q6", title: "一个好用的工具", perPerson: "一个真实用过的工具（App、网站、AI、实物），截图或照片，以及它的优点和缺点", summary: "全组最推荐的一个，说明理由" },
  { id: "Q7", title: "家乡的一种文化", perPerson: "方言、饮食、节日习俗或家规，照片或文字记录", summary: "这种文化为什么存在，现在有没有变化" },
  { id: "Q8", title: "一次消费复盘", perPerson: "一次真实的消费：买了什么、为什么买、是否必要、有没有受到广告或别人的影响", summary: "什么情况下人最容易冲动消费" },
  { id: "Q9", title: "自然变化记录", perPerson: "同一个对象观察 2 次（间隔至少 6 小时），照片或绘图", summary: "变化背后可能的原因" },
  { id: "Q10", title: "一个网络说法的核查", perPerson: "一条网上看到的说法，以及至少 1 种验证方法", summary: "它为什么容易让人相信" },
] as const;

/** Suggested schedule (content library §6): supply id → preset. */
export const SUPPLY_SCHEDULE: Readonly<Record<string, string>> = { "1a": "Q1", "1b": "Q2", "2a": "Q4", "2b": "Q5", "3a": "Q8", "3b": "Q3", "4a": "Q6", "4b": "Q7" };

export const supplyEntryRequest = z.object({
  text: z.string().trim().min(1).max(2000),
  fileIds: z.array(z.uuid()).max(9).default([]),
});
