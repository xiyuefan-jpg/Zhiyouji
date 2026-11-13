/**
 * Admin console: seasons, enrollment and grouping (PRD part 7 §2–§3).
 * Only admins (not reviewers) may call these.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  childSearchQuery,
  confirmGroupingRequest,
  enrollRequest,
  moveRequest,
  renameTeamRequest,
  revokeRequest,
  seasonCreate,
  seasonUpdate,
  SEASON_STATUS_LABELS,
  type SeasonStatus,
} from "@zhiyouji/shared";
import type { SeasonAdmin, SeasonRow } from "../season/seasons.js";
import type { AdminAuth } from "./adminRoutes.js";

const idParam = z.object({ id: z.uuid() });
const childParam = z.object({ id: z.uuid(), childId: z.uuid() });

export function seasonView(s: SeasonRow) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    statusLabel: SEASON_STATUS_LABELS[s.status as SeasonStatus] ?? s.status,
    opening: s.openingDate,
    paramVersion: s.currentParamVersion,
    groupingLocked: !!s.groupingLockedAt,
    groupingLockedAt: s.groupingLockedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

export function seasonAdminRoutes(app: FastifyInstance, seasons: SeasonAdmin, auth: AdminAuth): void {
  const admin = async (req: Parameters<AdminAuth["user"]>[0]) => `admin:${(await auth.user(req, ["admin"])).user.id}`;

  app.get("/v1/admin/seasons", async (req) => {
    await auth.user(req);
    return { seasons: (await seasons.list()).map(seasonView) };
  });

  app.post("/v1/admin/seasons", async (req) => {
    const by = await admin(req);
    return { season: seasonView(await seasons.create(seasonCreate.parse(req.body), by)) };
  });

  app.get("/v1/admin/seasons/:id", async (req) => {
    await auth.user(req);
    const { id } = idParam.parse(req.params);
    const s = await seasons.season(id);
    const svs = await seasons.servers(id);
    return { season: seasonView(s), servers: svs.map((x) => ({ id: x.id, name: x.name })) };
  });

  app.patch("/v1/admin/seasons/:id", async (req) => {
    const by = await admin(req);
    return { season: seasonView(await seasons.update(idParam.parse(req.params).id, seasonUpdate.parse(req.body), by)) };
  });

  app.post("/v1/admin/seasons/:id/open-enrollment", async (req) => {
    const by = await admin(req);
    return { season: seasonView(await seasons.openEnrollment(idParam.parse(req.params).id, by)) };
  });

  app.post("/v1/admin/seasons/:id/reopen-enrollment", async (req) => {
    const by = await admin(req);
    return { season: seasonView(await seasons.reopenEnrollment(idParam.parse(req.params).id, by)) };
  });

  // ---- children and enrollment ---------------------------------------------------------

  app.get("/v1/admin/children", async (req) => {
    await auth.user(req, ["admin"]);
    return { children: await seasons.searchChildren(childSearchQuery.parse(req.query).q) };
  });

  app.post("/v1/admin/seasons/:id/players", async (req) => {
    const by = await admin(req);
    return seasons.enroll(idParam.parse(req.params).id, enrollRequest.parse(req.body).players, by);
  });

  app.get("/v1/admin/seasons/:id/players", async (req) => {
    await auth.user(req, ["admin"]);
    return { players: await seasons.roster(idParam.parse(req.params).id) };
  });

  /** 报名名单导出 (CSV, opens in Excel; BOM so Chinese shows correctly). */
  app.get("/v1/admin/seasons/:id/players.csv", async (req, reply) => {
    await auth.user(req, ["admin"]);
    const rows = await seasons.roster(idParam.parse(req.params).id);
    const head = ["孩子ID", "昵称", "年级", "家长手机号", "状态", "缴费备注", "开通人", "开通时间", "服", "组"];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head, ...rows.map((r) => [r.childId, r.nickname, r.gradeLabel, r.phone, r.status, r.paymentNote, r.enabledBy, r.enabledAt, r.server, r.team])];
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="players.csv"');
    return "﻿" + lines.map((l) => l.map(esc).join(",")).join("\r\n");
  });

  app.post("/v1/admin/seasons/:id/players/:childId/revoke", async (req) => {
    const by = await admin(req);
    const p = childParam.parse(req.params);
    await seasons.revoke(p.id, p.childId, revokeRequest.parse(req.body).reason, by);
    return { ok: true };
  });

  // ---- grouping -------------------------------------------------------------------------

  app.post("/v1/admin/seasons/:id/grouping/generate", async (req) => {
    const by = await admin(req);
    return { grouping: await seasons.generateGrouping(idParam.parse(req.params).id, by) };
  });

  app.get("/v1/admin/seasons/:id/grouping", async (req) => {
    await auth.user(req, ["admin"]);
    return { grouping: await seasons.groupingView(idParam.parse(req.params).id) };
  });

  app.post("/v1/admin/seasons/:id/grouping/move", async (req) => {
    const by = await admin(req);
    const b = moveRequest.parse(req.body);
    return { grouping: await seasons.movePlayer(idParam.parse(req.params).id, b.childId, b.server, b.team, by) };
  });

  app.post("/v1/admin/seasons/:id/grouping/rename", async (req) => {
    const by = await admin(req);
    const b = renameTeamRequest.parse(req.body);
    return { grouping: await seasons.renameTeam(idParam.parse(req.params).id, b.server, b.team, b.name, by) };
  });

  app.post("/v1/admin/seasons/:id/grouping/confirm", async (req) => {
    const by = await admin(req);
    return seasons.confirmGrouping(idParam.parse(req.params).id, confirmGroupingRequest.parse(req.body ?? {}), by);
  });
}
