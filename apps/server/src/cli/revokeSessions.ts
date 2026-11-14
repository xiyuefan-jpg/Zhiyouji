/**
 * Incident response (PRD part 8 §3.5; docs/security/数据泄露处置手册.md):
 * end every open login at once and write it to the operation log.
 *
 *   DATABASE_URL=... npm run revoke-sessions -w @zhiyouji/server -- <admin|family|all> "<reason>"
 *
 * Everyone on that side logs in again (parents with a new SMS code, admins
 * with password + two-step code). Run it after changing a leaked password or
 * SERVER_SECRET.
 */

import { createPgDb, createPgliteDb, opLog } from "@zhiyouji/db";
import { Sessions } from "../accounts/sessions.js";
import { realClock } from "../clock.js";
import { defaultConfig } from "../config.js";

async function main() {
  const [kind, reason] = process.argv.slice(2);
  if ((kind !== "admin" && kind !== "family" && kind !== "all") || !reason) {
    console.error('usage: revoke-sessions <admin|family|all> "<reason>"');
    process.exit(2);
  }
  const cfg = defaultConfig(process.env);
  const { db, close } = process.env.DATABASE_URL ? await createPgDb(process.env.DATABASE_URL) : await createPgliteDb(process.env.PGLITE_DIR);
  const n = await new Sessions(db, realClock, cfg).revokeKind(kind);
  await db.insert(opLog).values({ actor: "cli", action: "sessions_revoke", object: `sessions:${kind}`, after: { ended: n }, reason, at: realClock.now() });
  console.log(`ended ${n} open logins (${kind})`);
  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
