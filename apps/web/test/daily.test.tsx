import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ConfigProvider } from "antd-mobile";
import { knowledgeCards } from "@zhiyouji/db";
import { App } from "../src/App";
import { startBackend } from "./backend";

const TEXT = "我今天用AI学了大气压。原来我以为空气没有重量，后来懂了空气也有重量会压在我们身上。我自己想到的例子是用吸管喝饮料，其实是外面的大气把饮料压进嘴里。";

describe("student website: 每日任务 (part 5 C1–C3)", () => {
  it("首页 → 去修行 → template → evidence + explanation + AI line → passed with a knowledge card", async () => {
    const be = await startBackend();
    await be.services.family.requestCode("13812345678", undefined);
    const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
    await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
    const c = await be.services.family.createChild(login.family.id, { nickname: "小明", grade: 5, avatar: "a1", explainPref: "text" });
    await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, c.id);
    const realFetch = be.fetchMock.getMockImplementation()!;
    be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    const user = userEvent.setup();
    render(
      <ConfigProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </ConfigProvider>,
    );
    await user.click(await screen.findByText("去修行"));
    await user.click(await screen.findByText("用 AI 学了一个新知识"));
    expect(await screen.findByText(/和 AI 对话的截图/)).toBeTruthy();

    // the page checks before sending anything
    await user.click(screen.getByRole("button", { name: "交上去" }));
    expect((await screen.findByRole("alert")).textContent).toBe("至少交一张证据图片");

    await user.upload(screen.getByLabelText("选择证据图片"), new File(["jpg"], "chat.jpg", { type: "image/jpeg" }));
    await user.type(screen.getByPlaceholderText("写 50–150 个字"), TEXT);
    await user.type(screen.getByPlaceholderText("一句话就好"), "我让 AI 举了三个例子");
    await user.click(screen.getByRole("button", { name: "交上去" }));

    expect(await screen.findByText("审核结果")).toBeTruthy();
    expect(await screen.findByText(/做得好的/)).toBeTruthy();
    expect(screen.getByText("已经记进修行日志")).toBeTruthy();
    const [card] = await be.db.select().from(knowledgeCards);
    expect(screen.getByText(card!.title)).toBeTruthy();
    await be.stop();
  });
});
