/**
 * Server entry point (PRD part 2 §2). Phase 1: wires the season store and the
 * planned-event scheduler to a database and the real clock, and exposes a
 * health check. The REST API for each kind of operation (part 5–7) comes next;
 * external services (SMS, push, AI, storage) are stubbed until the accounts
 * exist (part 9 §1).
 */

import Fastify from "fastify";
import { createPgDb, createPgliteDb } from "@zhiyouji/db";
import { realClock } from "./clock.js";
import { Scheduler } from "./scheduler.js";
import { SeasonStore } from "./seasonStore.js";

async function main() {
  const url = process.env.DATABASE_URL;
  const { db } = url ? await createPgDb(url) : await createPgliteDb(process.env.PGLITE_DIR);
  const store = new SeasonStore(db);
  const scheduler = new Scheduler(db, store, realClock);

  const app = Fastify({ logger: true });
  app.get("/v1/health", async () => ({ ok: true, now: realClock.now().toISOString() }));

  // Background worker: run due planned events for every running server, on a tick.
  // (Phase 1: a simple interval; Redis-backed scheduling comes with the queue, part 2 §4.2.)
  const tick = Number(process.env.TICK_MS ?? 60_000);
  void scheduler; // used once the per-server loop lands with the admin API

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`tick every ${tick}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
