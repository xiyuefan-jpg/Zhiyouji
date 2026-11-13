import type { FastifyInstance } from "fastify";
import { createPgliteDb } from "@zhiyouji/db";
import { beijingInstant } from "@zhiyouji/engine";
import { buildApp, defaultConfig, FakeCaptcha, FakeSms, SimClock, type ServerConfig } from "../src/index.js";

/** Beijing wall time → Date. */
export const bj = (d: string, h: number, m = 0) => new Date(beijingInstant(d, h, m));

export async function setup(start = bj("2027-01-04", 10), cfgPatch: (c: ServerConfig) => void = () => {}) {
  const { db, close } = await createPgliteDb();
  const clock = new SimClock(start);
  const cfg = defaultConfig();
  cfgPatch(cfg);
  const sms = new FakeSms();
  const { app, services } = buildApp({ db, clock, cfg, sms, captcha: new FakeCaptcha() });
  await app.ready();
  const call = (method: "GET" | "POST" | "PATCH", url: string, body?: unknown, token?: string, headers: Record<string, string> = {}) =>
    app.inject({ method, url, payload: body as object | undefined, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

  /** A logged-in family that agreed to the documents, with children created through the API. */
  async function family(phone: string, kids: { nickname: string; grade: number }[] = [], agree = true) {
    clock.advance(61_000); // clear the resend wait of earlier tests
    await call("POST", "/v1/auth/sms-code", { phone });
    const login = await call("POST", "/v1/auth/login", { phone, code: sms.lastCode(phone) });
    const token = login.json().token as string;
    if (agree) await call("POST", "/v1/family/consent", { choice: "agree", version: cfg.policyVersion }, token);
    const childIds: string[] = [];
    for (const k of kids) childIds.push((await call("POST", "/v1/children", k, token)).json().child.id);
    return { token, childIds, familyId: login.json().me.family.id as string };
  }

  return { db, close: async () => { await app.close(); await close(); }, clock, cfg, sms, app: app as FastifyInstance, services, call, family };
}
