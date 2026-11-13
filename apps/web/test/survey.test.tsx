import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ConfigProvider } from "antd-mobile";
import { CURIOSITY_QUESTIONS } from "@zhiyouji/shared";
import { children, surveyAnswers } from "@zhiyouji/db";
import { App } from "../src/App";
import { pairQuestions } from "../src/pages/SurveyPage";
import { startBackend } from "./backend";

async function loggedIn() {
  const be = await startBackend();
  await be.services.family.requestCode("13812345678", undefined);
  const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
  await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
  const c = await be.services.family.createChild(login.family.id, { nickname: "小明", grade: 5, avatar: "a1", explainPref: "voice" });
  await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, c.id);
  const realFetch = be.fetchMock.getMockImplementation()!;
  be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
  localStorage.setItem("zyj_privacy_notice", "2027-01");
  return { ...be, childId: c.id };
}

function renderAt(path: string) {
  return render(
    <ConfigProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ConfigProvider>,
  );
}

describe("土地公问卷 (A4) and 新手引导 (A5)", () => {
  it("pairs cover all 16 questions once", () => {
    const p = pairQuestions(() => 0.3);
    expect(p).toHaveLength(8);
    expect(new Set(p.flat()).size).toBe(16);
  });

  it("home shows both cards; the survey runs one screen at a time and sets the default explanation", async () => {
    const be = await loggedIn();
    const user = userEvent.setup();
    renderAt("/");
    expect(await screen.findByText("第一次来？看看怎么玩（1 分钟）")).toBeTruthy();
    await user.click(await screen.findByText("和土地公认识一下"));
    await user.click(await screen.findByRole("button", { name: "好呀" }));
    // 8 rounds: always take the first of the two
    for (let i = 0; i < 8; i++) {
      expect(await screen.findByText(`第 ${i + 1} / 8 轮`)).toBeTruthy();
      const q = CURIOSITY_QUESTIONS.find((x) => screen.queryByText(x.text))!;
      await user.click(screen.getByText(q.text));
    }
    expect(await screen.findByText("最后，你最最想知道哪一个？")).toBeTruthy();
    await user.click(screen.getAllByRole("button").find((b) => CURIOSITY_QUESTIONS.some((q) => q.text === b.textContent))!);
    await user.type(await screen.findByPlaceholderText("写下来（可以跳过）"), "黑洞里面是什么");
    await user.click(screen.getByRole("button", { name: "下一个" }));
    await user.click(await screen.findByText("画画"));
    await user.click(screen.getByText("看书"));
    await user.click(screen.getByRole("button", { name: "下一个" }));
    await user.click(await screen.findByText("聊过几次"));
    await user.click(await screen.findByText("问问题"));
    await user.click(screen.getByRole("button", { name: "下一个" }));
    await user.click(await screen.findByText(/研究地图和攻略的/));
    await user.click(await screen.findByRole("button", { name: "✍️ 写给你看" }));
    await user.type(screen.getByPlaceholderText("写给土地公看"), "我学会了用筷子夹豆子");
    await user.click(screen.getByRole("button", { name: "讲完了" }));
    expect(await screen.findByText("太好了！你的取经路开始啦。")).toBeTruthy();
    const [a] = await be.db.select().from(surveyAnswers);
    expect(a).toMatchObject({ style: "strategist", challengeKind: "text", challengeText: "我学会了用筷子夹豆子" });
    expect((a!.answers as { hobbies: string[]; ownQuestion: string }).hobbies).toEqual(["画画", "看书"]);
    const [kid] = await be.db.select().from(children);
    expect(kid!.explainPref).toBe("text");
    await be.stop();
  });

  it("the guide: a child without a season gets the two common screens; finishing hides the home card", async () => {
    const be = await loggedIn();
    const user = userEvent.setup();
    renderAt("/guide");
    expect(await screen.findByText("每日任务")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("修行日志")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "知道了" }));
    await screen.findByText("今天要做的事");
    expect(screen.queryByText("第一次来？看看怎么玩（1 分钟）")).toBeNull();
    await be.stop();
  });
});
