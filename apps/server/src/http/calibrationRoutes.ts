/** Admin console: 校准 (PRD part 7 §4; part 6 §4.1). Admins add samples and run AI set-ups; admins and reviewers score. */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Calibration } from "../content/calibration.js";
import { RUBRIC_IDS, type RubricId } from "../season/rubrics.js";
import type { AdminAuth } from "./adminRoutes.js";

const family = z.enum(RUBRIC_IDS as [RubricId, ...RubricId[]]);
const idParam = z.object({ id: z.uuid() });
const sampleBody = z.object({
  title: z.string().trim().min(1).max(60),
  family,
  taskTitle: z.string().trim().min(1).max(100),
  taskBody: z.string().trim().max(2000).nullable().optional(),
  audience: z.string().trim().max(100).nullable().optional(),
  mediaKind: z.enum(["text", "images", "video", "audio"]).optional(),
  text: z.string().trim().min(1).max(20_000),
  aiNote: z.string().trim().max(500).nullable().optional(),
});
const scoreBody = z.object({ dims: z.record(z.string(), z.number().int().min(0).max(100)) });
const runBody = z.object({ family: family.optional(), model: z.string().trim().max(80).optional(), prompt: z.string().min(1).max(50_000).optional(), label: z.string().trim().min(1).max(60) });

export function calibrationRoutes(app: FastifyInstance, calib: Calibration, auth: AdminAuth): void {
  app.get("/v1/admin/calibration/samples", async (req) => {
    const { user } = await auth.user(req);
    return calib.samples(user.id);
  });
  app.post("/v1/admin/calibration/samples", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    return calib.addSample(sampleBody.parse(req.body), `admin:${user.id}`);
  });
  app.post("/v1/admin/calibration/samples/:id/score", async (req) => {
    const { user } = await auth.user(req);
    return calib.score(idParam.parse(req.params).id, user.id, scoreBody.parse(req.body).dims);
  });
  app.post("/v1/admin/calibration/run", async (req) => {
    await auth.user(req, ["admin"]);
    return calib.runAi(runBody.parse(req.body));
  });
  app.get("/v1/admin/calibration/report", async (req) => {
    await auth.user(req, ["admin"]);
    return calib.report();
  });
}
