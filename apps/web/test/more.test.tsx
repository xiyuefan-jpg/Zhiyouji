import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dataRequests } from "@zhiyouji/db";
import { beijingInstant } from "@zhiyouji/engine";
import { renderApp, seasonPlayer } from "./seasonPlayer";

describe("赛季日历 (B2), 小组公开主页 (F4), 作品展 (F5), 公告, 导出或删除数据 (G4)", () => {
  it("the calendar highlights today and links an event to its page", async () => {
    const be = await seasonPlayer();
    const user = userEvent.setup();
    renderApp("/season/calendar");
    expect(await screen.findByText(/第 0 天 · 1月10日（今天）/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /第 1 周周战争配对/ }));
    expect(await screen.findByRole("heading", { name: "第 1 周周战争" })).toBeTruthy();
    await be.stop();
  });

  it("ranking → a team's public page; the showcase is empty before anything settles", async () => {
    const be = await seasonPlayer();
    const user = userEvent.setup();
    renderApp("/report?tab=ranking");
    const st = await be.services.store.state(be.serverId);
    const other = st.teamOrder.find((t) => !st.teams[t]!.members.some((m) => m.childId === be.childId))!;
    await user.click(await screen.findByText(st.teams[other]!.name));
    expect(await screen.findByText("团队分从哪来")).toBeTruthy();
    expect(screen.getByText(/组员年级：/)).toBeTruthy();
    expect(screen.getByText("还没有公开的作品")).toBeTruthy();
    await be.stop();
  });

  it("announcements list and detail", async () => {
    const be = await seasonPlayer();
    await be.services.ops.createAnnouncement({ scope: "all", title: "春节放假", body: "2 月 10 日到 17 日暂停。", publishAt: new Date(beijingInstant("2027-01-10", 10, 0)) }, "admin:test");
    const user = userEvent.setup();
    renderApp("/announcements");
    await user.click(await screen.findByText("春节放假"));
    expect(await screen.findByText("2 月 10 日到 17 日暂停。")).toBeTruthy();
    await be.stop();
  });

  it("G4: the parent exports a child's data and asks to delete it, then withdraws", async () => {
    const be = await seasonPlayer();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/me/privacy");
    await user.click(await screen.findByRole("button", { name: "导出" }));
    expect(await screen.findByText(/的数据已经整理好了/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "好的" }));
    await user.click(screen.getAllByRole("button", { name: "删除" })[0]!);
    await user.click((await screen.findAllByRole("button", { name: "申请删除" })).at(-1)!);
    expect(await screen.findByText(/已申请删除小明的数据/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "撤回申请" }));
    await waitFor(async () => {
      const rows = await be.db.select().from(dataRequests);
      expect(rows.map((r) => [r.kind, r.status]).sort()).toEqual([
        ["delete", "cancelled"],
        ["export", "done"],
      ]);
    });
    await be.stop();
  });
});
