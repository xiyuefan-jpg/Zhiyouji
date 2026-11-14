/** 美术资源 (PRD part 7 §8): admins upload and enable; the website reads the live images and authors. */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Art } from "../content/art.js";
import type { AdminAuth } from "./adminRoutes.js";
import type { FamilyAuth } from "./familyRoutes.js";

const idParam = z.object({ id: z.uuid() });
const slot = z.string().trim().min(1).max(40);
const ticketBody = z.object({ slot, contentType: z.string().max(60), size: z.number().int().min(1) });
const saveBody = z.object({ slot, key: z.string().min(1).max(200), contentType: z.string().max(60), author: z.string().trim().min(1).max(60), note: z.string().trim().max(200).nullable().optional(), live: z.boolean().optional() });

export function artRoutes(app: FastifyInstance, art: Art, auth: AdminAuth, family: FamilyAuth): void {
  const admin = async (req: Parameters<AdminAuth["user"]>[0]) => `admin:${(await auth.user(req, ["admin"])).user.id}`;
  app.get("/v1/admin/art", async (req) => {
    await admin(req);
    return art.list();
  });
  app.post("/v1/admin/art/ticket", async (req) => {
    await admin(req);
    const b = ticketBody.parse(req.body);
    return art.ticket(b.slot, b.contentType, b.size);
  });
  app.post("/v1/admin/art", async (req) => {
    const by = await admin(req);
    return art.save(saveBody.parse(req.body), by);
  });
  app.post("/v1/admin/art/:id/enable", async (req) => {
    await admin(req);
    return art.enable(idParam.parse(req.params).id);
  });
  app.post("/v1/admin/art/disable", async (req) => {
    await admin(req);
    return art.disable(z.object({ slot }).parse(req.body).slot);
  });
  app.get("/v1/art", async (req) => {
    await family.child(req);
    return art.live();
  });
}
