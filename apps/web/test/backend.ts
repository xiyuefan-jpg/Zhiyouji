/**
 * The real server (apps/server) running in-process for the website tests:
 * fetch calls go to Fastify's inject, with a cookie jar like a browser.
 */
import { vi } from "vitest";
import { createPgliteDb } from "@zhiyouji/db";
import { beijingInstant } from "@zhiyouji/engine";
import { buildApp, defaultConfig, FakeCaptcha, FakeSms, SimClock } from "@zhiyouji/server";

/** jsdom's Blob has no arrayBuffer(); FileReader works. */
function readBlob(b: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(Buffer.from(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(b);
  });
}

export async function startBackend() {
  const { db, close } = await createPgliteDb();
  const clock = new SimClock(new Date(beijingInstant("2027-01-04", 10, 0)));
  const cfg = defaultConfig();
  const sms = new FakeSms();
  const { app, services } = buildApp({ db, clock, cfg, sms, captcha: new FakeCaptcha() });
  await app.ready();
  let cookie = "";
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init.body instanceof Blob ? await readBlob(init.body) : (init.body as string | undefined);
    const res = await app.inject({
      method: (init.method ?? "GET") as "GET",
      url,
      payload: body,
      headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) },
    });
    const set = res.headers["set-cookie"];
    if (set) {
      const first = String(Array.isArray(set) ? set[0] : set).split(";")[0]!;
      cookie = first.endsWith("=") ? "" : first;
    }
    return new Response(res.body, { status: res.statusCode, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    db,
    clock,
    cfg,
    sms,
    services,
    fetchMock,
    async stop() {
      vi.unstubAllGlobals();
      await app.close();
      await close();
    },
  };
}
