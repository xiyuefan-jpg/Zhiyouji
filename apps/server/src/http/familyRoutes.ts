/**
 * Student website: login, the parent's confirmation, child profiles
 * (PRD part 5 A1–A3, G2, G3).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { childCreate, childUpdate, chooseChild, consentRequest, loginRequest, smsCodeRequest } from "@zhiyouji/shared";
import { childView, type FamilyAccounts, type FamilyRow } from "../accounts/family.js";
import type { SessionRow, Sessions } from "../accounts/sessions.js";
import type { ServerConfig } from "../config.js";
import { clearSessionCookie, readToken, setSessionCookie } from "./auth.js";
import { fail } from "./errors.js";

export interface FamilyContext {
  session: SessionRow;
  family: FamilyRow;
}

export class FamilyAuth {
  constructor(
    private readonly cfg: ServerConfig,
    private readonly sessions: Sessions,
    private readonly accounts: FamilyAccounts,
  ) {}

  token(req: FastifyRequest): string | undefined {
    return readToken(req, this.cfg.cookies.family);
  }

  /** Logged in (the confirmation may still be missing). */
  async loggedIn(req: FastifyRequest): Promise<FamilyContext> {
    const r = await this.sessions.resolve(this.token(req), "family");
    if (!r.ok) fail(401, r.reason);
    const s = (r as { session: SessionRow }).session;
    return { session: s, family: await this.accounts.family(s.familyId!) };
  }

  /** Logged in and the parent has agreed to the current documents. */
  async consented(req: FastifyRequest): Promise<FamilyContext> {
    const ctx = await this.loggedIn(req);
    if (ctx.family.status === "refused") fail(403, "refused");
    if (this.accounts.needsConsent(ctx.family)) fail(403, ctx.family.consentVersion ? "policy_changed" : "consent_required");
    return ctx;
  }

  /** …and a child has been chosen on "我是谁". */
  async child(req: FastifyRequest) {
    const ctx = await this.consented(req);
    if (!ctx.session.childId) fail(400, "no_child");
    const child = await this.accounts.child(ctx.family.id, ctx.session.childId!);
    return { ...ctx, child };
  }
}

export function familyRoutes(app: FastifyInstance, cfg: ServerConfig, accounts: FamilyAccounts, sessions: Sessions, auth: FamilyAuth): void {
  app.get("/v1/policy", async () => ({ version: cfg.policyVersion, links: cfg.policyLinks }));

  app.post("/v1/auth/sms-code", async (req) => {
    const b = smsCodeRequest.parse(req.body);
    return accounts.requestCode(b.phone, req.ip, b.captcha);
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const b = loginRequest.parse(req.body);
    const r = await accounts.login(b.phone, b.code);
    setSessionCookie(reply, cfg, cfg.cookies.family, r.token, r.expiresAt);
    const resolved = await sessions.resolve(r.token, "family");
    if (!resolved.ok) fail(500, "session");
    return { token: r.token, expiresAt: r.expiresAt.toISOString(), me: await accounts.me((resolved as { session: SessionRow }).session) };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    await sessions.revoke(auth.token(req));
    clearSessionCookie(reply, cfg, cfg.cookies.family);
    return { ok: true };
  });

  app.get("/v1/me", async (req) => {
    const { session } = await auth.loggedIn(req);
    return accounts.me(session);
  });

  app.post("/v1/family/consent", async (req) => {
    const { family } = await auth.loggedIn(req);
    const b = consentRequest.parse(req.body);
    return accounts.consent(family.id, b.choice, b.version);
  });

  app.get("/v1/children", async (req) => {
    const { family } = await auth.consented(req);
    return { children: (await accounts.listChildren(family.id)).map(childView) };
  });

  app.post("/v1/children", async (req) => {
    const { family } = await auth.consented(req);
    return { child: childView(await accounts.createChild(family.id, childCreate.parse(req.body))) };
  });

  app.patch<{ Params: { id: string } }>("/v1/children/:id", async (req) => {
    const { family } = await auth.consented(req);
    return { child: childView(await accounts.updateChild(family.id, req.params.id, childUpdate.parse(req.body))) };
  });

  app.post("/v1/session/child", async (req) => {
    const { session } = await auth.consented(req);
    const b = chooseChild.parse(req.body);
    return { child: childView(await accounts.chooseChild(session, b.childId)) };
  });
}
