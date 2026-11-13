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

export const slotParam = z.object({ slot: z.string().regex(/^(contest:[A-Za-z0-9]+(:open)?|war:\d+|line|main:[ab])$/) });
export const sideRequest = z.object({ side: z.enum(["pro", "con"]) });

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

// ---- 周战争：主题和约束词条 (part 3 §11; content library §5, 【待补 · AI 草案】) ------------------

export const WAR_THEMES: Readonly<Record<number, { title: string; task: string; fixedCard: string | null }>> = {
  1: {
    title: "家里的一个小麻烦",
    task: "找一个家里真实存在的小麻烦，设计一个解决方案，并做出一个能用的原型，至少在一个家里试用一次。",
    fixedCard: "预算 ≤30 元，只能用家里已有的东西加上买得到的小物件",
  },
  2: { title: "校园里的一个系统", task: "从午餐排队、失物招领、群消息混乱、课间秩序、图书角借还中选一个，设计一套完整的规则、流程或工具，并说明怎么判断它有没有改善。", fixedCard: null },
  3: {
    title: "为一个具体的人设计",
    task: "采访一位真实的人，找到他生活中的一个具体困难，为他设计一个方案。",
    fixedCard: "方案必须经过被采访者本人的一次反馈，并据此修改一次",
  },
  4: { title: "设计一个教人知识的小游戏", task: "设计一个 10–15 分钟能玩完的小游戏，玩完之后一个比你们小的孩子能学会一个知识点。必须真实试玩一次。", fixedCard: null },
};

/** The 24 constraint cards with the weeks they are allowed in (content library 5.4). */
export const WAR_CARDS: readonly { id: string; kind: string; text: string; weeks: readonly number[] }[] = [
  { id: "S1", kind: "情境", text: "停电：方案在没有电的情况下也要能运行", weeks: [2, 4] },
  { id: "S2", kind: "情境", text: "没有老师和家长：执行过程中不能有任何老师或家长参与", weeks: [2, 4] },
  { id: "S3", kind: "情境", text: "只有 10 分钟：整个流程或游戏必须在 10 分钟内完成", weeks: [2, 4] },
  { id: "S4", kind: "情境", text: "下雨天：只能在室内一个很小的空间里进行", weeks: [2, 4] },
  { id: "S5", kind: "情境", text: "回到一百年前：只能用 100 年前就有的东西", weeks: [2, 4] },
  { id: "S6", kind: "情境", text: "使用者是刚转来、谁也不认识的新同学", weeks: [2, 4] },
  { id: "S7", kind: "情境", text: "500 个人同时参与", weeks: [2] },
  { id: "S8", kind: "情境", text: "使用者从 6 岁到 60 岁都有", weeks: [4] },
  { id: "R1", kind: "资源", text: "预算 ≤50 元", weeks: [2, 4] },
  { id: "R2", kind: "资源", text: "只能用纸和笔", weeks: [2, 4] },
  { id: "R3", kind: "资源", text: "只有 2 个人负责执行或主持", weeks: [2, 4] },
  { id: "R4", kind: "资源", text: "不能用文字，只能用图、声音和动作", weeks: [2, 4] },
  { id: "R5", kind: "资源", text: "全部说明必须放进一张 A4 纸", weeks: [2, 4] },
  { id: "R6", kind: "资源", text: "不能用任何 App 或屏幕", weeks: [2, 4] },
  { id: "U1", kind: "对象", text: "使用者是 6 岁的小朋友", weeks: [2, 4] },
  { id: "U2", kind: "对象", text: "使用者是 70 岁的老人", weeks: [4] },
  { id: "U3", kind: "对象", text: "使用者看不见", weeks: [2, 4] },
  { id: "U4", kind: "对象", text: "使用者不会说中文", weeks: [2, 4] },
  { id: "U5", kind: "对象", text: "使用者非常忙，每天只能给你 1 分钟", weeks: [2] },
  { id: "U6", kind: "对象", text: "使用者一开始就不想参加", weeks: [2, 4] },
  { id: "T1", kind: "技术", text: "必须用到一次 AI，并说明 AI 在方案里做什么、可能出什么错", weeks: [2, 4] },
  { id: "T2", kind: "技术", text: "必须有一个可以拍照验证的实物", weeks: [2, 4] },
  { id: "X1", kind: "规则改变", text: "先写失败：先列出方案最可能失败的 3 种方式，再说明怎么防住", weeks: [2, 4] },
  { id: "X2", kind: "规则改变", text: "对手视角：作品里必须有一段“如果我是对手，我会怎么挑这个方案的毛病”，并回应", weeks: [2, 4] },
];

export const chooseCardRequest = z.object({ card: z.string().regex(/^[A-Z]\d$/) });
