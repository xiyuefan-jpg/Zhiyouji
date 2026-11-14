import { describe, expect, it } from "vitest";
import { reviewBlocks } from "../src/pages/reviewImage";

describe("赛季回顾 picture (PRD part 5 §4.1)", () => {
  const content = {
    text: "这一季你记下了 12 张知识卡片。",
    team: "高老庄",
    rank: 3,
    highlights: ["夺下 2 块地", "周战争赢了 1 场"],
    map: { 物理: 2, "政治与国际关系": 5 },
    hardest: { title: "现实主义", tag: "政治与国际关系/国际关系理论", crossing: 6 },
    works: Array.from({ length: 8 }, (_, i) => ({ kind: i ? "war" : "contest", land: i ? null : "车迟国", result: i ? "赢了" : "守住了" })),
    numbers: { dailyTasks: 20, cards: 12, works: 8, aboveGrade: 4 },
  };

  it("nickname only, the knowledge first, at most six works, no scholarship", () => {
    const blocks = reviewBlocks("S3", "小满", { ...content, scholarshipYuan: 860 } as typeof content);
    const all = blocks.map((b) => b.text).join("\n");
    expect(blocks[2]).toEqual({ kind: "who", text: "小满 · 高老庄" });
    expect(all).toContain("探索了政治与国际关系（5 次）、物理（2 次）");
    expect(all).toContain("现实主义（政治与国际关系 · 国际关系理论），比我的年级高 6 级");
    expect(all).toContain("高老庄，最终第 3 名。夺下 2 块地、周战争赢了 1 场");
    expect(all).toContain("区域争夺 · 车迟国 · 守住了");
    expect(all).toContain("还有 2 件");
    expect(all).not.toMatch(/元|奖学金/);
    expect(all).not.toContain("游戏");
  });

  it("a child with no cards gets a plain line, not an empty map", () => {
    const all = reviewBlocks("S3", "小满", { ...content, map: {}, hardest: null, works: [] }).map((b) => b.text);
    expect(all).toContain("这一季还没有知识卡片。");
    expect(all).not.toContain("我参与的作品");
    expect(all).not.toContain("我讲明白过的最难的知识");
  });
});
