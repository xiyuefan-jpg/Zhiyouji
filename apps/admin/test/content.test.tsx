import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { announcements, landTemplates, prompts } from "@zhiyouji/db";
import { startBackend } from "./backend";
import { account, login, renderConsole, seasonWithWork } from "./helpers";

describe("admin console: 题库, 公告, 看板 (part 7 §1, §4, §8)", () => {
  it("import the 12 land templates, add and enable a prompt", async () => {
    const be = await startBackend();
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole("/content");
    await login(be, user, "boss@example.com", secret);
    await user.click(await screen.findByRole("tab", { name: "地块模板" }));
    await user.click(await screen.findByRole("button", { name: "一键导入内容库的 12 个地块" }));
    await waitFor(async () => expect(await be.db.select().from(landTemplates)).toHaveLength(12));
    expect(await screen.findByText("火焰山")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "题目" }));
    await user.click(await screen.findByRole("button", { name: "新建题目" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByRole("combobox")[1]!);
    await user.click((await screen.findAllByTitle("火焰山")).at(-1)!);
    await user.type(within(dialog).getByLabelText("标题"), "为什么火焰山这么热");
    await user.type(within(dialog).getByLabelText("题目正文（孩子看到的）"), "用你学到的知识解释火焰山为什么这么热。");
    await user.click(within(dialog).getByRole("button", { name: "保 存" }));
    expect(await screen.findByText("为什么火焰山这么热")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "启 用" }));
    await waitFor(async () => expect((await be.db.select().from(prompts))[0]!.status).toBe("enabled"));
    await be.stop();
  });

  it("an announcement is saved; the dashboard shows today and the servers", async () => {
    const be = await startBackend();
    await seasonWithWork(be);
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole("/");
    await login(be, user, "boss@example.com", secret);
    expect(await screen.findByText("各服")).toBeTruthy();
    expect(await screen.findByText("交了作品")).toBeTruthy();
    expect(screen.getByText(/第三季 · /)).toBeTruthy();

    await user.click(screen.getByText("内容与运营"));
    await user.type(await screen.findByLabelText("标题"), "春节放假");
    await user.type(screen.getByLabelText("内容"), "2 月 10 日到 17 日暂停。");
    await user.click(screen.getByRole("button", { name: "保 存" }));
    await waitFor(async () => expect((await be.db.select().from(announcements)).map((a) => a.title)).toEqual(["春节放假"]));
    await be.stop();
  });
});
