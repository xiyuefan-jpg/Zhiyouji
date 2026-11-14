/**
 * 赛季回顾 saved as one picture (PRD part 5 §4.1): drawn on a canvas in the
 * site's colours, nickname only (never a real name), no scholarship amount
 * (the picture is meant to be shared). In WeChat the picture is long-pressed
 * to save; elsewhere it downloads.
 */

export interface ReviewContent {
  text: string;
  team: string;
  rank: number | null;
  highlights?: string[];
  map: Record<string, number>;
  hardest: { title: string; tag: string | null; crossing: number | null } | null;
  works: { kind: string; land?: string | null; subject?: string | null; result?: string | null }[];
  numbers: { dailyTasks: number; cards: number; works: number; aboveGrade: number };
}

export const WORK_KIND: Record<string, string> = { contest: "区域争夺", war: "周战争", line: "大团战战线", main: "大团战主战场" };

export type Block = { kind: "season" | "title" | "who" | "heading" | "body" | "footer"; text: string };

/** What goes on the picture, top to bottom (kept separate from drawing so it can be tested). */
export function reviewBlocks(season: string, nickname: string, c: ReviewContent): Block[] {
  const out: Block[] = [
    { kind: "season", text: season },
    { kind: "title", text: "这一季我带走了什么" },
    { kind: "who", text: `${nickname} · ${c.team}` },
    { kind: "body", text: c.text },
  ];
  const subjects = Object.entries(c.map).sort((a, b) => b[1] - a[1]);
  out.push({ kind: "heading", text: "我的探索地图" }, { kind: "body", text: subjects.length ? `探索了${subjects.map(([k, v]) => `${k}（${v} 次）`).join("、")}` : "这一季还没有知识卡片。" });
  if (c.hardest) {
    const crossing = c.hardest.crossing && c.hardest.crossing > 0 ? `，比我的年级高 ${c.hardest.crossing} 级` : "";
    out.push({ kind: "heading", text: "我讲明白过的最难的知识" }, { kind: "body", text: `${c.hardest.title}${c.hardest.tag ? `（${c.hardest.tag.replace("/", " · ")}）` : ""}${crossing}` });
  }
  out.push({ kind: "heading", text: "小组" }, { kind: "body", text: `${c.team}${c.rank ? `，最终第 ${c.rank} 名` : ""}${c.highlights?.length ? `。${c.highlights.join("、")}` : ""}` });
  if (c.works.length) {
    const shown = c.works.slice(0, 6).map((w) => [WORK_KIND[w.kind] ?? w.kind, w.land, w.result].filter(Boolean).join(" · "));
    if (c.works.length > shown.length) shown.push(`还有 ${c.works.length - shown.length} 件`);
    out.push({ kind: "heading", text: "我参与的作品" }, ...shown.map((text) => ({ kind: "body" as const, text })));
  }
  out.push(
    { kind: "heading", text: "数字" },
    { kind: "body", text: `每日任务 ${c.numbers.dailyTasks} 次 · 知识卡片 ${c.numbers.cards} 张 · 团队作品 ${c.numbers.works} 件${c.numbers.aboveGrade ? ` · 超出年级的知识 ${c.numbers.aboveGrade} 张` : ""}` },
    { kind: "footer", text: "智游记 · 用 AI 学，再把它讲明白" },
  );
  return out;
}

const W = 750;
const PAD = 56;
const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif';
const SANS = '-apple-system, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const STYLE: Record<Block["kind"], { font: string; color: string; line: number; before: number }> = {
  season: { font: `28px ${SANS}`, color: "#6b5a4c", line: 40, before: 0 },
  title: { font: `bold 52px ${SERIF}`, color: "#2a211c", line: 70, before: 6 },
  who: { font: `30px ${SANS}`, color: "#a93a2a", line: 44, before: 10 },
  heading: { font: `bold 32px ${SERIF}`, color: "#8c2e21", line: 46, before: 30 },
  body: { font: `29px ${SANS}`, color: "#2a211c", line: 44, before: 6 },
  footer: { font: `24px ${SANS}`, color: "#9c6b43", line: 36, before: 40 },
};

/** Split text into lines that fit `width` (character by character: Chinese has no spaces). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(cur);
      cur = "";
      continue;
    }
    if (cur && ctx.measureText(cur + ch).width > width) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** The picture as a PNG data URL. */
export function drawReviewImage(blocks: Block[]): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  const inner = W - PAD * 2;
  // first pass: layout
  const laid = blocks.map((b) => {
    ctx.font = STYLE[b.kind].font;
    return { b, lines: wrap(ctx, b.text, inner) };
  });
  const height = PAD + laid.reduce((h, x) => h + STYLE[x.b.kind].before + x.lines.length * STYLE[x.b.kind].line, 0) + PAD;
  canvas.width = W;
  canvas.height = height;
  // paper and a vermilion frame
  ctx.fillStyle = "#fbf4ea";
  ctx.fillRect(0, 0, W, height);
  ctx.strokeStyle = "#a93a2a";
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, W - 40, height - 40);
  ctx.strokeStyle = "#e2cdb0";
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, W - 60, height - 60);
  let y = PAD;
  ctx.textBaseline = "top";
  for (const { b, lines } of laid) {
    const st = STYLE[b.kind];
    y += st.before;
    ctx.font = st.font;
    ctx.fillStyle = st.color;
    for (const l of lines) {
      ctx.fillText(l, PAD, y + (st.line - parseInt(st.font.replace(/^bold /, ""), 10)) / 2);
      y += st.line;
    }
  }
  return canvas.toDataURL("image/png");
}
