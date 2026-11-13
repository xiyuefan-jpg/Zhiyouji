/** 观战, 作品展 (PRD part 5 F5; part 1 免费用户) and the content-safety queue (part 7 §8). */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Showcase } from "../season/showcase.js";
import type { AdminAuth } from "./adminRoutes.js";
import type { FamilyAuth } from "./familyRoutes.js";

const serverParam = z.object({ serverId: z.uuid() });
const workParam = z.object({ serverId: z.uuid(), workId: z.uuid() });
const showcaseQuery = z.object({ kind: z.enum(["contest", "war", "line", "main"]).optional(), landId: z.string().max(10).optional(), week: z.coerce.number().int().min(1).max(5).optional() });
const idParam = z.object({ id: z.uuid() });
const noteBody = z.object({ note: z.string().trim().min(1).max(300) });

export function watchRoutes(app: FastifyInstance, showcase: Showcase, family: FamilyAuth, admin: AdminAuth): void {
  app.get("/v1/watch/servers", async (req) => {
    await family.consented(req);
    return showcase.servers();
  });
  app.get("/v1/watch/:serverId/map", async (req) => {
    await family.consented(req);
    return showcase.map(serverParam.parse(req.params).serverId);
  });
  app.get("/v1/watch/:serverId/ranking", async (req) => {
    await family.consented(req);
    return showcase.ranking(serverParam.parse(req.params).serverId);
  });
  app.get("/v1/watch/:serverId/broadcasts", async (req) => {
    await family.consented(req);
    return showcase.broadcasts(serverParam.parse(req.params).serverId);
  });
  app.get("/v1/watch/:serverId/showcase", async (req) => {
    await family.consented(req);
    return showcase.showcase(serverParam.parse(req.params).serverId, showcaseQuery.parse(req.query));
  });
  app.get("/v1/watch/:serverId/teams/:teamId", async (req) => {
    await family.consented(req);
    const p = z.object({ serverId: z.uuid(), teamId: z.uuid() }).parse(req.params);
    return showcase.team(p.serverId, p.teamId);
  });
  app.get("/v1/watch/:serverId/showcase/:workId", async (req) => {
    await family.consented(req);
    const p = workParam.parse(req.params);
    return showcase.work(p.serverId, p.workId);
  });

  app.get("/v1/admin/safety", async (req) => {
    await admin.user(req);
    return showcase.queue();
  });
  app.post("/v1/admin/safety/:id/pass", async (req) => {
    const { user } = await admin.user(req, ["admin"]);
    return showcase.handle(idParam.parse(req.params).id, "pass", `admin:${user.id}`);
  });
  app.post("/v1/admin/safety/:id/remove", async (req) => {
    const { user } = await admin.user(req, ["admin"]);
    return showcase.handle(idParam.parse(req.params).id, "remove", `admin:${user.id}`);
  });
  app.post("/v1/admin/safety/:id/forward", async (req) => {
    const { user } = await admin.user(req);
    return showcase.forward(idParam.parse(req.params).id, noteBody.parse(req.body).note, `admin:${user.id}`);
  });
}
