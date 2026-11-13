import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { opLog } from "@zhiyouji/db";
import { startBackend } from "./backend";
import { account, login, renderConsole, seasonWithWork } from "./helpers";

describe("admin console: 赛季监控与干预 (part 7 §7)", () => {
  it("overview, an intervention with a reason, pause with a reason", async () => {
    const be = await startBackend();
    const s = await seasonWithWork(be);
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole(`/monitor/${s.serverId}`);
    await login(be, user, "boss@example.com", secret);
    expect(await screen.findByText(/第三季 · .* · 第 2 天/)).toBeTruthy();
    const st = await be.services.store.state(s.serverId);
    const team = st.teams[s.teamId]!;
    expect(screen.getAllByText(team.name).length).toBeGreaterThan(0);

    // 人工干预: +20 grain to the team
    await user.click(screen.getByRole("tab", { name: "人工干预" }));
    const panel = await screen.findByRole("tabpanel");
    await user.click(within(panel).getAllByRole("combobox")[0]!);
    await user.click(await screen.findByTitle("加减粮草或团队分"));
    await user.click(within(panel).getAllByRole("combobox")[1]!);
    await user.click((await screen.findAllByTitle(team.name)).at(-1)!);
    await user.type(within(panel).getByRole("spinbutton"), "20");
    await user.type(within(panel).getByLabelText("原因（进操作日志）"), "补发奖励");
    await user.click(within(panel).getByRole("button", { name: "执 行" }));
    await user.click((await screen.findAllByRole("button", { name: "确 定" })).at(-1)!);
    await waitFor(async () => {
      const after = await be.services.store.state(s.serverId);
      expect(after.ledger.some((e) => e.teamId === s.teamId && e.currency === "grain" && e.amount === 20 && e.source === "admin")).toBe(true);
    });
    expect((await be.db.select().from(opLog)).some((r) => r.reason === "补发奖励")).toBe(true);

    // pause asks for a reason
    await user.click(screen.getByRole("button", { name: "暂 停" }));
    await user.type(await screen.findByLabelText("原因"), "春节");
    await user.click((await screen.findAllByRole("button", { name: "确 定" })).at(-1)!);
    await waitFor(async () => expect((await be.services.store.state(s.serverId)).paused).toBe(true));
    await be.stop();
  });
});
