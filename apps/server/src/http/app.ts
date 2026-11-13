/**
 * The API (PRD part 2 §2): builds the Fastify app with every route, given the
 * database, the clock and the outside services. Tests build it with PGlite,
 * a hand-moved clock and the fake SMS / captcha.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Db } from "@zhiyouji/db";
import { errorText } from "@zhiyouji/shared";
import { AdminAccounts } from "../accounts/admin.js";
import { FamilyAccounts } from "../accounts/family.js";
import { Sessions } from "../accounts/sessions.js";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import { Notifier, SmsDispatcher } from "../notify/notifier.js";
import type { CaptchaVerifier, SmsProvider } from "../providers.js";
import { AdminAuth, adminRoutes } from "./adminRoutes.js";
import { HttpError } from "./errors.js";
import { FamilyAuth, familyRoutes } from "./familyRoutes.js";
import { messageRoutes } from "./messageRoutes.js";

export interface AppDeps {
  db: Db;
  clock: Clock;
  cfg: ServerConfig;
  sms: SmsProvider;
  captcha: CaptchaVerifier;
  logger?: boolean;
  trustProxy?: boolean;
}

export interface Services {
  sessions: Sessions;
  family: FamilyAccounts;
  admin: AdminAccounts;
  notifier: Notifier;
  smsDispatcher: SmsDispatcher;
  familyAuth: FamilyAuth;
  adminAuth: AdminAuth;
}

export function buildServices(d: AppDeps): Services {
  const sessions = new Sessions(d.db, d.clock, d.cfg);
  const family = new FamilyAccounts(d.db, d.clock, d.cfg, sessions, d.sms, d.captcha);
  const admin = new AdminAccounts(d.db, d.clock, d.cfg, sessions);
  return {
    sessions,
    family,
    admin,
    notifier: new Notifier(d.db, d.clock, d.cfg),
    smsDispatcher: new SmsDispatcher(d.db, d.clock, d.cfg, d.sms),
    familyAuth: new FamilyAuth(d.cfg, sessions, family),
    adminAuth: new AdminAuth(d.cfg, sessions, admin),
  };
}

export function buildApp(d: AppDeps, services = buildServices(d)): { app: FastifyInstance; services: Services } {
  const app = Fastify({ logger: d.logger ?? false, trustProxy: d.trustProxy ?? false, bodyLimit: 256 * 1024 });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body());
    if (err instanceof ZodError) {
      const code = err.issues.map((i) => i.message).find((m) => errorText(m) !== errorText("bad_request")) ?? "bad_request";
      return reply.status(400).send({ error: code, message: errorText(code), fields: err.issues.map((i) => i.path.join(".")) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: "bad_request", message: errorText("bad_request") });
    req.log.error(err);
    return reply.status(500).send({ error: "server", message: "服务器出了点问题，请稍后再试" });
  });

  app.get("/v1/health", async () => ({ ok: true, now: d.clock.now().toISOString() }));
  familyRoutes(app, d.cfg, services.family, services.sessions, services.familyAuth);
  adminRoutes(app, d.cfg, services.admin, services.sessions, services.adminAuth);
  messageRoutes(app, services.notifier, services.familyAuth, services.adminAuth);
  return { app, services };
}
