import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beijingInstant } from "@zhiyouji/engine";
import { renderApp, seasonPlayer } from "./seasonPlayer";

describe("student website: 法宝囊, 争夺详情, 移交, 偏好 (part 5 E5, E7, E3, D4)", () => {
  it("法宝囊: the catalogue, choosing a target, the confirmation, and 被挡下了", async () => {
    const be = await seasonPlayer();
    const ctx = await be.services.play.ctx(be.childId);
    await be.services.play.claimRole(ctx, "leader");
    const st = await be.services.store.state(be.serverId);
    const other = st.teamOrder.find((t) => t !== ctx.teamId)!;
    await be.services.control.intervene(be.serverId, { action: "give_item", teamId: ctx.teamId, itemId: "zijin", reason: "测试" }, "admin:test");
    await be.services.control.intervene(be.serverId, { action: "give_item", teamId: other, itemId: "bihuo", reason: "测试" }, "admin:test");
    be.clock.set(new Date(beijingInstant("2027-01-12", 10, 0)));
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/season/items");
    expect(await screen.findByText("法宝图鉴")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /紫金红葫芦/ }));
    const detail = await screen.findByLabelText("紫金红葫芦详情");
    expect(within(detail).getByText("效果：选一个组：从它那里抢 5 分（目标排名比你们低时 × 0.5）。")).toBeTruthy();
    await user.click(await within(detail).findByText(new RegExp(st.teams[other]!.name)));
    await user.click(within(detail).getByRole("button", { name: "使用" }));
    expect(await screen.findByText("用了以后会全服广播。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确定" }));
    expect(await screen.findByText(new RegExp(`被${st.teams[other]!.name}的辟火罩挡下了`))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /紫金红葫芦/ })).toBeNull());
    await be.stop();
  });

  it("a member sees the item but is told to ask the leader", async () => {
    const be = await seasonPlayer();
    const ctx = await be.services.play.ctx(be.childId);
    await be.services.control.intervene(be.serverId, { action: "give_item", teamId: ctx.teamId, itemId: "huanhun", reason: "测试" }, "admin:test");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/season/items");
    await user.click(await screen.findByRole("button", { name: /还魂金丹/ }));
    const detail = await screen.findByLabelText("还魂金丹详情");
    expect(within(detail).getByText("请组长或副组长操作。")).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "使用" })).toBeNull();
    await be.stop();
  });

  it("D4 盲拍: bid and order lands, then the land page links to the contest with its prompt", async () => {
    const be = await seasonPlayer();
    const ctx = await be.services.play.ctx(be.childId);
    await be.services.play.claimRole(ctx, "leader");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/season/rounds/blind_auction");
    expect(await screen.findByText(/出一个价/)).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "+ 火焰山" }));
    await user.click(screen.getByRole("button", { name: "+ E2" }));
    await user.click(screen.getByRole("button", { name: "E2上移" }));
    const bid = screen.getAllByLabelText("出价").find((e) => e.tagName === "INPUT")!;
    await user.clear(bid);
    await user.type(bid, "12");
    await user.click(screen.getByRole("button", { name: "提交" }));
    await user.click(await screen.findByRole("button", { name: "确定" }));
    await waitFor(async () => {
      const v = await be.services.play.roundView(await be.services.play.ctx(be.childId), "blind_auction");
      expect(v.submission).toMatchObject({ bid: 12, prefs: ["E2", "E1"] });
    });
    expect(await screen.findByText(/本组已提交：出价 12；E2 > 火焰山/)).toBeTruthy();
    await be.stop();
  });

  it("E7: the contest page shows the teams, the countdown and links to the work", async () => {
    const be = await seasonPlayer();
    const ctx = await be.services.play.ctx(be.childId);
    await be.services.play.claimRole(ctx, "leader");
    await be.services.play.submitRound(ctx, "blind_auction", { bid: 10, prefs: ["E1"] });
    be.clock.set(new Date(beijingInstant("2027-01-11", 21, 1)));
    await be.services.scheduler.runDue(be.serverId);
    be.clock.set(new Date(beijingInstant("2027-01-12", 10, 0)));
    const st = await be.services.store.state(be.serverId);
    const target = st.landOrder.find((l) => st.lands[l]!.kind === "edge" && st.lands[l]!.owner && st.lands[l]!.owner !== ctx.teamId)!;
    const c = await be.services.play.startContest(await be.services.play.ctx(be.childId), target);
    renderApp(`/season/contests/${c.contest.id}`);
    expect(await screen.findByText(`守方：${st.teams[st.lands[target]!.owner!]!.name}`)).toBeTruthy();
    expect(screen.getByText(`进攻方：${st.teams[ctx.teamId]!.name}`)).toBeTruthy();
    expect(screen.getByText(/作品截止：还剩/)).toBeTruthy();
    expect(screen.getByText("本组的作品")).toBeTruthy();
    expect(screen.getByText("去作品工坊")).toBeTruthy();
    await be.stop();
  });

  it("E3: the leader hands the seat to a member, who accepts", async () => {
    const be = await seasonPlayer();
    const ctx = await be.services.play.ctx(be.childId);
    await be.services.play.claimRole(ctx, "leader");
    const st = await be.services.store.state(be.serverId);
    const mate = st.teams[ctx.teamId]!.members.find((m) => m.childId !== be.childId)!.childId;
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/team");
    await user.click(await screen.findByRole("button", { name: "移交组长" }));
    const nick = (await be.services.play.me(be.childId)) as { members: { childId: string; nickname: string }[] };
    await user.click(screen.getAllByText(nick.members.find((m) => m.childId === mate)!.nickname)[0]!);
    await user.click(screen.getByRole("button", { name: "发给对方" }));
    expect(await screen.findByText(/等对方接受。/)).toBeTruthy();
    const mateCtx = await be.services.play.ctx(mate);
    const [t] = await be.services.play.pendingTransfers(mateCtx);
    await be.services.play.answerTransfer(mateCtx, t!.id, true);
    expect(((await be.services.play.me(be.childId)) as { role: string }).role).toBe("member");
    await be.stop();
  });
});
