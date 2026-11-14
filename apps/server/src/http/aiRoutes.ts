/** Admin console: AI configuration, prompt versions, the AI board, re-running one work (PRD part 6 §9; part 7 §4). */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AI_TASKS, type AiGateway } from "../aiGateway.js";
import type { DailyTasks } from "../daily/daily.js";
import type { Scoring } from "../season/scoring.js";
import type { AdminAuth } from "./adminRoutes.js";

const taskParam = z.object({ task: z.enum(AI_TASKS) });
const configBody = z.object({
  provider: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(80),
  promptVersion: z.number().int().min(1).optional(),
  fallbackProvider: z.string().trim().max(40).nullable().optional(),
  fallbackModel: z.string().trim().max(80).nullable().optional(),
  shadowModel: z.string().trim().max(80).nullable().optional(),
});
const promptBody = z.object({ content: z.string().min(1).max(50_000), note: z.string().max(200).nullable().optional() });
const priceParam = z.object({ model: z.string().trim().min(1).max(80) });
const priceBody = z.object({ inPerMillion: z.number().int().min(0).max(100_000_000), outPerMillion: z.number().int().min(0).max(100_000_000), perAudioHour: z.number().int().min(0).max(100_000_000) });
const statsQuery = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const idParam = z.object({ id: z.uuid() });
const tryParam = z.object({ task: z.enum(["work_score", "daily_review"]) });
const tryBody = z.object({ targetId: z.uuid(), prompt: z.string().min(1).max(50_000).optional(), model: z.string().trim().min(1).max(80).optional() });

export function aiRoutes(app: FastifyInstance, gateway: AiGateway, scoring: Scoring, daily: DailyTasks, auth: AdminAuth): void {
  app.get("/v1/admin/ai/config", async (req) => {
    await auth.user(req);
    return gateway.configs();
  });
  app.put("/v1/admin/ai/config/:task", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    return gateway.setConfig(taskParam.parse(req.params).task, configBody.parse(req.body), `admin:${user.id}`);
  });
  app.get("/v1/admin/ai/prompts/:task", async (req) => {
    await auth.user(req);
    return gateway.prompts(taskParam.parse(req.params).task);
  });
  app.post("/v1/admin/ai/prompts/:task", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    const b = promptBody.parse(req.body);
    return gateway.addPrompt(taskParam.parse(req.params).task, b.content, b.note ?? null, `admin:${user.id}`);
  });
  // price list per model, in 0.0001 yuan (part 6 §6.2)
  app.get("/v1/admin/ai/prices", async (req) => {
    await auth.user(req, ["admin"]);
    return gateway.prices();
  });
  app.put("/v1/admin/ai/prices/:model", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    return gateway.setPrice(priceParam.parse(req.params).model, priceBody.parse(req.body), `admin:${user.id}`);
  });
  app.get("/v1/admin/ai/stats", async (req) => {
    await auth.user(req, ["admin"]);
    const q = statsQuery.parse(req.query);
    return gateway.stats(q.from, q.to);
  });
  // 试跑 (part 7 §4): a sample work or daily task with a draft prompt and / or another model
  app.post("/v1/admin/ai/try/:task", async (req) => {
    await auth.user(req, ["admin"]);
    const { task } = tryParam.parse(req.params);
    const b = tryBody.parse(req.body);
    const trial = { prompt: b.prompt, model: b.model };
    return task === "work_score" ? scoring.tryAi(b.targetId, trial) : daily.tryAi(b.targetId, trial);
  });
  app.post("/v1/admin/works/:id/ai-rerun", async (req) => {
    await auth.user(req, ["admin"]);
    return scoring.rerunAi(idParam.parse(req.params).id);
  });
}
