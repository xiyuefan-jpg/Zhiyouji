/**
 * Database access. `Db` is the same type for PGlite (development and tests)
 * and node-postgres (production), so the server code does not care which.
 */

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export * as schema from "./schema.js";
export * from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** In-process PostgreSQL (PGlite) with all migrations applied. `dataDir` omitted = in memory. */
export async function createPgliteDb(dataDir?: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}

/** Production: PostgreSQL (Aliyun RDS) from a connection string; runs pending migrations. */
export async function createPgDb(connectionString: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString });
  const db = drizzlePg(pool, { schema });
  await migratePg(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => pool.end() };
}
