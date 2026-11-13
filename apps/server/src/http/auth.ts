/**
 * Reading the login from a request: `Authorization: Bearer <token>` (the
 * admin console and, later, the packaged app) or the session cookie (the
 * student website).
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../config.js";

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function readToken(req: FastifyRequest, cookieName: string): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim() || undefined;
  return readCookie(req, cookieName);
}

export function setSessionCookie(reply: FastifyReply, cfg: ServerConfig, name: string, token: string, expiresAt: Date | null): void {
  const parts = [`${name}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (expiresAt) parts.push(`Expires=${expiresAt.toUTCString()}`);
  if (cfg.cookies.secure) parts.push("Secure");
  reply.header("set-cookie", parts.join("; "));
}

export function clearSessionCookie(reply: FastifyReply, cfg: ServerConfig, name: string): void {
  setSessionCookie(reply, cfg, name, "", new Date(0));
}
