import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beijingInstant } from "@zhiyouji/engine";
import { humanScores, reviewAssignments, settledScores } from "@zhiyouji/db";
import { startBackend } from "./backend";
import { account, login, renderConsole, seasonWithWork } from "./helpers";

describe("admin console: 复核 (part 7 §5)", () => {
  it("a reviewer opens the queue, scores the blind work with the rubric and a comment; the score settles", async () => {
    const be = await startBackend();
    const s = await seasonWithWork(be);
    const { secret } = await account(be, "r1@example.com", "reviewer");
    be.clock.set(new Date(beijingInstant("2027-01-15", 21, 1)));
    await be.services.scoring.runDue(s.serverId);
    expect(await be.db.select().from(reviewAssignments)).toHaveLength(1);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole("/review");
    await login(be, user, "r1@example.com", secret);
    await user.click(await screen.findByText("打开"));
    expect(await screen.findByText("我们用弹簧讲大气压")).toBeTruthy();
    expect(screen.getByText(/A · 现象解释/)).toBeTruthy();
    for (const [dim, n] of [["准确", 20], ["教会受众", 25], ["深度", 15], ["呈现与创意", 5], ["人机协作", 5]] as const) {
      await user.type(screen.getByLabelText(`${dim}得分`), String(n));
    }
    // the comment and each dimension's comment start from the AI's draft (part 7 §5.2)
    const box = screen.getByLabelText("评语") as HTMLTextAreaElement;
    expect(box.value).toContain("示例评语（假的 AI）");
    expect((screen.getByLabelText("准确评语") as HTMLTextAreaElement).value).toContain("示例理由");
    await user.clear(box);
    await user.type(box, "原理讲对了，例子可以更贴近受众。");
    await user.clear(screen.getByLabelText("教会受众评语"));
    await user.type(screen.getByLabelText("教会受众评语"), "受众能听懂，但少了一个生活里的例子。");
    await user.click(screen.getByRole("button", { name: "交 分" }));
    expect((await screen.findAllByText("交分 70 分？")).length).toBeGreaterThan(0);
    await user.click((await screen.findAllByRole("button", { name: "交 分" })).at(-1)!);
    await waitFor(async () => expect((await be.db.select().from(settledScores)).map((x) => x.score)).toEqual([70]));
    const [h] = await be.db.select().from(humanScores);
    expect(h!.comment).toBe("原理讲对了，例子可以更贴近受众。");
    expect((h!.reasons as Record<string, string>).teach).toBe("受众能听懂，但少了一个生活里的例子。");
    await be.stop();
  });
});

describe("admin console: 改判 (part 7 §5.3)", () => {
  it("after the AI timeout settles a contest, the admin rejudges and sees what to adjust by hand", async () => {
    const be = await startBackend();
    const s = await seasonWithWork(be);
    const { secret } = await account(be, "boss@example.com", "admin");
    be.clock.set(new Date(beijingInstant("2027-01-15", 21, 1)));
    await be.services.scoring.runDue(s.serverId);
    be.clock.set(new Date(beijingInstant("2027-01-16", 21, 2)));
    await be.services.scoring.runDue(s.serverId);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole(`/reviews/works/${s.workId}`);
    await login(be, user, "boss@example.com", secret);
    expect(await screen.findByText("我们用弹簧讲大气压")).toBeTruthy();
    expect(screen.getByText("已结算")).toBeTruthy();
    expect(screen.getByText(/超时按 AI 分/)).toBeTruthy();
    await user.type(screen.getByLabelText("分数"), "0");
    await user.type(screen.getByLabelText("说明"), "抄袭");
    await user.click(screen.getByRole("button", { name: "改 判" }));
    await user.click((await screen.findAllByRole("button", { name: "确 定" })).at(-1)!);
    expect(await screen.findByText(/结果有变化|结果没有变化/)).toBeTruthy();
    await waitFor(async () => expect((await be.db.select().from(settledScores)).map((x) => x.score)).toContain(0));
    await be.stop();
  });

  it("an admin reassigns a pending review from the work page (part 7 §6 改派)", async () => {
    const be = await startBackend();
    const s = await seasonWithWork(be);
    await account(be, "r1@example.com", "reviewer");
    const r2 = await account(be, "r2@example.com", "reviewer");
    void r2;
    const { secret } = await account(be, "boss@example.com", "admin");
    be.clock.set(new Date(beijingInstant("2027-01-15", 21, 1)));
    await be.services.scoring.runDue(s.serverId);
    const all = await be.db.select().from(reviewAssignments);
    const a = all[0];
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole(`/reviews/works/${s.workId}`);
    await login(be, user, "boss@example.com", secret);
    expect((await screen.findAllByText(/还没交/)).length).toBeGreaterThan(0);
    const users = await be.db.query.adminUsers.findMany();
    // one row per pending review (the first and any spot check); the first row is the first assignment
    const firstRow = (await screen.findAllByText(/还没交/))[0]!.textContent ?? "";
    const other = users.find((u) => !firstRow.startsWith(u.name))!;
    fireEvent.mouseDown(screen.getAllByRole("combobox", { name: "改派给" })[0]!);
    await user.click((await screen.findAllByText(other.name)).at(-1)!);
    await waitFor(async () => expect((await be.db.select().from(reviewAssignments)).some((x) => x.status === "pending" && x.reviewerId === other.id)).toBe(true));
    expect((await be.db.select().from(reviewAssignments)).some((x) => x.status === "reassigned")).toBe(true);
    void a;
    await be.stop();
  });
});
