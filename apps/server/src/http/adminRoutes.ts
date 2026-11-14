/**
 * Admin console: login, invites, users, view log (PRD part 7 §0).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { adminInviteRequest, adminLoginRequest, inviteFinishRequest, inviteStartRequest, type AdminRole } from "@zhiyouji/shared";
import { adminMe, type AdminAccounts, type AdminRow, type ViewRecord } from "../accounts/admin.js";
import type { SessionRow, Sessions } from "../accounts/sessions.js";
import type { ServerConfig } from "../config.js";
import { adminOfRequest } from "./audit.js";
import { clearSessionCookie, readToken, setSessionCookie } from "./auth.js";
import { fail } from "./errors.js";

export class AdminAuth {
  constructor(
    private readonly cfg: ServerConfig,
    private readonly sessions: Sessions,
    private readonly accounts: AdminAccounts,
  ) {}

  token(req: FastifyRequest): string | undefined {
    return readToken(req, this.cfg.cookies.admin);
  }

  /** The logged-in admin console user; `roles` limits who may call. */
  async user(req: FastifyRequest, roles: readonly AdminRole[] = ["admin", "reviewer"]): Promise<{ session: SessionRow; user: AdminRow }> {
    const r = await this.sessions.resolve(this.token(req), "admin");
    if (!r.ok) fail(401, r.reason);
    const session = (r as { session: SessionRow }).session;
    const user = await this.accounts.user(session.adminUserId!);
    if (!user || user.status !== "active") fail(401, "not_logged_in");
    if (!roles.includes(user!.role as AdminRole)) fail(403, "forbidden");
    adminOfRequest.set(req, user!.id);
    return { session, user: user! };
  }

  /**
   * View log (PRD part 8 §3.1): one line per child in `childIds` (an empty
   * list writes nothing), or one line without a child when `childIds` is null
   * (a list of nicknames, an export).
   */
  async view(adminUserId: string, childIds: readonly (string | null)[] | null, v: Omit<ViewRecord, "childId">): Promise<void> {
    if (childIds === null) return this.accounts.recordView(adminUserId, { ...v, childId: null });
    for (const childId of new Set(childIds)) await this.accounts.recordView(adminUserId, { ...v, childId });
  }
}

const viewLogQuery = z.object({
  adminUserId: z.uuid().optional(),
  childId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export function adminRoutes(app: FastifyInstance, cfg: ServerConfig, accounts: AdminAccounts, sessions: Sessions, auth: AdminAuth): void {
  app.post("/v1/admin/auth/login", async (req, reply) => {
    const b = adminLoginRequest.parse(req.body);
    const r = await accounts.login(b.email, b.password, b.totp);
    setSessionCookie(reply, cfg, cfg.cookies.admin, r.token, null);
    return { token: r.token, expiresAt: r.expiresAt.toISOString(), idleMinutes: cfg.admin.idleMinutes, me: adminMe(r.user) };
  });

  app.post("/v1/admin/auth/logout", async (req, reply) => {
    await sessions.revoke(auth.token(req));
    clearSessionCookie(reply, cfg, cfg.cookies.admin);
    return { ok: true };
  });

  app.get("/v1/admin/me", async (req) => adminMe((await auth.user(req)).user));

  app.post("/v1/admin/auth/invite/start", async (req) => {
    const b = inviteStartRequest.parse(req.body);
    return accounts.startInvite(b.token, b.password);
  });

  app.post("/v1/admin/auth/invite/finish", async (req) => {
    const b = inviteFinishRequest.parse(req.body);
    return { me: adminMe(await accounts.finishInvite(b.token, b.code)) };
  });

  app.get("/v1/admin/users", async (req) => {
    await auth.user(req, ["admin"]);
    return { users: (await accounts.list()).map((u) => ({ ...adminMe(u), status: u.status, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })) };
  });

  app.post("/v1/admin/users", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    const r = await accounts.invite(`admin:${user.id}`, adminInviteRequest.parse(req.body));
    return { user: adminMe(r.user), inviteToken: r.inviteToken, expiresAt: r.expiresAt.toISOString() };
  });

  app.post<{ Params: { id: string } }>("/v1/admin/users/:id/disable", async (req) => {
    const { user } = await auth.user(req, ["admin"]);
    await accounts.disable(user, z.uuid().parse(req.params.id));
    return { ok: true };
  });

  app.get("/v1/admin/view-log", async (req) => {
    await auth.user(req, ["admin"]);
    const q = viewLogQuery.parse(req.query);
    const rows = await accounts.viewLog(q);
    return { entries: rows.map((r) => ({ ...r, at: r.at.toISOString() })) };
  });
}
