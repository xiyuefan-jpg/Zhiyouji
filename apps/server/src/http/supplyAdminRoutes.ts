/** Admin console: 军需 in the season monitor — list, spot check, re-tier (PRD part 7 §7). */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Supply } from "../season/supply.js";
import type { AdminAuth } from "./adminRoutes.js";

const serverParam = z.object({ id: z.uuid() });
const teamParam = z.object({ id: z.uuid(), supplyId: z.string().min(1).max(20), teamId: z.uuid() });
const regradeBody = z.object({ grain: z.number().int().min(0), reason: z.string().trim().min(1).max(500) });

export function supplyAdminRoutes(app: FastifyInstance, supply: Supply, auth: AdminAuth): void {
  app.get("/v1/admin/servers/:id/supply", async (req) => {
    await auth.user(req, ["admin"]);
    return supply.adminList(serverParam.parse(req.params).id);
  });
  app.get("/v1/admin/servers/:id/supply/:supplyId/teams/:teamId", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    const p = teamParam.parse(req.params);
    const v = await supply.adminTeam(p.id, p.supplyId, p.teamId);
    await auth.view(user.id, v.children, { contentKind: "supply", objectId: `${p.supplyId}:${p.teamId}`, action: "view" });
    return v;
  });
  app.post("/v1/admin/servers/:id/supply/:supplyId/teams/:teamId/regrade", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    const p = teamParam.parse(req.params);
    return supply.regrade(p.id, p.supplyId, p.teamId, regradeBody.parse(req.body), `admin:${user.id}`);
  });
}
