/**
 * What the model is actually sent (PRD part 6 §0.3, §3, §4.2): for each task,
 * the live prompt template (admin console, versioned; the built-in first draft
 * when none is saved) + the rule that children's words are only material + the
 * fixed answer format, then the material itself with everything a child wrote
 * or said wrapped in `<child_content>` (part 8 §3.3).
 *
 * The gateway builds these messages, hands them to the model client and keeps
 * them in the call log (cleared after 90 days, `DEFAULT_RETENTION`). Names and
 * phone numbers are never part of them (part 6 §0.6).
 */

import { DAILY_TEMPLATES, GRADE_LABELS, TAXONOMY } from "@zhiyouji/shared";
import type { DailyReviewRequest, ScoreRequest, SummaryRequest, SupplyScoreRequest } from "./ai.js";
import { CHILD_CONTENT_RULE, childContent } from "./aiGuard.js";

export interface AiMessages {
  /** Instructions: template + child-content rule + answer format. */
  system: string;
  /** The material. */
  user: string;
  /** Picture URLs (short-lived signed links), in order. */
  images: string[];
}

export type PromptTask = "daily_review" | "work_score" | "supply_score" | "summary" | "season_review";

/**
 * Version 0: the machine's first draft (part 6 §4.2: the real wording is fixed
 * before the small calibration and saved in the admin console as version 1, 2 …).
 */
export const BUILTIN_PROMPTS: Readonly<Record<PromptTask, string>> = {
  daily_review: [
    "你在审核一个 7–15 岁孩子的每日学习记录。孩子用证据图片和一段讲解（录音转写或文字）说明今天学到了什么。",
    "只判断三件事：讲解和证据是同一件事；孩子是在用自己的话解释，而不是照抄；没有不当内容。不要因为讲得浅、讲得短就不通过。",
    "给孩子的反馈像一位有学识的大学生：客观、具体、有批判性，具体到孩子这次的内容；不要用卡通角色或“土地公”的口吻；低年级用词更简单。",
    "通过时也要写一句“做得好的”和一句“可以更好的”；不通过时写清楚原因和改法。",
    "知识卡片的标题不超过 15 个字，摘要 2–3 句，只写孩子讲到的内容，尽量用孩子自己的例子，不要替孩子补充知识。",
    "表达档 0–4：0 没讲清，1 照抄或像 AI 写的，2 讲清了是什么，3 讲清了为什么，4 有自己的例子并讲清了原来哪里不懂。人机协作档 0–4：孩子说清了用了什么 AI、AI 做了什么、自己改了什么、发现 AI 哪里不对，说得越全档越高；孩子选了“没用 AI”时为 null。",
    "难度级 1–6 对应小学低年级、小学高年级、初中、高中、大学、研究前沿。",
  ].join("\n"),
  work_score: [
    "你在给一个混龄小组（7–15 岁）的团队作品打初评分，复核员会在你的基础上修改。",
    "每件作品单独打绝对分，不和别的作品比较。按评分族的每个维度打分，并给每个维度写一两句理由：哪里做得好、哪里扣了分、下次怎么改。",
    "评语像一位有学识的大学生给出的正常反馈：客观、具体、有批判性，不用卡通角色的口吻。",
    "受众很重要：看题目指定的受众能不能听懂。",
    "50 分是“认真但普通的作品”；锚点见下文。",
    "标记（flags）只在有把握时写：疑似完全没讲明白、和题目无关、内容不安全。",
    "同时给出作品的知识标签（1–3 个“学科/子领域”）和难度级 1–6。",
  ].join("\n"),
  supply_score: [
    "你在给一个小组的军需任务打分：每个组员各交了一份，组长交了一份小结。",
    "内容质量 0–40：组员的内容是否切题、准确、有自己的思考（不看交了几份，参与面由系统另算）。",
    "小组总结 0–20：有没有把大家的内容整合起来、得出结论；没有小结时为 0。",
    "评语客观、具体，写哪里好、哪里可以改。",
  ].join("\n"),
  summary: [
    "根据孩子这段时间记下的知识卡片，写一段给孩子看的回顾（3–5 句）。",
    "只写卡片里孩子讲到的内容，不替孩子补充知识；具体提到一两张卡片；最后给一个下一步可以探索的方向。",
    "语气像一位有学识的大学生：真诚、具体，不夸张，不用卡通角色的口吻；低年级用词更简单。",
  ].join("\n"),
  season_review: [
    "根据孩子这一季的知识卡片和署名的团队作品，写赛季回顾页面上的一段文字（5–8 句）。",
    "只写孩子讲到、做过的内容；说出这一季走进了哪些学科、最难的是什么、和小组一起做成了什么；最后给一个下一季可以探索的方向。",
    "语气像一位有学识的大学生：真诚、具体，不夸张，不用卡通角色的口吻；低年级用词更简单。",
  ].join("\n"),
};

/** The answer format is fixed by the code (the checks in `aiValidate.ts` depend on it). */
const FORMATS: Readonly<Record<PromptTask, string>> = {
  daily_review:
    '只输出一个 JSON 对象：{"passed": true/false, "failReason": "不通过时的原因和改法，通过时为 null", "feedbackGood": "做得好的：……", "feedbackBetter": "可以更好的：……", "expression": 0-4, "aiLevel": 0-4 或 null, "aiTone": true/false, "mainTag": "学科/子领域", "subTag": "学科/子领域" 或 null, "difficulty": 1-6, "card": {"title": "≤15 字", "summary": "2–3 句"}, "flags": []}',
  work_score:
    '只输出一个 JSON 对象：{"total": 各维度之和, "dims": [{"key": "维度代号", "score": 整数, "reason": "一两句理由"}], "comment": "总评", "flags": [], "tags": ["学科/子领域"], "difficulty": 1-6}',
  supply_score: '只输出一个 JSON 对象：{"quality": 0-40, "summary": 0-20, "comment": "评语", "flags": []}',
  summary: '只输出一个 JSON 对象：{"text": "回顾的文字"}',
  season_review: '只输出一个 JSON 对象：{"text": "回顾的文字"}',
};

const TAXONOMY_TEXT = Object.entries(TAXONOMY)
  .map(([s, subs]) => `${s}：${subs.join("、")}`)
  .join("\n");

function system(task: PromptTask, template: string, opts: { children: boolean; taxonomy: boolean }): string {
  return [
    template.trim(),
    opts.children ? CHILD_CONTENT_RULE : null,
    opts.taxonomy ? `知识分类表（标签写成“学科/子领域”；都不合适时写“其他/建议的名称”）：\n${TAXONOMY_TEXT}` : null,
    FORMATS[task],
  ]
    .filter(Boolean)
    .join("\n\n");
}

const grade = (g: number) => GRADE_LABELS[g] ?? `${g} 年级`;
const lines = (...xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => !!x).join("\n");

export function dailyMessages(r: DailyReviewRequest, template: string): AiMessages {
  const tpl = DAILY_TEMPLATES.find((t) => t.id === r.templateId);
  return {
    system: system("daily_review", template, { children: true, taxonomy: true }),
    user: lines(
      `模板：${r.templateName}`,
      `模板的问题：${r.templatePrompt ?? tpl?.prompt ?? ""}`,
      `应有的证据：${r.evidenceExpected ?? tpl?.evidence ?? ""}（孩子传了 ${r.evidenceCount} 张，见图片）`,
      `孩子的年级：${grade(r.grade)}`,
      r.explainText ? childContent("文字讲解", r.explainText) : null,
      r.transcript ? childContent("讲解录音的转写", r.transcript) : null,
      r.noAi ? "人机协作：孩子选了“没用 AI”。" : childContent("人机协作说明", r.aiNote),
    ),
    images: r.evidenceImages ?? [],
  };
}

export function workMessages(r: ScoreRequest, template: string): AiMessages {
  const t = r.task;
  const d = r.debate;
  return {
    system: system("work_score", template, { children: true, taxonomy: true }),
    user: lines(
      t?.landName ? `地块：${t.landName}` : null,
      `题目：${t?.title ?? "（无）"}`,
      t?.body ? `题目说明：${t.body}` : null,
      `受众：${t?.audience ?? "一个没学过这个知识的初中生或普通成年人"}`,
      t?.questionType ? `题型：${t.questionType}` : null,
      r.subject ? `所属学科：${r.subject}` : null,
      `评分族 ${r.rubric.id}（${r.rubric.name}，第 ${r.rubric.version} 版），维度：${r.rubric.dims.map((x) => `${x.key} ${x.name} ${x.max} 分`).join("；")}`,
      r.anchors ? `50 分的样子：${r.anchors.at50}\n75 分的样子：${r.anchors.at75}` : null,
      `作品形式：${r.mediaKind}${r.images?.length ? `（${r.images.length} 张图片或视频关键帧，见图片）` : ""}`,
      d?.noDefender ? "辩论：守方没有迎战（没交立论），进攻方要自己列出对方最可能说的 2 个论点并反驳。" : null,
      d?.opening ? childContent("本组的立论", lines(d.opening.text, d.opening.transcript)) : null,
      ...(d?.otherSide ?? []).map((o, i) => childContent(`对方的立论 ${i + 1}`, lines(o.text, o.transcript))),
      r.text ? childContent(d ? "驳论 / 作品文字" : "作品文字", r.text) : null,
      r.transcript ? childContent("视频或音频的转写", r.transcript) : null,
      childContent("人机协作说明", r.aiNote),
    ),
    images: r.images ?? [],
  };
}

export function supplyMessages(r: SupplyScoreRequest, template: string): AiMessages {
  return {
    system: system("supply_score", template, { children: true, taxonomy: false }),
    user: lines(
      `题目：${r.task.title}`,
      `每人要交：${r.task.perPerson}`,
      `小结要求：${r.task.summary}`,
      ...r.entries.map((e, i) => childContent(`组员 ${i + 1}`, e)),
      r.summary ? childContent("组长的小结", r.summary) : "（没有小结）",
    ),
    images: [],
  };
}

export function summaryMessages(r: SummaryRequest, template: string): AiMessages {
  const task: PromptTask = r.kind === "season" ? "season_review" : "summary";
  const period = r.kind === "week" ? "这一周" : r.kind === "month" ? "这个月" : "这一季";
  return {
    // knowledge cards are the AI's own summaries of what the child said: still the child's material
    system: system(task, template, { children: true, taxonomy: false }),
    user: lines(
      `时间段：${period}`,
      `孩子的年级：${grade(r.grade)}`,
      r.cards.length
        ? childContent(
            "知识卡片",
            r.cards.map((c, i) => `${i + 1}. ${c.title}（${c.tag ?? "未分类"}${c.crossing !== null ? `，跨越度 ${c.crossing}` : ""}）：${c.summary}`).join("\n"),
          )
        : "（这段时间没有知识卡片）",
      r.works?.length ? childContent("署名的团队作品", r.works.map((w, i) => `${i + 1}. ${w.title ?? "（无题）"}（${w.kind}${w.tags.length ? `，${w.tags.join("、")}` : ""}）`).join("\n")) : null,
    ),
    images: [],
  };
}
