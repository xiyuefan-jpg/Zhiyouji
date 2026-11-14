import { describe, expect, it } from "vitest";
import { aiCalls } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";

describe("AI gateway (part 2 §4.6; part 6 §5, §9)", () => {
  it("logs every call; falls back once when the primary fails; runs the shadow model on the side", async () => {
    const t = await setup(bj("2027-03-10", 10));
    const g = t.services.gateway;
    expect((await g.config("daily_review")).model).toBe("fake-daily");
    const boss = await t.adminUser();
    const put = await t.call("PUT", "/v1/admin/ai/config/daily_review", { provider: "aliyun", model: "qwen-vl-max", fallbackProvider: "volc", fallbackModel: "doubao-vision", shadowModel: "qwen-vl-plus" }, boss.token);
    expect(put.json()).toMatchObject({ model: "qwen-vl-max", fallbackModel: "doubao-vision" });

    const calls: string[] = [];
    const out = await g.call("daily_review", { x: 1 }, async (model) => {
      calls.push(model);
      if (model === "qwen-vl-max") throw new Error("timeout");
      return { ok: model };
    });
    expect(out).toEqual({ ok: "doubao-vision" });
    expect(calls).toEqual(["qwen-vl-max", "doubao-vision"]);
    // a good primary call also runs the shadow model, whose answer is only logged
    expect(await g.call("daily_review", { x: 2 }, async (model) => (model === "qwen-vl-plus" ? { shadow: true } : { main: true }))).toEqual({ main: true });
    const log = await t.db.select().from(aiCalls);
    expect(log.map((r) => [r.role, r.model, r.status])).toEqual([
      ["primary", "qwen-vl-max", "error"],
      ["fallback", "doubao-vision", "ok"],
      ["primary", "qwen-vl-max", "ok"],
      ["shadow", "qwen-vl-plus", "ok"],
    ]);
    // both failing: the error comes back to the caller
    await expect(g.call("daily_review", {}, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");

    const stats = (await t.call("GET", `/v1/admin/ai/stats?from=${bj("2027-03-10", 0).toISOString()}&to=${bj("2027-03-11", 0).toISOString()}`, undefined, boss.token)).json();
    const primary = stats.byTaskAndModel.find((x: { model: string; role: string }) => x.model === "qwen-vl-max" && x.role === "primary");
    expect(primary).toMatchObject({ calls: 3, errors: 2 });

    // prompt versions are added, never overwritten
    await t.call("POST", "/v1/admin/ai/prompts/daily_review", { content: "你是一位审核员……", note: "初版" }, boss.token);
    await t.call("POST", "/v1/admin/ai/prompts/daily_review", { content: "你是一位审核员（改）……" }, boss.token);
    expect((await t.call("GET", "/v1/admin/ai/prompts/daily_review", undefined, boss.token)).json().prompts.map((p: { version: number }) => p.version)).toEqual([2, 1]);
    await t.close();
  });

  it("an answer in the wrong format counts as a failure: the fallback model is asked, the call log says why (part 6 §3)", async () => {
    const t = await setup(bj("2027-03-10", 10));
    const g = t.services.gateway;
    const boss = await t.adminUser();
    await t.call("PUT", "/v1/admin/ai/config/daily_review", { provider: "aliyun", model: "m1", fallbackModel: "m2" }, boss.token);
    const good = { model: "x", passed: true, failReason: null, feedbackGood: "好", feedbackBetter: "更好", expression: 3, aiLevel: 2, aiTone: false, mainTag: "数学/几何与空间", subTag: null, difficulty: 3, card: { title: "三角形", summary: "三角形很稳。" } };
    const models: string[] = [];
    const reviewer = g.wrapDaily({
      reviewDaily: async (_r, opts) => {
        models.push(opts?.model ?? "");
        // the primary answers with an expression level of 7 (allowed 0–4)
        return opts?.model === "m1" ? { ...good, expression: 7 } : good;
      },
    });
    const req = { submissionId: "s1", templateId: 1, templateName: "t", grade: 5, explainText: "讲解", transcript: null, aiNote: null, noAi: false, evidenceCount: 1 };
    expect((await reviewer.reviewDaily(req)).expression).toBe(3);
    expect(models).toEqual(["m1", "m2"]);
    const log = await t.db.select().from(aiCalls);
    expect(log.map((r) => [r.role, r.status])).toEqual([
      ["primary", "error"],
      ["fallback", "ok"],
    ]);
    expect(JSON.stringify(log[0])).toContain("invalid_output: expression");
    // a failed review without a reason for the child is wrong too
    const bad = g.wrapDaily({ reviewDaily: async () => ({ ...good, passed: false, failReason: "" }) });
    await expect(bad.reviewDaily(req)).rejects.toThrow("invalid_output: failReason");
    await t.close();
  });
});
