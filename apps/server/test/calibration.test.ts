import { describe, expect, it } from "vitest";
import { aiCalls } from "@zhiyouji/db";
import type { FakeAiScorer } from "../src/ai.js";
import { bj, setup } from "./helpers.js";

const A = (accuracy: number, teach: number, depth: number, presentation: number, ai: number) => ({ accuracy, teach, depth, presentation, ai });

describe("校准 (part 7 §4; part 6 §4.1)", () => {
  it("samples scored on their own by two people and by two AI set-ups; the report by family against the ±8 goal", async () => {
    const t = await setup(bj("2027-01-20", 10));
    const boss = await t.adminUser();
    const rev = await t.adminUser("rev@example.com", "reviewer");
    const s1 = (await t.call("POST", "/v1/admin/calibration/samples", { title: "S2 第 3 组 火焰山", family: "A", taskTitle: "为什么火焰山这么热", text: "火焰山热是因为盆地地势低……" }, boss.token)).json().sample;
    const s2 = (await t.call("POST", "/v1/admin/calibration/samples", { title: "S2 第 5 组 通天河", family: "A", taskTitle: "为什么河面会结冰", mediaKind: "video", text: "（视频转写）水在 4 度时最重……" }, boss.token)).json().sample;
    expect((await t.call("POST", "/v1/admin/calibration/samples", { title: "x", family: "A", taskTitle: "x", text: "x" }, rev.token)).statusCode).toBe(403);

    // each person sees only their own scores
    await t.call("POST", `/v1/admin/calibration/samples/${s1.id}/score`, { dims: A(20, 25, 15, 5, 5) }, boss.token); // 70
    await t.call("POST", `/v1/admin/calibration/samples/${s2.id}/score`, { dims: A(15, 20, 10, 5, 5) }, boss.token); // 55
    expect((await t.call("GET", "/v1/admin/calibration/samples", undefined, rev.token)).json().samples.map((s: { mine: unknown }) => s.mine)).toEqual([null, null]);
    await t.call("POST", `/v1/admin/calibration/samples/${s1.id}/score`, { dims: A(20, 20, 15, 5, 0) }, rev.token); // 60
    await t.call("POST", `/v1/admin/calibration/samples/${s2.id}/score`, { dims: A(15, 20, 10, 5, 5) }, rev.token); // 55
    expect((await t.call("POST", `/v1/admin/calibration/samples/${s1.id}/score`, { dims: A(26, 20, 15, 5, 0) }, rev.token)).json().error).toBe("bad_dims");

    // the live set-up, and a draft prompt on another model (a trial in the AI log)
    const ai = t.services.ai as FakeAiScorer;
    ai.fixed.set(s1.id, 75);
    ai.fixed.set(s2.id, 50);
    expect((await t.call("POST", "/v1/admin/calibration/run", { label: "正式配置" }, boss.token)).json()).toEqual({ scored: 2, failed: [] });
    ai.fixed.set(s1.id, 66);
    ai.fixed.set(s2.id, 56);
    await t.call("POST", "/v1/admin/calibration/run", { label: "qwen-max · 草稿", model: "qwen-max", prompt: "更严格地看受众", family: "A" }, boss.token);
    expect((await t.db.select().from(aiCalls)).filter((c) => c.role === "trial" && c.model === "qwen-max")).toHaveLength(2);

    const a = (await t.call("GET", "/v1/admin/calibration/report", undefined, boss.token)).json().families.find((f: { family: string }) => f.family === "A");
    // people: s1 mean 65 (70, 60), s2 mean 55; people differ by 10 and 0 → 5
    expect(a).toMatchObject({ samples: 2, scoredByPeople: 2, people: 2, peopleGap: 5 });
    expect(a.ai).toEqual([
      // 75−65 = +10, 50−55 = −5 → mean +2.5, |gap| 7.5
      { label: "正式配置", compared: 2, aiMinusPeople: 2.5, absGap: 7.5, withinGoal: true },
      // 66−65 = +1, 56−55 = +1
      { label: "qwen-max · 草稿", compared: 2, aiMinusPeople: 1, absGap: 1, withinGoal: true },
    ]);
    expect((await t.call("GET", "/v1/admin/calibration/report", undefined, rev.token)).statusCode).toBe(403);
    await t.close();
  });
});
