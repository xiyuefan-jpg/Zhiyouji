/** 公告, WeChat group QR codes and envoys (PRD part 7 §3, §8; part 5 E1, E12). */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { announcementCreate, qrSetRequest, qrTicketRequest } from "@zhiyouji/shared";
import type { Operations } from "../season/operations.js";
import type { SeasonPlay } from "../season/play.js";
import type { AdminAuth } from "./adminRoutes.js";
import type { FamilyAuth } from "./familyRoutes.js";

const idParam = z.object({ id: z.uuid() });
const campParam = z.object({ id: z.uuid(), camp: z.enum(["a", "b"]) });
const childBody = z.object({ childId: z.uuid() });

export function opsRoutes(app: FastifyInstance, ops: Operations, play: SeasonPlay, family: FamilyAuth, admin: AdminAuth): void {
  const by = async (req: FastifyRequest) => `admin:${(await admin.user(req, ["admin"])).user.id}`;
  const ctx = async (req: FastifyRequest) => play.ctx((await family.child(req)).child.id);

  // announcements
  app.get("/v1/admin/announcements", async (req) => {
    await admin.user(req, ["admin"]);
    return ops.listAnnouncements();
  });
  app.post("/v1/admin/announcements", async (req) => ops.createAnnouncement(announcementCreate.parse(req.body), await by(req)));
  app.post("/v1/admin/announcements/:id/withdraw", async (req) => {
    await by(req);
    return ops.withdraw(idParam.parse(req.params).id);
  });
  app.get("/v1/announcements", async (req) => ops.forChild((await family.child(req)).child.id));

  // QR codes: ticket → PUT the image → set
  app.post("/v1/admin/teams/:id/qr/ticket", async (req) => {
    await by(req);
    const b = qrTicketRequest.parse(req.body);
    return ops.qrTicket({ teamId: idParam.parse(req.params).id }, b.contentType, b.size);
  });
  app.post("/v1/admin/teams/:id/qr", async (req) => ops.setTeamQr(idParam.parse(req.params).id, qrSetRequest.parse(req.body).key, await by(req)));
  app.post("/v1/admin/servers/:id/camps/:camp/qr/ticket", async (req) => {
    await by(req);
    const p = campParam.parse(req.params);
    const b = qrTicketRequest.parse(req.body);
    return ops.qrTicket({ serverId: p.id, camp: p.camp }, b.contentType, b.size);
  });
  app.post("/v1/admin/servers/:id/camps/:camp/qr", async (req) => {
    await by(req);
    const p = campParam.parse(req.params);
    return ops.setCampQr(p.id, p.camp, qrSetRequest.parse(req.body).key);
  });
  app.get("/v1/season/qr", async (req) => ops.qrFor(await ctx(req)));

  // envoys
  app.get("/v1/season/big-battle/envoys", async (req) => ops.envoysOf(await ctx(req)));
  app.post("/v1/season/big-battle/envoys", async (req) => ops.registerEnvoy(await ctx(req), childBody.parse(req.body).childId));
  app.delete("/v1/season/big-battle/envoys/:id", async (req) => ops.removeEnvoy(await ctx(req), idParam.parse(req.params).id));
}
