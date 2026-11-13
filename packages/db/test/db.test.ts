import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteDb, seasons, servers, teams, plannedEvents } from "../src/index.js";

describe("database (PGlite)", () => {
  it("migrates and enforces the unique keys", async () => {
    const { db, close } = await createPgliteDb();
    const [season] = await db.insert(seasons).values({ name: "S3", openingDate: "2027-01-03", seed: 1 }).returning();
    const [server] = await db.insert(servers).values({ seasonId: season!.id, name: "一服" }).returning();
    await db.insert(teams).values({ serverId: server!.id, name: "花果山" });
    expect(await db.select().from(teams).where(eq(teams.serverId, server!.id))).toHaveLength(1);
    await db.insert(plannedEvents).values({ serverId: server!.id, key: "settle_day:1", kind: "settle_day", runAt: new Date() });
    await expect(db.insert(plannedEvents).values({ serverId: server!.id, key: "settle_day:1", kind: "settle_day", runAt: new Date() })).rejects.toThrow();
    await close();
  });
});
