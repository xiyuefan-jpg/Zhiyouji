import { describe, expect, it } from "vitest";
import { containment, mostSimilar, normalizeForSimilarity, pieces, SIMILARITY } from "../src/season/similarity.js";

const ORIGINAL =
  "火焰山之所以这么热，是因为吐鲁番盆地的地势很低，四周的山挡住了冷空气，太阳照下来的热量散不出去。再加上红色的砂岩吸收热量很快，白天地表温度可以超过七十度，所以看起来就像山在燃烧一样。";

describe("疑似抄袭本服其他作品 (part 6 §4.5)", () => {
  it("spaces and punctuation do not matter; pieces are 5 characters", () => {
    expect(normalizeForSimilarity("火焰山，  为什么？Hot!")).toBe("火焰山为什么hot");
    expect([...pieces("一二三四五六")]).toEqual(["一二三四五", "二三四五六"]);
  });

  it("a copy with a few words changed is flagged; the same topic in other words is not", () => {
    const copy = ORIGINAL.replace("这么热", "特别热").replace("七十度", "70 度").replace("所以", "因此");
    const own =
      "我们做了一个实验：把黑色和白色的纸放在太阳下，黑纸更快变热。火焰山的石头是红色的，也很会吸热。吐鲁番在盆地里，热空气跑不出去，就越来越热，夏天能到四十多度。";
    const a = pieces(copy);
    expect(containment(a, pieces(ORIGINAL))).toBeGreaterThan(SIMILARITY.flagAt);
    expect(containment(pieces(own), pieces(ORIGINAL))).toBeLessThan(0.2);
    const best = mostSimilar(copy, [
      { id: "own", words: own },
      { id: "orig", words: ORIGINAL },
    ]);
    expect(best?.other.id).toBe("orig");
    expect(mostSimilar(own, [{ id: "orig", words: ORIGINAL }])).toBeNull();
  });

  it("short works are not compared (a title or one sentence says nothing)", () => {
    expect(mostSimilar("火焰山为什么这么热", [{ id: "x", words: "火焰山为什么这么热" }])).toBeNull();
  });
});
