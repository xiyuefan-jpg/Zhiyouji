/**
 * Admin console: reviewing works (PRD part 7 §5–§6). Reviewers see their own
 * queue, blind; admins also reassign, rule and see the reviewer dashboard.
 * Opening a work is written to the view log for every child who signed it.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { leaveRequest, reassignRequest, reviewSubmit, ruleRequest } from "@zhiyouji/shared";
import type { AdminAccounts } from "../accounts/admin.js";
import type { Scoring } from "../season/scoring.js";
import type { AdminAuth } from "./adminRoutes.js";

const idParam = z.object({ id: z.uuid() });

export function reviewRoutes(app: FastifyInstance, scoring: Scoring, accounts: AdminAccounts, auth: AdminAuth): void {
  app.get("/v1/admin/reviews", async (req) => scoring.queue((await auth.user(req)).user.id));

  app.get("/v1/admin/reviews/:id", async (req) => {
    const { user } = await auth.user(req);
    const v = await scoring.reviewView(user.id, idParam.parse(req.params).id);
    for (const childId of v.members) await accounts.recordView(user.id, { childId, contentKind: "work", objectId: v.work.id, action: "view" });
    const { members: _members, ...rest } = v;
    return rest;
  });

  app.post("/v1/admin/reviews/:id", async (req) => {
    const { user } = await auth.user(req);
    return scoring.submitScore(user.id, idParam.parse(req.params).id, reviewSubmit.parse(req.body));
  });

  app.post("/v1/admin/reviews/leave", async (req) => {
    const { user } = await auth.user(req);
    const b = leaveRequest.parse(req.body);
    return scoring.addLeave(user.id, b.from, b.to);
  });

  app.post("/v1/admin/reviews/:id/reassign", async (req) => {
    await auth.user(req, ["admin"]);
    return scoring.reassign(idParam.parse(req.params).id, reassignRequest.parse(req.body).reviewerId);
  });

  app.post("/v1/admin/works/:id/rule", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    const b = ruleRequest.parse(req.body);
    return scoring.rule(idParam.parse(req.params).id, b.score, b.note, `admin:${user.id}`);
  });

  app.post("/v1/admin/works/:id/rejudge", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    const b = ruleRequest.parse(req.body);
    return scoring.rejudge(idParam.parse(req.params).id, b.score, b.note, `admin:${user.id}`);
  });

  app.get("/v1/admin/reviewers/dashboard", async (req) => {
    await auth.user(req, ["admin"]);
    return scoring.dashboard();
  });
}
