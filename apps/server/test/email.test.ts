import { describe, expect, it } from "vitest";
import { emailOutbox } from "@zhiyouji/db";
import type { FakeEmail } from "../src/providers.js";
import { bj, setup } from "./helpers.js";

describe("管理端 + 邮件 (part 8 §1.2)", () => {
  it("urgent admin notices also go by email with only the title and a link; others do not; failures are retried 3 times", async () => {
    const t = await setup(bj("2027-03-10", 10));
    await t.adminUser("boss@example.com", "admin");
    await t.adminUser("rev@example.com", "reviewer");
    const mail = t.services.email as FakeEmail;
    const n = t.services.notifier;
    await n.notifyAdmins({ kind: "daily_error", title: "每日任务审核出错", body: "一条每日任务（小雨的）2 小时还没有结果", link: "/daily/exceptions", dedupeKey: "d1", roles: ["admin"] });
    await n.notifyAdmins({ kind: "prompts_low", title: "题库不足", body: "火焰山只剩 1 条", link: "/question-bank", dedupeKey: "p1", roles: ["admin"] });
    // the same notice again: no second email
    await n.notifyAdmins({ kind: "daily_error", title: "每日任务审核出错", body: "…", link: "/daily/exceptions", dedupeKey: "d1", roles: ["admin"] });
    expect(await t.services.emailDispatcher.runDue()).toEqual({ sent: 1, failed: 0 });
    expect(mail.sent).toEqual([
      {
        to: "boss@example.com",
        subject: "【智游记管理端】每日任务审核出错",
        text: "每日任务审核出错\n\n详情请登录管理端查看：http://localhost:5174/daily/exceptions\n\n（这封邮件由系统自动发送，不含孩子的信息。）",
      },
    ]);
    // the body of the notice (which may name a child) is not in the email
    expect(mail.sent[0]!.text).not.toContain("小雨");

    // the reviewer's assignment; the provider is down: 3 tries, 2 minutes apart, then failed
    mail.fail = true;
    await n.notifyAdmins({ kind: "review_assigned", title: "有新作品要复核", body: "分给你 2 件", link: "/reviews", dedupeKey: "r1", roles: ["reviewer"] });
    expect(await t.services.emailDispatcher.runDue()).toEqual({ sent: 0, failed: 0 });
    t.clock.advance(2 * 60_000);
    await t.services.emailDispatcher.runDue();
    t.clock.advance(2 * 60_000);
    expect(await t.services.emailDispatcher.runDue()).toEqual({ sent: 0, failed: 1 });
    const rows = await t.db.select().from(emailOutbox);
    expect(rows.map((r) => [r.to, r.status, r.attempts])).toEqual([
      ["boss@example.com", "sent", 1],
      ["rev@example.com", "failed", 3],
    ]);
    await t.close();
  });
});
