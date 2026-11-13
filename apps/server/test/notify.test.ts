import { describe, expect, it } from "vitest";
import { messages, smsOutbox } from "@zhiyouji/db";
import { isQuiet, quietRelease } from "../src/index.js";
import { bj, setup } from "./helpers.js";

describe("quiet hours 21:30–07:00 Beijing", () => {
  it("knows the window and when it ends", () => {
    expect(isQuiet(+bj("2027-01-04", 21, 29))).toBe(false);
    expect(isQuiet(+bj("2027-01-04", 21, 30))).toBe(true);
    expect(isQuiet(+bj("2027-01-05", 6, 59))).toBe(true);
    expect(isQuiet(+bj("2027-01-05", 7, 0))).toBe(false);
    expect(quietRelease(+bj("2027-01-04", 22, 0))).toBe(+bj("2027-01-05", 7, 0));
    expect(quietRelease(+bj("2027-01-05", 3, 0))).toBe(+bj("2027-01-05", 7, 0));
    expect(quietRelease(+bj("2027-01-05", 12, 0))).toBe(+bj("2027-01-05", 12, 0));
  });
});

describe("notifications (part 8 §1, round 30)", () => {
  it("message for every child; one SMS per phone for the urgent kinds; siblings merged", async () => {
    const t = await setup();
    const a = await t.family("13800000001", [
      { nickname: "哥哥", grade: 6 },
      { nickname: "妹妹", grade: 3 },
    ]);
    const b = await t.family("13800000002", [{ nickname: "小红", grade: 5 }]);
    const r = await t.services.notifier.notify({
      kind: "attacked",
      childIds: [...a.childIds, ...b.childIds],
      title: "你们组被进攻了",
      body: "三组向火焰山发起了进攻。",
      link: "/contest/K1",
      dedupeKey: "attacked:K1",
    });
    expect(r).toEqual({ messages: 3, smsQueued: 2 });
    // the same event again changes nothing
    expect(await t.services.notifier.notify({ kind: "attacked", childIds: a.childIds, title: "x", body: "y", dedupeKey: "attacked:K1" })).toEqual({ messages: 0, smsQueued: 0 });
    // another team joins before the SMS went out → folded into the waiting one
    expect((await t.services.notifier.notify({ kind: "joined_attack", childIds: a.childIds, title: "有组加入了进攻", body: "五组加入。", dedupeKey: "joined:K1:T5" })).smsQueued).toBe(0);

    const sent = await t.services.smsDispatcher.runDue();
    expect(sent.sent).toBe(2);
    expect(t.sms.sent.filter((s) => s.kind === "attack").map((s) => s.phone).sort()).toEqual(["13800000001", "13800000002"]);
    // after it went out, a new attack is a new SMS
    expect((await t.services.notifier.notify({ kind: "attacked", childIds: b.childIds, title: "x", body: "y", dedupeKey: "attacked:K2" })).smsQueued).toBe(1);
    await t.close();
  });

  it("only the four urgent kinds send SMS; families that did not agree get none", async () => {
    const t = await setup();
    const a = await t.family("13800000001", [{ nickname: "哥哥", grade: 6 }]);
    for (const kind of ["report", "review_result", "announcement", "item_used", "work_due_2h", "submit_due"] as const)
      expect((await t.services.notifier.notify({ kind, childIds: a.childIds, title: kind, body: kind, dedupeKey: `${kind}:1` })).smsQueued).toBe(0);
    for (const kind of ["work_due_6h", "supply_due", "outbid"] as const)
      expect((await t.services.notifier.notify({ kind, childIds: a.childIds, title: kind, body: kind, dedupeKey: `${kind}:1` })).smsQueued).toBe(1);

    // a family that pressed 不同意 later: message center only
    await t.call("POST", "/v1/family/consent", { choice: "disagree", version: t.cfg.policyVersion }, a.token);
    expect(await t.services.notifier.notify({ kind: "attacked", childIds: a.childIds, title: "x", body: "y", dedupeKey: "attacked:K9" })).toEqual({ messages: 1, smsQueued: 0 });
    await t.close();
  });

  it("night: waits until 07:00 and merges; at most 5 reminders per phone per day", async () => {
    const t = await setup(bj("2027-01-04", 22, 0));
    const a = await t.family("13800000001", [{ nickname: "哥哥", grade: 6 }]);
    await t.services.notifier.notify({ kind: "attacked", childIds: a.childIds, title: "x", body: "y", dedupeKey: "attacked:K1" });
    await t.services.notifier.notify({ kind: "attacked", childIds: a.childIds, title: "x", body: "y", dedupeKey: "attacked:K2" });
    const [row] = await t.db.select().from(smsOutbox);
    expect(+row!.sendAfter).toBe(+bj("2027-01-05", 7, 0));
    expect(await t.db.select().from(smsOutbox)).toHaveLength(1);
    expect((await t.services.smsDispatcher.runDue()).sent).toBe(0);
    t.clock.set(bj("2027-01-05", 7, 1));
    expect((await t.services.smsDispatcher.runDue()).sent).toBe(1);

    // daily cap: 4 more go out today, the 6th is dropped (still in the message center)
    for (let i = 0; i < 5; i++) {
      t.clock.advance(60_000);
      await t.services.notifier.notify({ kind: "outbid", childIds: a.childIds, title: "x", body: "y", dedupeKey: `outbid:${i}` });
      await t.services.smsDispatcher.runDue();
    }
    const rows = await t.db.select().from(smsOutbox);
    expect(rows.filter((r) => r.status === "sent")).toHaveLength(5);
    expect(rows.filter((r) => r.status === "dropped")).toHaveLength(1);
    expect((await t.db.select().from(messages)).length).toBe(7);
    await t.close();
  });

  it("retries a failed send, then gives up", async () => {
    const t = await setup();
    const a = await t.family("13800000001", [{ nickname: "哥哥", grade: 6 }]);
    await t.services.notifier.notify({ kind: "outbid", childIds: a.childIds, title: "x", body: "y", dedupeKey: "outbid:1" });
    t.sms.fail = true;
    expect((await t.services.smsDispatcher.runDue()).failed).toBe(0);
    t.clock.advance(2 * 60_000);
    await t.services.smsDispatcher.runDue();
    t.clock.advance(2 * 60_000);
    expect((await t.services.smsDispatcher.runDue()).failed).toBe(1);
    const [row] = await t.db.select().from(smsOutbox);
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    await t.close();
  });

  it("message center: the chosen child's and the family's messages; read marks", async () => {
    const t = await setup();
    const a = await t.family("13800000001", [
      { nickname: "哥哥", grade: 6 },
      { nickname: "妹妹", grade: 3 },
    ]);
    const b = await t.family("13800000002", [{ nickname: "小红", grade: 5 }]);
    const [brother, sister] = a.childIds as [string, string];
    await t.services.notifier.notify({ kind: "report", childIds: [brother], title: "早间战报", body: "…", link: "/report", dedupeKey: "report:1:brother" });
    t.clock.advance(1000);
    await t.services.notifier.notify({ kind: "review_result", childIds: [sister], title: "每日任务通过了", body: "…", dedupeKey: "review:1" });
    await t.services.notifier.notify({ kind: "report", childIds: b.childIds, title: "别人家的", body: "…", dedupeKey: "report:1:b" });

    await t.call("POST", "/v1/session/child", { childId: brother }, a.token);
    const list = (await t.call("GET", "/v1/messages", undefined, a.token)).json().messages;
    expect(list.map((m: { title: string }) => m.title)).toEqual(["早间战报"]);
    expect((await t.call("GET", "/v1/messages/unread-count", undefined, a.token)).json().unread).toBe(1);
    // cannot mark someone else's message
    const sisterMsg = (await t.services.notifier.list([{ kind: "child", id: sister }]))[0]!;
    expect((await t.call("POST", `/v1/messages/${sisterMsg.id}/read`, undefined, a.token)).json().marked).toBe(0);
    expect((await t.call("POST", `/v1/messages/${list[0].id}/read`, undefined, a.token)).json().marked).toBe(1);
    expect((await t.call("GET", "/v1/messages/unread-count", undefined, a.token)).json().unread).toBe(0);

    await t.call("POST", "/v1/session/child", { childId: sister }, a.token);
    expect((await t.call("GET", "/v1/messages", undefined, a.token)).json().messages.map((m: { title: string }) => m.title)).toEqual(["每日任务通过了"]);
    expect((await t.call("POST", "/v1/messages/read-all", undefined, a.token)).json().marked).toBe(1);
    await t.close();
  });

  it("admin notification center", async () => {
    const t = await setup();
    await t.services.admin.invite("cli", { email: "boss@example.com", name: "boss", role: "admin" });
    // invited (not yet active) users get nothing
    expect(await t.services.notifier.notifyAdmins({ kind: "planned_event_failed", title: "x", body: "y", dedupeKey: "k1" })).toBe(0);
    await t.close();
  });
});
