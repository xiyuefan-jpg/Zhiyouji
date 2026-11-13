import { describe, expect, it } from "vitest";
import { messages, plannedEvents } from "@zhiyouji/db";
import { dateOfSeasonDay } from "@zhiyouji/engine";
import { Scheduler, SeasonStore, totpAt, Worker } from "../src/index.js";
import { bj, setup } from "./helpers.js";

const OPENING = "2027-01-03";

describe("worker loop", () => {
  it("runs due planned events of live servers, tells admins about failures, sends SMS", async () => {
    const t = await setup(bj(OPENING, 18));
    const store = new SeasonStore(t.db);
    const worker = new Worker(t.db, new Scheduler(t.db, store, t.clock), t.services.smsDispatcher, t.services.notifier);
    expect(await worker.tick()).toMatchObject({ servers: 0, ran: 0 });

    const teams = Array.from({ length: 8 }, (_, i) => ({ name: `组${i + 1}`, members: [{ childId: `c${i}`, grade: 4 }] }));
    const { serverId } = await store.createSeason({ name: "S3", opening: OPENING, seed: 1, createdBy: "admin", teams, at: bj(OPENING, 19) });

    // an active admin to receive the failure notice
    const inv = await t.services.admin.invite("cli", { email: "boss@example.com", name: "boss", role: "admin" });
    const { secret } = await t.services.admin.startInvite(inv.inviteToken, "a-long-password");
    await t.services.admin.finishInvite(inv.inviteToken, totpAt(secret, +t.clock.now()));

    // a planned event that cannot run (no epic auction is open)
    await t.db.insert(plannedEvents).values({ serverId, key: "broken", kind: "close_epic_auction", runAt: bj(OPENING, 18), params: { engineEvent: "close_epic_auction" } });

    t.clock.set(bj(dateOfSeasonDay(OPENING, 1), 21, 1));
    const r = (await worker.tick())!;
    expect(r.servers).toBe(1);
    expect(r.ran).toBeGreaterThan(1);
    expect(r.failed).toEqual(["broken"]);
    const notes = await t.db.select().from(messages);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ recipientKind: "admin", type: "planned_event_failed", title: "计划事件失败" });
    // a second pass does nothing new and does not notify twice
    const again = (await worker.tick())!;
    expect(again.ran).toBe(0);
    expect(await t.db.select().from(messages)).toHaveLength(1);
    // the admin re-runs it by hand; it still cannot run and stays failed
    const rerun = await new Scheduler(t.db, store, t.clock).rerun(serverId, "broken");
    expect(rerun.ran).toEqual([{ key: "broken", engineEvent: "close_epic_auction", ok: false, refusal: expect.any(String) }]);
    await t.close();
  });
});
