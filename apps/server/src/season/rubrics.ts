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
