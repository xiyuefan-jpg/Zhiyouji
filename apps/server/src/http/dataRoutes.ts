/** Parents' data requests (PRD part 5 G4; part 8 §4) and the admin list. */

import type { FastifyInstance } from "fastify";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { dataRequests, type Db } from "@zhiyouji/db";
import { dataRequestCreate } from "@zhiyouji/shared";
import type { DataRights } from "../accounts/dataRights.js";
import type { AdminAuth } from "./adminRoutes.js";
import type { FamilyAuth } from "./familyRoutes.js";

const idParam = z.object({ id: z.uuid() });

export function dataRoutes(app: FastifyInstance, db: Db, rights: DataRights, family: FamilyAuth, admin: AdminAuth): void {
  // A parent who pressed 不同意 can still export or delete: logged in is enough.
  app.get("/v1/data-requests", async (req) => rights.list((await family.loggedIn(req)).family.id));
  app.post("/v1/data-requests", async (req) => {
    const { family: f } = await family.loggedIn(req);
    const b = dataRequestCreate.parse(req.body);
    return b.kind === "export" ? rights.requestExport(f.id, b.childId) : rights.requestDelete(f.id, b.childId);
  });
  app.post("/v1/data-requests/:id/cancel", async (req) => rights.cancel((await family.loggedIn(req)).family.id, idParam.parse(req.params).id));
  app.get("/v1/data-requests/:id/download", async (req) => rights.downloadUrl((await family.loggedIn(req)).family.id, idParam.parse(req.params).id));

  app.get("/v1/admin/data-requests", async (req) => {
    await admin.user(req, ["admin"]);
    const rows = await db.select().from(dataRequests).orderBy(desc(dataRequests.requestedAt)).limit(500);
    return {
      requests: rows.map((r) => ({
        id: r.id,
        familyId: r.familyId,
        childId: r.childId,
        kind: r.kind,
        status: r.status,
        requestedAt: r.requestedAt.toISOString(),
        dueAt: r.dueAt.toISOString(),
        doneAt: r.doneAt?.toISOString() ?? null,
      })),
    };
  });
}
