/**
 * Admin console: running a season (PRD part 7 §2 参数、日历、计划事件, §7 赛季监控与
 * 人工干预, §8 战报预览, §9 终局). Reviewers may look; only admins change things.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  calendarQuery,
  calendarSet,
  finalizeRequest,
  hideFeedRequest,
  interventionRequest,
  opLogQuery,
  paramsUpdate,
  pauseRequest,
  rescheduleRequest,
} from "@zhiyouji/shared";
import type { DeepPartial, SeasonParams } from "@zhiyouji/engine";
import type { SeasonControl } from "../season/control.js";
import type { AdminAuth } from "./adminRoutes.js";

const serverParam = z.object({ id: z.uuid() });
const seasonParam = z.object({ id: z.uuid() });
const keyParam = z.object({ id: z.uuid(), key: z.string().min(1).max(60) });
const dayParam = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const ledgerQuery = z.object({ teamId: z.uuid().optional(), currency: z.enum(["grain", "points"]).optional() });
const sinceQuery = z.object({ since: z.coerce.date() });

export function seasonControlRoutes(app: FastifyInstance, control: SeasonControl, auth: AdminAuth): void {
  const admin = async (req: Parameters<AdminAuth["user"]>[0]) => `admin:${(await auth.user(req, ["admin"])).user.id}`;
  // 赛季设置、参数、日历 and the planned events are admin-only (PRD part 7 §0).
  const anyone = (req: Parameters<AdminAuth["user"]>[0]) => auth.user(req, ["admin"]);

  // live view and ledger (§7)
  app.get("/v1/admin/servers/:id", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    const { id } = serverParam.parse(req.params);
    const v = await control.overview(id);
    await auth.view(user.id, null, { contentKind: "server_overview", objectId: id, action: "view" });
    return v;
  });
  app.get("/v1/admin/servers/:id/ledger", async (req) => {
    await auth.user(req, ["admin"]);
    return control.ledger(serverParam.parse(req.params).id, ledgerQuery.parse(req.query));
  });

  // parameters (§2)
  app.get("/v1/admin/seasons/:id/params", async (req) => {
    await anyone(req);
    return control.paramVersions(seasonParam.parse(req.params).id);
  });
  app.post("/v1/admin/seasons/:id/params", async (req) => {
    const by = await admin(req);
    const b = paramsUpdate.parse(req.body);
    return control.setParams(seasonParam.parse(req.params).id, b.patch as DeepPartial<SeasonParams>, b.note, by);
  });

  // calendar (§2)
  app.get("/v1/admin/calendar", async (req) => {
    await anyone(req);
    const q = calendarQuery.parse(req.query);
    return control.calendar(q.from, q.to);
  });
  app.post("/v1/admin/calendar/:day", async (req) => {
    const by = await admin(req);
    const b = calendarSet.parse(req.body);
    return control.setCalendarDay(dayParam.parse(req.params).day, b.kind, b.note ?? null, by);
  });

  // planned events (§2)
  app.get("/v1/admin/servers/:id/planned", async (req) => {
    await anyone(req);
    return control.planned(serverParam.parse(req.params).id);
  });
  app.post("/v1/admin/servers/:id/planned/:key/reschedule", async (req) => {
    const by = await admin(req);
    const p = keyParam.parse(req.params);
    const b = rescheduleRequest.parse(req.body);
    return control.reschedule(p.id, p.key, b.runAt, b.reason, by);
  });
  app.post("/v1/admin/servers/:id/planned/:key/rerun", async (req) => {
    const by = await admin(req);
    const p = keyParam.parse(req.params);
    return control.rerun(p.id, p.key, by);
  });

  // pause / resume (§16)
  app.post("/v1/admin/servers/:id/pause", async (req) => {
    const by = await admin(req);
    return control.pause(serverParam.parse(req.params).id, pauseRequest.parse(req.body).reason, by);
  });
  app.post("/v1/admin/servers/:id/resume", async (req) => {
    const by = await admin(req);
    return control.resume(serverParam.parse(req.params).id, by);
  });

  // interventions (§7): ledger, land, items, contests, roles, leaving
  app.post("/v1/admin/servers/:id/interventions", async (req) => {
    const by = await admin(req);
    return control.intervene(serverParam.parse(req.params).id, interventionRequest.parse(req.body), by);
  });

  // report preview and hiding a line (§8)
  app.get("/v1/admin/servers/:id/feed", async (req) => {
    await auth.user(req, ["admin"]);
    return control.feedSince(serverParam.parse(req.params).id, sinceQuery.parse(req.query).since);
  });
  app.post("/v1/admin/feed/:id/hide", async (req) => {
    const by = await admin(req);
    return control.hideFeed(serverParam.parse(req.params).id, hideFeedRequest.parse(req.body).reason, by);
  });

  // final settlement and the scholarship sheet (§9)
  app.post("/v1/admin/servers/:id/finalize", async (req) => {
    const by = await admin(req);
    return control.finalize(serverParam.parse(req.params).id, finalizeRequest.parse(req.body).poolYuan, by);
  });
  app.get("/v1/admin/servers/:id/scholarship.csv", async (req, reply) => {
    const { user } = await auth.user(req, ["admin"]);
    const { id } = serverParam.parse(req.params);
    const rows = await control.scholarshipRows(id);
    await auth.view(user.id, null, { contentKind: "scholarship", objectId: id, action: "download" });
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [["名次", "组", "团队分", "奖学金（元）", "组员"], ...rows.map((r) => [r.rank, r.team, (r.points / 100).toFixed(1), r.yuan, r.members.join("、")])];
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="scholarship.csv"');
    return "﻿" + lines.map((l) => l.map(esc).join(",")).join("\r\n");
  });

  // operation log (§7)
  app.get("/v1/admin/op-log", async (req) => {
    await auth.user(req, ["admin"]);
    return control.opLog(opLogQuery.parse(req.query));
  });
}
