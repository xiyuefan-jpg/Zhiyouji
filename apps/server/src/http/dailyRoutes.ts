/**
 * 每日任务 and 修行日志 on the student website (PRD part 5 C1–C7), and the
 * exception queue in the admin console (part 7 §5.3: admins and reviewers).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dailyDecide, dailySubmit, dailyUploadRequest } from "@zhiyouji/shared";
import type { AdminAccounts } from "../accounts/admin.js";
import type { DailyTasks } from "../daily/daily.js";
import type { AdminAuth } from "./adminRoutes.js";
import type { FamilyAuth } from "./familyRoutes.js";

const idParam = z.object({ id: z.uuid() });
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
const cardsQuery = z.object({ tag: z.string().max(80).optional(), q: z.string().max(40).optional() });

export function dailyRoutes(app: FastifyInstance, daily: DailyTasks, accounts: AdminAccounts, family: FamilyAuth, admin: AdminAuth): void {
  const child = async (req: Parameters<FamilyAuth["child"]>[0]) => (await family.child(req)).child;

  app.get("/v1/daily/today", async (req) => daily.today(await child(req)));
  app.post("/v1/daily/uploads", async (req) => daily.requestUpload(await child(req), dailyUploadRequest.parse(req.body)));
  app.post("/v1/daily/uploads/:id/complete", async (req) => daily.completeUpload(await child(req), idParam.parse(req.params).id));
  app.post("/v1/daily/submissions", async (req) => daily.submit(await child(req), dailySubmit.parse(req.body)));
  app.get("/v1/daily/submissions/:id", async (req) => daily.view((await child(req)).id, idParam.parse(req.params).id));

  app.get("/v1/journal/calendar", async (req) => daily.calendar((await child(req)).id, monthQuery.parse(req.query).month));
  app.get("/v1/journal/subjects", async (req) => daily.subjects((await child(req)).id));
  app.get("/v1/journal/cards", async (req) => {
    const q = cardsQuery.parse(req.query);
    return daily.cards((await child(req)).id, { tag: q.tag, text: q.q });
  });
  app.get("/v1/journal/cards/:id", async (req) => daily.card((await child(req)).id, idParam.parse(req.params).id));

  app.get("/v1/admin/daily/exceptions", async (req) => {
    const { user } = await admin.user(req);
    const r = await daily.exceptions();
    for (const t of r.tasks) await accounts.recordView(user.id, { childId: t.childId, contentKind: "daily_task", objectId: t.id, action: "view" });
    return r;
  });
  app.post("/v1/admin/daily/:id/ai-rerun", async (req) => {
    await admin.user(req, ["admin"]);
    return daily.rerunAi(idParam.parse(req.params).id);
  });
  app.post("/v1/admin/daily/:id/decide", async (req) => {
    const { user } = await admin.user(req);
    return daily.decide(idParam.parse(req.params).id, dailyDecide.parse(req.body), `admin:${user.id}`);
  });
}
