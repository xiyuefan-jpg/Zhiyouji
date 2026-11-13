/** Message center for families and admin console users (PRD part 5 战报→我的消息, part 7 notification center). */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Notifier, Recipient } from "../notify/notifier.js";
import type { AdminAuth } from "./adminRoutes.js";
import type { FamilyAuth } from "./familyRoutes.js";

const listQuery = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const idParam = z.object({ id: z.uuid() });

export function messageRoutes(app: FastifyInstance, notifier: Notifier, family: FamilyAuth, admin: AdminAuth): void {
  const familyRecipients = async (req: Parameters<FamilyAuth["consented"]>[0]): Promise<Recipient[]> => {
    const { session, family: f } = await family.consented(req);
    const rs: Recipient[] = [{ kind: "family", id: f.id }];
    if (session.childId) rs.push({ kind: "child", id: session.childId });
    return rs;
  };

  app.get("/v1/messages", async (req) => ({ messages: await notifier.list(await familyRecipients(req), listQuery.parse(req.query)) }));
  app.get("/v1/messages/unread-count", async (req) => ({ unread: await notifier.unreadCount(await familyRecipients(req)) }));
  app.post("/v1/messages/:id/read", async (req) => ({ marked: await notifier.markRead(await familyRecipients(req), idParam.parse(req.params).id) }));
  app.post("/v1/messages/read-all", async (req) => ({ marked: await notifier.markRead(await familyRecipients(req)) }));

  const adminRecipients = async (req: Parameters<AdminAuth["user"]>[0]): Promise<Recipient[]> => [{ kind: "admin", id: (await admin.user(req)).user.id }];

  app.get("/v1/admin/messages", async (req) => ({ messages: await notifier.list(await adminRecipients(req), listQuery.parse(req.query)) }));
  app.get("/v1/admin/messages/unread-count", async (req) => ({ unread: await notifier.unreadCount(await adminRecipients(req)) }));
  app.post("/v1/admin/messages/:id/read", async (req) => ({ marked: await notifier.markRead(await adminRecipients(req), idParam.parse(req.params).id) }));
  app.post("/v1/admin/messages/read-all", async (req) => ({ marked: await notifier.markRead(await adminRecipients(req)) }));
}
