/**
 * Create the first admin (or any admin console user) from the command line
 * and print the one-time invite token:
 *
 *   DATABASE_URL=... npm run invite-admin -w @zhiyouji/server -- <email> <name> [admin|reviewer]
 *
 * The person opens the admin console's invite page with the token, sets a
 * password and scans the two-step QR code.
 */

import { createPgDb, createPgliteDb } from "@zhiyouji/db";
import { AdminAccounts } from "../accounts/admin.js";
import { Sessions } from "../accounts/sessions.js";
import { realClock } from "../clock.js";
import { defaultConfig } from "../config.js";

async function main() {
  const [email, name, role = "admin"] = process.argv.slice(2);
  if (!email || !name || (role !== "admin" && role !== "reviewer")) {
    console.error("usage: invite-admin <email> <name> [admin|reviewer]");
    process.exit(2);
  }
  const cfg = defaultConfig(process.env);
  const { db, close } = process.env.DATABASE_URL ? await createPgDb(process.env.DATABASE_URL) : await createPgliteDb(process.env.PGLITE_DIR);
  const accounts = new AdminAccounts(db, realClock, cfg, new Sessions(db, realClock, cfg));
  const r = await accounts.invite("cli", { email: email.toLowerCase(), name, role });
  console.log(`invite token for ${email} (${role}), valid until ${r.expiresAt.toISOString()}:`);
  console.log(r.inviteToken);
  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
