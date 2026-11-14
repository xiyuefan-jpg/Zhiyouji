/** Admin console: 题库 (PRD part 7 §4). Admins edit; reviewers read. */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { landTemplateUpdate, promptCreate, promptImport, promptQuery, promptUpdate } from "@zhiyouji/shared";
import type { QuestionBank } from "../content/questionBank.js";
import type { AdminAuth } from "./adminRoutes.js";
import type { Db } from "@zhiyouji/db";
import { RUBRIC_IDS, rubricBook, type RubricId } from "../season/rubrics.js";

const idParam = z.object({ id: z.uuid() });
const familyParam = z.object({ id: z.enum(RUBRIC_IDS as [RubricId, ...RubricId[]]) });
const rubricBody = z.object({
  name: z.string().trim().min(1).max(20),
  dims: z.array(z.object({ key: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(20), max: z.number().int().min(1).max(100), hint: z.string().trim().max(200).optional() })).min(2).max(8),
  at50: z.string().trim().min(1).max(500),
  at75: z.string().trim().min(1).max(500),
  note: z.string().trim().max(200).nullable().optional(),
});

export function bankRoutes(app: FastifyInstance, bank: QuestionBank, auth: AdminAuth, db: Db, now: () => Date): void {
  const admin = async (req: Parameters<AdminAuth["user"]>[0]) => `admin:${(await auth.user(req, ["admin"])).user.id}`;

  // 评分族 (part 7 §4; part 6 §4.2): every save is a new version, the latest is live; reviewers read
  app.get("/v1/admin/rubrics", async (req) => {
    await auth.user(req);
    const book = rubricBook(db);
    return {
      rubrics: await Promise.all(
        RUBRIC_IDS.map(async (id) => {
          const history = await book.history(id);
          return { id, live: history.at(-1)!.version, versions: history };
        }),
      ),
    };
  });
  app.post("/v1/admin/rubrics/:id", async (req) => {
    const by = await admin(req);
    const { id } = familyParam.parse(req.params);
    const b = rubricBody.parse(req.body);
    return rubricBook(db).save(id, b, b.note ?? null, by, now());
  });

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
    await auth.user(req); // 题库 is read-only for reviewers (PRD part 7 §0)
    return bank.lowStockAll();
  });
}
