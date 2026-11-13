/**
 * 土地公的 7 个问题 (content library §10.2; PRD part 5 A4). Questions 1–2
 * (nickname, avatar, grade) are the child profile; this is questions 3–7.
 */

import { z } from "zod";

export const SURVEY_VERSION = "v0.3";

/** 好奇心大冒险: 16 questions, one subject each. */
export const CURIOSITY_QUESTIONS = [
  { id: "q1", text: "宇宙有多大？宇宙外面是什么？", subject: "物理与天文" },
  { id: "q2", text: "为什么烟花会有不同的颜色？", subject: "化学与材料" },
  { id: "q3", text: "生命最早是怎么出现的？", subject: "生命科学" },
  { id: "q4", text: "人为什么会做梦？", subject: "医学与健康" },
  { id: "q5", text: "恐龙是怎么灭绝的？", subject: "地球与环境" },
  { id: "q6", text: "AI 会不会有一天比人还聪明？", subject: "工程与计算机" },
  { id: "q7", text: "摩天大楼为什么不会倒？", subject: "工程与计算机" },
  { id: "q8", text: "为什么有的国家很富，有的国家很穷？", subject: "经济与管理" },
  { id: "q9", text: "国家之间为什么会打仗？", subject: "政治、法律与国际关系" },
  { id: "q10", text: "一条法律是怎么诞生的？", subject: "政治、法律与国际关系" },
  { id: "q11", text: "为什么人会相信谣言？", subject: "社会、心理与传播" },
  { id: "q12", text: "古罗马为什么会灭亡？", subject: "历史与考古" },
  { id: "q13", text: "什么是“对”，什么是“错”，谁说了算？", subject: "哲学与思维" },
  { id: "q14", text: "为什么不同地方的人说不同的话？", subject: "语言与文学" },
  { id: "q15", text: "一首曲子为什么能让人想哭？", subject: "艺术与设计" },
  { id: "q16", text: "数学是人发明的，还是本来就存在的？", subject: "数学" },
] as const;

export const HOBBIES = ["画画", "手工", "乐器和唱歌", "跳舞", "球类", "跑跳和户外", "下棋和桌游", "电子游戏", "编程和机器人", "做实验", "看书", "写故事", "看动画和电影", "做饭和烘焙", "拍照和剪视频", "学外语", "解谜和数独", "养小动物", "做小生意", "其他"] as const;
export const AI_USES = ["问问题", "学新东西", "写作业", "讲故事", "画画", "学英语", "编程", "陪我聊天"] as const;

/** 游戏风格 (Q6): the four cards, matching the engine's grouping styles. */
export const PLAY_STYLES = [
  { id: "fighter", text: "冲在最前面打 BOSS 的" },
  { id: "strategist", text: "研究地图和攻略的" },
  { id: "healer", text: "给队友加血的" },
  { id: "builder", text: "在自己的地盘慢慢建设的" },
] as const;

const qid = z.enum(CURIOSITY_QUESTIONS.map((q) => q.id) as [string, ...string[]]);

export const surveySubmit = z.object({
  curiosity: z.object({
    /** 8 rounds: [shown, shown, chosen]. */
    rounds: z.array(z.tuple([qid, qid, qid])).length(8),
    final: qid,
  }),
  ownQuestion: z.string().trim().max(200).optional(),
  hobbies: z.array(z.enum(HOBBIES)).max(5),
  ai: z.object({ experience: z.enum(["never", "few", "often"]), uses: z.array(z.enum(AI_USES)).max(8).default([]) }),
  style: z.enum(["fighter", "strategist", "healer", "builder"]),
  /** 讲一讲 + 30 秒挑战; null = skipped (voice by default). */
  challenge: z
    .discriminatedUnion("kind", [z.object({ kind: z.literal("voice"), fileId: z.uuid() }), z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(500) })])
    .nullable(),
});
export type SurveySubmit = z.infer<typeof surveySubmit>;

/**
 * 好奇分 per subject (content library 10.3): chosen in a round +1, in the final
 * round +1, the final pick +2.
 */
export function curiosityScores(c: SurveySubmit["curiosity"]): Record<string, number> {
  const subject = new Map<string, string>(CURIOSITY_QUESTIONS.map((q) => [q.id, q.subject]));
  const out: Record<string, number> = {};
  const add = (id: string, n: number) => {
    const s = subject.get(id)!;
    out[s] = (out[s] ?? 0) + n;
  };
  for (const [, , chosen] of c.rounds) {
    add(chosen, 1); // chosen in its round
    add(chosen, 1); // so it is in the final round
  }
  add(c.final, 2);
  return out;
}
