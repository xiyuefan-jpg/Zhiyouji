/**
 * Daily tasks and the journal (content library §8, §9; PRD part 5 C1–C9).
 */

import { z } from "zod";

/** The six templates (content library 8.1). `noAiAllowed`: templates 3–6 may say "没用 AI". */
export const DAILY_TEMPLATES = [
  { id: 1, name: "用 AI 学了一个新知识", prompt: "今天你用 AI 学会了一个什么以前不知道的东西？", evidence: "和 AI 对话的截图", noAiAllowed: false },
  { id: 2, name: "对 AI 技术的一个新了解", prompt: "今天你知道了 AI 的什么新本事，或者什么新毛病？", evidence: "截图、文章或视频画面", noAiAllowed: false },
  { id: 3, name: "兴趣上的一次进展", prompt: "你喜欢的事情，今天往前走了哪一步？", evidence: "作品或练习的照片", noAiAllowed: true },
  { id: 4, name: "生活中的一次实践", prompt: "今天你亲手做成了什么（做饭、修东西、整理）？", evidence: "过程或成果的照片", noAiAllowed: true },
  { id: 5, name: "发现身边的一个问题", prompt: "今天你发现了身边哪里不对劲？为什么会这样？", evidence: "现场照片", noAiAllowed: true },
  { id: 6, name: "读或看了一个作品，提出一个好问题", prompt: "你读了或看了什么？它让你想问一个什么问题？", evidence: "封面或截图", noAiAllowed: true },
] as const;

/** The two hints always shown while explaining (content library 8.1). */
export const EXPLAIN_HINTS = ["一个你自己想到的例子", "你原来哪里不懂，现在怎么懂了"] as const;

/** Knowledge taxonomy v0.2 (content library §9): 15 subjects and their sub-fields. */
export const TAXONOMY: Readonly<Record<string, readonly string[]>> = {
  数学: ["数与代数", "几何与空间", "概率与统计", "逻辑与离散数学", "数学史与数学家"],
  物理与天文: ["力与运动", "热声光", "电与磁", "近代物理（相对论、量子）", "天文与宇宙"],
  化学与材料: ["化学变化与反应", "生活中的化学", "有机与生命化学", "材料科学"],
  生命科学: ["细胞与分子", "遗传与进化", "动物与植物", "生态学", "微生物"],
  医学与健康: ["人体结构与功能", "疾病与免疫", "营养与运动科学", "公共卫生", "脑与神经科学"],
  地球与环境: ["自然地理", "天气与气候", "地质与灾害", "海洋科学", "环境与可持续发展"],
  工程与计算机: ["计算机与编程", "人工智能", "电子与通信", "机械与机器人", "建筑与土木", "能源与交通", "航空航天"],
  经济与管理: ["经济学原理", "国际贸易与全球化", "金融与货币", "商业与管理", "个人理财"],
  "政治、法律与国际关系": ["政治学", "国际关系", "区域与国别", "法学", "公共政策与治理"],
  "社会、心理与传播": ["社会学", "心理学", "人类学与民族学", "教育学", "新闻与传播"],
  历史与考古: ["中国古代史", "中国近现代史", "世界史", "考古与文物", "历史人物"],
  哲学与思维: ["中国哲学", "西方哲学", "伦理学", "逻辑与批判性思维"],
  语言与文学: ["汉语与汉字", "中国古典文学", "现当代文学", "外国文学", "外语", "写作与修辞"],
  艺术与设计: ["美术", "设计", "音乐", "影视与动画", "戏剧与舞蹈"],
  生活与实践: ["烹饪", "手工与修理", "运动技能", "户外与自然观察", "安全与急救"],
};

/** "学科/子领域", or "其他/<建议>" when nothing fits. */
export function isKnownTag(tag: string): boolean {
  const [subject, sub] = tag.split("/");
  if (subject === "其他") return !!sub;
  return !!subject && !!sub && (TAXONOMY[subject]?.includes(sub) ?? false);
}

/** Level of a grade (content library §9): 1–3 → L1, 4–6 → L2, junior high → L3, senior high → L4. */
export function gradeLevel(grade: number): number {
  return grade <= 3 ? 1 : grade <= 6 ? 2 : grade <= 9 ? 3 : 4;
}

/** 跨越度 = difficulty level − the level of the child's grade. */
export function crossing(difficulty: number, grade: number): number {
  return difficulty - gradeLevel(grade);
}

export const DAILY_TEXT_MIN = 50;
export const DAILY_TEXT_MAX = 150;
export const DAILY_VOICE_MAX_SEC = 90;
export const DAILY_EVIDENCE_MAX = 9;

export const dailyUploadRequest = z.object({
  kind: z.enum(["image", "audio"]),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  /** Length of the recorded narration (the recorder knows it); checked before the upload starts. */
  durationSec: z.number().nonnegative().max(86_400).optional(),
});

export const dailySubmit = z.object({
  templateId: z.number().int().min(1).max(6),
  evidenceFileIds: z.array(z.uuid()).min(1, "evidence_required").max(DAILY_EVIDENCE_MAX),
  explain: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("voice"), fileId: z.uuid() }),
    z.object({ kind: z.literal("text"), text: z.string().trim() }),
  ]),
  aiNote: z.string().trim().max(200).optional(),
  noAi: z.boolean().optional(),
  /** One key per hand-in, made by the website: a retry after a lost answer returns the same submission. */
  clientKey: z.uuid().optional(),
});
export type DailySubmit = z.infer<typeof dailySubmit>;

/** A person deciding a daily task from the exception queue (part 7 §5.3). */
export const dailyDecide = z.object({
  passed: z.boolean(),
  expression: z.number().int().min(0).max(4),
  aiLevel: z.number().int().min(0).max(4).nullable(),
  mainTag: z.string().min(1).max(60),
  subTag: z.string().max(60).nullable().optional(),
  difficulty: z.number().int().min(1).max(6),
  /** One or two sentences for the child. */
  feedbackGood: z.string().trim().max(200).optional(),
  feedbackBetter: z.string().trim().max(200).optional(),
  failReason: z.string().trim().max(300).optional(),
  cardTitle: z.string().trim().max(15).optional(),
  cardSummary: z.string().trim().max(300).optional(),
});
export type DailyDecide = z.infer<typeof dailyDecide>;
