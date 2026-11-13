import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beijingInstant } from "@zhiyouji/engine";
import { renderApp, seasonPlayer } from "./seasonPlayer";

describe("student website: 周战争, 军需任务, 商店 (part 5 E8–E11)", () => {
  it("军需任务: a member hands in their own part; progress counts it", async () => {
    const be = await seasonPlayer();
    be.clock.set(new Date(beijingInstant("2027-01-12", 19, 1))); // Tuesday evening: 1a published
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/season/supply");
    const card = await screen.findByLabelText(/军需任务 好奇心接力/);
    expect(within(card).getByText(/已交 0\//)).toBeTruthy();
    await user.type(within(card).getByPlaceholderText(/一个这周真实产生的问题/), "为什么天是蓝的？瑞利散射。");
    await user.click(within(card).getByRole("button", { name: "交我的那份" }));
    expect(await screen.findByText(/已交 1\//)).toBeTruthy();
    // members do not see the summary box
    expect(screen.queryByRole("button", { name: "交小结" })).toBeNull();
    await be.stop();
  });

  it("周战争 W2: the leader sends one of three cards to the opponent", async () => {
    const be = await seasonPlayer();
    const ctx = await be.services.play.ctx(be.childId);
    await be.services.play.claimRole(ctx, "leader");
    be.clock.set(new Date(beijingInstant("2027-01-21", 19, 1))); // Thursday of week 2: pairing
    await be.services.scheduler.runDue(be.serverId);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/season/wars/2");
    expect(await screen.findByText(/对手：/)).toBeTruthy();
    expect(screen.getByText(/对方的年级：/)).toBeTruthy();
    const send = await screen.findAllByRole("button", { name: "送这张" });
    expect(send).toHaveLength(3);
    await user.click(send[0]!);
    await user.click((await screen.findAllByRole("button", { name: "确定" })).at(-1)!);
    expect(await screen.findByText(/（已选）/)).toBeTruthy();
    await waitFor(async () => expect((await be.services.warWords.view(await be.services.play.ctx(be.childId), 2)).chosen).not.toBeNull());
    await be.stop();
  });

  it("商店 at D15: buy a common item with the confirmation; rare items wait for the preference round", async () => {
    const be = await seasonPlayer();
    const ctx = await be.services.play.ctx(be.childId);
    await be.services.play.claimRole(ctx, "leader");
    be.clock.set(new Date(beijingInstant("2027-01-25", 10, 0)));
    await be.services.scheduler.runDue(be.serverId);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/season/shop");
    expect(await screen.findByText(/商店开着：还剩/)).toBeTruthy();
    expect(screen.getByText(/灵品先按偏好分配/)).toBeTruthy();
    const row = (await screen.findByText("还魂金丹")).closest(".panel") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "买" }));
    expect(await screen.findByText(/花 50 粮草买还魂金丹？/)).toBeTruthy();
    await user.click((await screen.findAllByRole("button", { name: "确定" })).at(-1)!);
    await waitFor(() => expect(within((screen.getByText("还魂金丹").closest(".panel") as HTMLElement)).getByText("已买")).toBeTruthy());
    await be.stop();
  });
});
