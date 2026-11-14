import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messages } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";

describe("待补清单 (content library; part 7 §1, §4)", () => {
  it("the six items with deadlines counted from the next season; reminders a week and a day before; ticked off items stop", async () => {
    const t = await setup(bj("2027-01-20", 10));
    const boss = await t.adminUser();
    const call = (m: "GET" | "POST" | "PATCH", url: string, b?: unknown) => t.call(m, url, b, boss.token);
    // no season yet: the list has no dates
    let l = (await call("POST", "/v1/admin/content/todos/seed-defaults")).json();
    expect(l.items).toHaveLength(6);
    expect(l.items[0].dueAt).toBeNull();
    await t.services.seasons.create({ name: "S3", opening: "2027-02-07", seed: 1 }, "admin:x");
    l = (await call("GET", "/v1/admin/content/todos")).json();
    expect(l.season.name).toBe("S3");
    // sorted by deadline; D1 = 2027-02-08 00:00 Beijing
    expect(l.items.map((x: { dueDay: number }) => x.dueDay)).toEqual([1, 1, 3, 4, 8, 22]);
    expect(l.items[0].dueAt).toBe(bj("2027-02-08", 0).toISOString());

    // nothing is due within a week yet
    expect(await t.services.todos.remindDue()).toBe(0);
    t.clock.set(bj("2027-02-02", 9)); // 6 days before D1
    const tick = await t.services.todos.remindDue();
    expect(tick).toBe(2); // the two D1 items are within a week (D3 is 7 days 15 hours away)
    expect(await t.services.todos.remindDue()).toBe(0); // once per stage
    const token = await boss.relogin();
    const first = (await t.call("GET", "/v1/admin/content/todos", undefined, token)).json().items[0];
    expect((await t.call("PATCH", `/v1/admin/content/todos/${first.id}`, { done: true }, token)).json().items.at(-1)).toMatchObject({ id: first.id, done: true });
    t.clock.set(bj("2027-02-07", 9)); // the day before D1
    // the other D1 item (less than a day), D3 and D4 (within a week); the ticked-off one says nothing
    expect(await t.services.todos.remindDue()).toBe(3);
    const titles = (await t.db.select().from(messages).where(eq(messages.type, "content_todo"))).map((m) => m.title);
    expect(titles.filter((x) => x.includes(first.title))).toHaveLength(1);
    await t.close();
  });
});
