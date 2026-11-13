/** Admin console: AI configuration, prompt versions, the AI board, re-running one work (PRD part 6 §9; part 7 §4). */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AI_TASKS, type AiGateway } from "../aiGateway.js";
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
const statsQuery = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const idParam = z.object({ id: z.uuid() });

export function aiRoutes(app: FastifyInstance, gateway: AiGateway, scoring: Scoring, auth: AdminAuth): void {
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
  app.get("/v1/admin/ai/stats", async (req) => {
    await auth.user(req, ["admin"]);
    const q = statsQuery.parse(req.query);
    return gateway.stats(q.from, q.to);
  });
  app.post("/v1/admin/works/:id/ai-rerun", async (req) => {
    await auth.user(req, ["admin"]);
    return scoring.rerunAi(idParam.parse(req.params).id);
  });
}
