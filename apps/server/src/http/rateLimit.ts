/**
 * A plain fixed-window limit per login (session token) or, before login, per
 * IP (PRD part 8 §3.3). In memory: enough for one server process (season 1);
 * the SMS code and login limits are stricter and kept in the database.
 * Uploads to the dev storage and the health check are not counted.
 */

import type { FastifyInstance } from "fastify";
import { errorText } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import { sha256 } from "../security.js";

export function rateLimit(app: FastifyInstance, clock: Clock, perMinute: number): void {
  const windows = new Map<string, { start: number; n: number }>();
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/v1/") || req.url.startsWith("/v1/health") || req.url.startsWith("/v1/dev-storage")) return;
    const auth = req.headers.authorization ?? "";
    const cookie = req.headers.cookie ?? "";
    const who = auth.startsWith("Bearer ") ? `t:${sha256(auth.slice(7))}` : /zyj_[sa]=/.test(cookie) ? `c:${sha256(cookie)}` : `ip:${req.ip}`;
    const now = +clock.now();
    const w = windows.get(who);
    if (!w || now - w.start >= 60_000) {
      windows.set(who, { start: now, n: 1 });
      if (windows.size > 50_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
      return;
    }
    w.n++;
    if (w.n > perMinute) {
      reply.header("retry-after", String(Math.ceil((w.start + 60_000 - now) / 1000)));
      return reply.status(429).send({ error: "too_many_requests", message: errorText("too_many_requests") });
    }
  });
}
