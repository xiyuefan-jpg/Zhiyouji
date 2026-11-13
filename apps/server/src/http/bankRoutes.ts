/** Admin console: 题库 (PRD part 7 §4). Admins edit; reviewers read. */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { landTemplateUpdate, promptCreate, promptImport, promptQuery, promptUpdate } from "@zhiyouji/shared";
import type { QuestionBank } from "../content/questionBank.js";
import type { AdminAuth } from "./adminRoutes.js";

const idParam = z.object({ id: z.uuid() });

export function bankRoutes(app: FastifyInstance, bank: QuestionBank, auth: AdminAuth): void {
  const admin = async (req: Parameters<AdminAuth["user"]>[0]) => `admin:${(await auth.user(req, ["admin"])).user.id}`;

  app.get("/v1/admin/land-templates", async (req) => {
    await auth.user(req);
    return bank.templates();
  });
  app.post("/v1/admin/land-templates/seed-defaults", async (req) => bank.seedDefaults(await admin(req)));
  app.patch("/v1/admin/land-templates/:id", async (req) => {
    const by = await admin(req);
    return bank.updateTemplate(idParam.parse(req.params).id, landTemplateUpdate.parse(req.body), by);
  });

  app.get("/v1/admin/prompts", async (req) => {
    await auth.user(req);
    return bank.list(promptQuery.parse(req.query));
  });
  app.post("/v1/admin/prompts", async (req) => {
    const by = await admin(req);
    return bank.create(promptCreate.parse(req.body), by);
  });
  app.post("/v1/admin/prompts/import", async (req) => {
    const by = await admin(req);
    return bank.importMany(promptImport.parse(req.body).prompts, by);
  });
  app.patch("/v1/admin/prompts/:id", async (req) => {
    const by = await admin(req);
    return bank.update(idParam.parse(req.params).id, promptUpdate.parse(req.body), by);
  });
  app.get("/v1/admin/prompts/low-stock", async (req) => {
    await auth.user(req, ["admin"]);
    return bank.lowStockAll();
  });
}
