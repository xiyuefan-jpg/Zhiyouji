/**
 * Server entry point (PRD part 2 §2): the API plus the background worker in
 * one process (enough for season 1). Outside services are the fake ones
 * until the Aliyun accounts exist; codes and reminders are then only logged.
 */

import { createPgDb, createPgliteDb } from "@zhiyouji/db";
import { realClock } from "./clock.js";
import { defaultConfig } from "./config.js";
import { buildApp } from "./http/app.js";
import { FakeCaptcha, FakeSms } from "./providers.js";
import { Worker } from "./worker.js";

async function main() {
  const env = process.env;
  const cfg = defaultConfig(env);
  if (env.NODE_ENV === "production" && cfg.secret === "dev-secret-change-me") throw new Error("SERVER_SECRET must be set in production");
  const { db } = env.DATABASE_URL ? await createPgDb(env.DATABASE_URL) : await createPgliteDb(env.PGLITE_DIR);
  const clock = realClock;
  // TODO(Aliyun SMS): replace once the signature and templates are approved.
  const sms = new FakeSms(env.NODE_ENV === "production" ? undefined : (line) => console.log(line));
  const { app, services } = buildApp({ db, clock, cfg, sms, captcha: new FakeCaptcha(), logger: true, trustProxy: env.TRUST_PROXY === "1" });

  const worker = new Worker(db, services.scheduler, services.smsDispatcher, services.notifier, services.reports);
  const tickMs = Number(env.TICK_MS ?? 30_000);
  setInterval(() => {
    worker.tick().then(
      (r) => r && (r.ran || r.sms.sent || r.failed.length) && app.log.info({ worker: r }, "worker tick"),
      (err) => app.log.error(err, "worker tick failed"),
    );
  }, tickMs);

  const port = Number(env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`worker tick every ${tickMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
