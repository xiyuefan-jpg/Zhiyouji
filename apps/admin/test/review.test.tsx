import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beijingInstant } from "@zhiyouji/engine";
import { reviewAssignments, settledScores } from "@zhiyouji/db";
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
    await user.type(screen.getByLabelText("评语"), "原理讲对了，例子可以更贴近受众。");
    await user.click(screen.getByRole("button", { name: "交 分" }));
    expect((await screen.findAllByText("交分 70 分？")).length).toBeGreaterThan(0);
    await user.click((await screen.findAllByRole("button", { name: "交 分" })).at(-1)!);
    await waitFor(async () => expect((await be.db.select().from(settledScores)).map((x) => x.score)).toEqual([70]));
    await be.stop();
  });
});
