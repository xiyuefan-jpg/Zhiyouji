/**
 * Rubric families A–E (content library §3): dimensions and points. The real
 * wording, anchors and prompt texts are edited in the admin console later
 * (PRD part 6 §4.2); this is the machine's default copy.
 */

export type RubricId = "A" | "B" | "C" | "D" | "E";

export interface Rubric {
  id: RubricId;
  name: string;
  version: number;
  dims: { key: string; name: string; max: number }[];
}

/**
 * What each dimension looks at and the 50 / 75 point lines (content library §3),
 * shown to the team before they make the work and to the reviewer while scoring.
 */
export const RUBRIC_GUIDE: Readonly<Record<RubricId, { hints: Record<string, string>; at50: string; at75: string }>> = {
  A: {
    hints: {
      accuracy: "原理讲对，没有知识错误",
      teach: "题目指定的受众能不能听懂：用对方懂的话和熟悉的例子，顺序清楚",
      depth: "讲到了第几层“为什么”；能不能联系到别的现象",
      presentation: "形式不限（真人讲、AI 视频、动画都可以）；自己设计的演示、巧妙的比喻加分",
      ai: "人机协作说明：用了什么 AI、AI 做了什么、你们改了什么、发现 AI 哪里不对",
    },
    at50: "说清了“这个现象是因为某个原理”，有一个演示或例子，没有明显错误。",
    at75: "在 50 分的基础上，讲清了原理为什么会导致这个现象（至少两层“为什么”），用了一个让受众一听就懂的例子或演示，还举出了同一原理的另一个现象。",
  },
  B: {
    hints: {
      claim: "立场清楚，一句话能说出来",
      argument: "理由和证据（文本、史料、数据、事例）能不能撑住观点",
      response: "辩论区：驳论有没有打中对方要害；其他区：有没有主动回应一个反方观点",
      reality: "和今天的世界有没有真实联系",
      ai: "人机协作说明：用了什么 AI、AI 做了什么、你们改了什么、发现 AI 哪里不对",
    },
    at50: "立场清楚，有 2 个理由，每个理由都有一个例子。",
    at75: "理由之间有层次，证据具体可查，能指出对方最强的论点并回应。",
  },
  C: {
    hints: {
      problem: "问题真实存在，说得出发生在哪里、影响了谁",
      solution: "讲清楚怎么做、为什么可能有效、怎么判断有没有用",
      constraints: "题目里的条件和收到的词条",
      novelty: "和原来的做法相比改变了什么",
      clarity: "受众能不能看懂这个方案",
      ai: "人机协作说明：用了什么 AI、AI 做了什么、你们改了什么、发现 AI 哪里不对",
    },
    at50: "问题真实，方案说清了怎么做，没有违反约束。",
    at75: "做出了原型并真实试用一次，说明了怎么判断方案有没有用，还有一个别人没想到的点子。",
  },
  D: {
    hints: {
      design: "比较什么、控制什么、重复几次",
      evidence: "过程照片或视频、数据记录",
      conclusion: "能不能下结论，哪里还不确定",
      clarity: "受众能不能看懂",
      ai: "人机协作说明：用了什么 AI、AI 做了什么、你们改了什么、发现 AI 哪里不对",
    },
    at50: "做了一次真实的对比实验，有过程照片，给出了结论。",
    at75: "控制了至少一个变量，重复了实验，并诚实说出了局限。",
  },
  E: {
    hints: {
      division: "AI 做了什么，人做了什么",
      verify: "找到 AI 的错误或局限，并用 AI 以外的方法核实（查书、问人、实测）",
      result: "改进后的成果是否比 AI 原稿更好",
      reflection: "下次怎么用 AI",
      record: "核实过程的记录",
    },
    at50: "找到 AI 的 1 处错误，并说明是怎么发现的。",
    at75: "找到 2 处以上，用 AI 以外的方法核实，并据此改进了最终成果。",
  },
};

/** A rubric with its guide, as the team page and the reviewer page show it. */
export function rubricWithGuide(id: RubricId) {
  const r = RUBRICS[id];
  const g = RUBRIC_GUIDE[id];
  return { id: r.id, name: r.name, dims: r.dims.map((d) => ({ ...d, hint: g.hints[d.key] ?? "" })), at50: g.at50, at75: g.at75 };
}

/** What a team work must look like (content library §2; debates §4.2). Shown, not enforced (part 3 §20.6). */
export function workRequirements(kind: string, stage?: "opening" | "rebuttal" | null): string {
  if (stage === "opening") return "立论：每组 ≤3 分钟音频或视频，或 ≤800 字图文。";
  if (stage === "rebuttal") return "驳论：每组 ≤2 分钟或 ≤400 字，必须点名回应对方至少 2 个论点。";
  return kind === "supply" ? "只交文字和图片。" : "主体三选一：视频 ≤5 分钟、音频 ≤5 分钟、图文（PDF 或长图，≤10 页）。另附人机协作说明（≤100 字）。";
}

export const RUBRICS: Readonly<Record<RubricId, Rubric>> = {
  A: {
    id: "A",
    name: "现象解释",
    version: 1,
    dims: [
      { key: "accuracy", name: "准确", max: 25 },
      { key: "teach", name: "教会受众", max: 30 },
      { key: "depth", name: "深度", max: 25 },
      { key: "presentation", name: "呈现与创意", max: 10 },
      { key: "ai", name: "人机协作", max: 10 },
    ],
  },
  B: {
    id: "B",
    name: "思辨",
    version: 1,
    dims: [
      { key: "claim", name: "观点", max: 20 },
      { key: "argument", name: "论证", max: 30 },
      { key: "response", name: "回应", max: 25 },
      { key: "reality", name: "联系现实", max: 15 },
      { key: "ai", name: "人机协作", max: 10 },
    ],
  },
  C: {
    id: "C",
    name: "设计创造",
    version: 1,
    dims: [
      { key: "problem", name: "问题真实、具体", max: 20 },
      { key: "solution", name: "方案有效、可行", max: 25 },
      { key: "constraints", name: "遵守约束", max: 20 },
      { key: "novelty", name: "创新", max: 15 },
      { key: "clarity", name: "讲清楚", max: 10 },
      { key: "ai", name: "人机协作", max: 10 },
    ],
  },
  D: {
    id: "D",
    name: "探究",
    version: 1,
    dims: [
      { key: "design", name: "实验设计", max: 30 },
      { key: "evidence", name: "真实证据", max: 30 },
      { key: "conclusion", name: "结论与局限", max: 20 },
      { key: "clarity", name: "讲清楚", max: 10 },
      { key: "ai", name: "人机协作", max: 10 },
    ],
  },
  E: {
    id: "E",
    name: "人机协作",
    version: 1,
    dims: [
      { key: "division", name: "分工清楚", max: 20 },
      { key: "verify", name: "找错与验证", max: 35 },
      { key: "result", name: "最终成果", max: 25 },
      { key: "reflection", name: "反思", max: 10 },
      { key: "record", name: "核实证据", max: 10 },
    ],
  },
};

/** Land names → rubric (content library 4.0). */
export const LAND_RUBRIC: Readonly<Record<string, RubricId>> = {
  大唐长安城: "B",
  五行山: "A",
  火焰山: "A",
  兜率宫: "A",
  五庄观: "A",
  通天河: "A",
  朱紫国: "B",
  车迟国: "B",
  谛听台: "E",
  小雷音寺: "D",
  盘丝洞: "B",
  女儿国: "C",
};

/** Rubric for a work: contests by land, weekly wars C (PRD part 3 §11), big battle C until its themes are written. */
export function rubricFor(kind: string, landName: string | null): RubricId {
  if (kind === "contest") return (landName && LAND_RUBRIC[landName]) || "A";
  return "C";
}

/** Score (0–100) is valid for a rubric's dimensions. */
export function checkDims(r: Rubric, dims: Record<string, number>): boolean {
  return r.dims.every((d) => Number.isInteger(dims[d.key]) && dims[d.key]! >= 0 && dims[d.key]! <= d.max) && Object.keys(dims).length === r.dims.length;
}
