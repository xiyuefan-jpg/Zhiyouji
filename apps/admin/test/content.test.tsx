import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { aiConfigs, aiDisclosures, aiPrices, announcements, rubricVersions, landTemplates, promptTemplates, prompts } from "@zhiyouji/db";
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

  it("AI 配置: a new prompt version from the built-in draft, made live; a model price (part 6 §4.2, §6.2)", async () => {
    const be = await startBackend();
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole("/content");
    await login(be, user, "boss@example.com", secret);
    await user.click(await screen.findByRole("tab", { name: "AI 配置" }));
    expect(await screen.findByText("T1 语音转写")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "提示词" }));
    expect(await screen.findByText("正在用：第 0 版（内置初版）")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "在正在用的版本上改" }));
    const box = (await screen.findByLabelText("提示词全文")) as HTMLTextAreaElement;
    expect(box.value).toContain("只判断三件事");
    await user.click(box);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.paste("补一句：不要因为错别字不通过。");
    await user.click(screen.getByRole("button", { name: "保存并启用" }));
    await waitFor(async () => expect((await be.db.select().from(aiConfigs)).map((c) => [c.task, c.promptVersion])).toEqual([["daily_review", 1]]));
    expect((await be.db.select().from(promptTemplates))[0]!.content).toContain("不要因为错别字不通过");
    expect(await screen.findByText("正在用：第 1 版")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "调用与费用" }));
    await user.click(await screen.findByRole("button", { name: "加一个模型" }));
    await screen.findByText("模型价格");
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    await user.type(within(dialog).getByLabelText("模型（和任务配置里写的一样）"), "qwen-vl-max");
    await user.type(within(dialog).getByLabelText("输入：元 / 百万 token"), "3");
    await user.click(within(dialog).getByRole("button", { name: "保 存" }));
    await waitFor(async () => expect((await be.db.select().from(aiPrices)).map((p) => [p.model, p.inPerMillion])).toEqual([["qwen-vl-max", 30000]]));
    await be.stop();
  }, 120_000);

  it("关于与 AI 公示: the admin fills the table the website shows (part 5 §8)", async () => {
    const be = await startBackend();
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole("/ops");
    await login(be, user, "boss@example.com", secret);
    await user.click(await screen.findByRole("tab", { name: "关于与 AI 公示" }));
    await user.click(await screen.findByRole("button", { name: "加一行" }));
    await user.type(screen.getByLabelText("用途 1"), "作品初评");
    await user.type(screen.getByLabelText("模型 1"), "通义千问");
    await user.type(screen.getByLabelText("提供方 1"), "阿里云");
    await user.click(screen.getByRole("button", { name: "保 存" }));
    await waitFor(async () => expect((await be.db.select().from(aiDisclosures)).map((d) => [d.purpose, d.model, d.provider])).toEqual([["作品初评", "通义千问", "阿里云"]]));
    await be.stop();
  });

  it("评分族: a new version with other points; the sum must be 100 (part 7 §4)", async () => {
    const be = await startBackend();
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole("/content");
    await login(be, user, "boss@example.com", secret);
    await user.click(await screen.findByRole("tab", { name: "评分族" }));
    await user.click(await screen.findByRole("button", { name: "在正在用的版本上改" }));
    const teach = await screen.findByLabelText("满分 teach");
    await user.clear(teach);
    await user.type(teach, "35");
    expect(await screen.findByText("满分合计 105（要等于 100）")).toBeTruthy();
    const pres = screen.getByLabelText("满分 presentation");
    await user.clear(pres);
    await user.type(pres, "5");
    await user.click(screen.getByRole("button", { name: "保存为新版本" }));
    await waitFor(async () => expect((await be.db.select().from(rubricVersions)).map((r) => [r.family, r.version])).toEqual([["A", 2]]));
    expect(await screen.findByText("正在用：第 2 版")).toBeTruthy();
    await be.stop();
  }, 120_000);
});
