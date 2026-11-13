import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { messages, smsOutbox, warCards } from "@zhiyouji/db";
import { WAR_CARDS } from "@zhiyouji/shared";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("weekly war cards and work reminders (part 3 §11; part 5 §3.5; part 8 §1.2)", () => {
  it("fixed week: everyone gets the fixed card; works not handed in are reminded 6 h (SMS) and 2 h before", async () => {
    const t = await contestSetup();
    t.clock.set(bj("2027-02-11", 19, 1)); // Thursday evening: W1 pairing
    await t.services.scheduler.runDue(t.serverId);
    const w1 = (await t.a1api("GET", "/v1/season/wars/1")).json();
    expect(w1).toMatchObject({ week: 1, gift: false, theme: { title: "家里的一个小麻烦" }, offered: [] });
    expect(w1.received.text).toContain("预算 ≤30 元");
    expect(w1.opponent.grades.length).toBeGreaterThan(0);
    expect((await t.a1api("POST", "/v1/season/wars/1/card", { card: "S1" })).json().error).toBe("not_gift_week");

    // the contest is due Friday 21:00; at 15:01 the attacker's leader and the defenders are reminded
    t.clock.set(bj("2027-02-12", 15, 1));
    await t.services.reminders.runDue(t.serverId);
    const six = await t.db.select().from(messages).where(eq(messages.type, "work_due_6h"));
    expect(six.map((m) => m.recipientId)).toContain(t.a1);
    expect(six[0]!.body).toContain("2月12日 21:00");
    expect((await t.db.select().from(smsOutbox)).some((s) => s.kind === "work_due")).toBe(true);
    // a1 hands it in; at 19:01 only the defenders get the 2-hour reminder
    await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "作品", members: [t.a1] });
    t.clock.set(bj("2027-02-12", 19, 1));
    await t.services.reminders.runDue(t.serverId);
    const two = await t.db.select().from(messages).where(eq(messages.type, "work_due_2h"));
    expect(two.length).toBeGreaterThan(0);
    expect(two.map((m) => m.recipientId)).not.toContain(t.a1);
    await t.close();
  });

  it("gift week: three cards from the whitelist, the leader sends one, Friday morning both sides see what they got (random if not chosen)", async () => {
    const t = await contestSetup();
    t.clock.set(bj("2027-02-18", 19, 1)); // W2 pairing (Thursday of week 2)
    await t.services.scheduler.runDue(t.serverId);
    const w2 = (await t.a1api("GET", "/v1/season/wars/2")).json();
    expect(w2.gift).toBe(true);
    expect(w2.offered).toHaveLength(3);
    const allowed = new Set(WAR_CARDS.filter((c) => c.weeks.includes(2)).map((c) => c.id));
    expect(w2.offered.every((c: { id: string }) => allowed.has(c.id))).toBe(true);
    expect(w2.received).toBeNull();
    const notMine = [...allowed].find((id) => !w2.offered.some((c: { id: string }) => c.id === id))!;
    expect((await t.a1api("POST", "/v1/season/wars/2/card", { card: notMine })).json().error).toBe("bad_card");
    const b1 = await t.as("13800000002", t.b1);
    if (!(await b1("GET", "/v1/season/me")).json().canAct) expect((await b1("POST", "/v1/season/wars/2/card", { card: w2.offered[0].id })).json().error).toBe("not_leader");
    const pick = w2.offered[1].id as string;
    expect((await t.a1api("POST", "/v1/season/wars/2/card", { card: pick })).json().chosen.id).toBe(pick);

    // 3 hours before Friday 07:00: teams that have not chosen are reminded
    t.clock.set(bj("2027-02-19", 4, 1));
    await t.services.reminders.runDue(t.serverId);
    const rem = await t.db.select().from(messages).where(eq(messages.dedupeKey, `submit_due:${t.serverId}:gift:2`));
    expect(rem.length).toBeGreaterThan(0);
    expect(rem.map((m) => m.recipientId)).not.toContain(t.a1);

    // Friday morning: revealed at the same time
    t.clock.set(bj("2027-02-19", 7, 1));
    await t.services.scheduler.runDue(t.serverId);
    expect((await t.a1api("POST", "/v1/season/wars/2/card", { card: pick })).json().error).toBe("too_late");
    const after = (await t.a1api("GET", "/v1/season/wars/2")).json();
    expect(after.received).not.toBeNull();
    const [opp] = await t.db.select().from(warCards).where(and(eq(warCards.serverId, t.serverId), eq(warCards.week, 2), eq(warCards.teamId, after.opponent.id)));
    expect(opp!.received).toBe(pick);
    expect(opp!.chosenBy).toBe("system");
    expect(after.received.id).toBe(opp!.chosen);
    expect((await t.a1api("GET", "/v1/messages")).json().messages.some((m: { title: string }) => m.title === "本周收到的词条")).toBe(true);
    await t.close();
  });
});
