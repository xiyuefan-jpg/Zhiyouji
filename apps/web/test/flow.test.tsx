import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ConfigProvider } from "antd-mobile";
import { App } from "../src/App";
import { startBackend } from "./backend";

function renderApp(path = "/") {
  return render(
    <ConfigProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ConfigProvider>,
  );
}

const button = (name: string) => screen.getByRole("button", { name });

describe("student website: first visit to the home page", () => {
  it("privacy pop-up → login → 家长确认 → child profile → 首页", async () => {
    const be = await startBackend();
    const user = userEvent.setup();
    renderApp();

    // A1: nothing is requested before the notice is accepted
    expect(await screen.findByText("欢迎来到智游记")).toBeTruthy();
    expect(be.fetchMock).not.toHaveBeenCalled();
    await user.click(button("同意并继续"));

    // A2: login with the parent's phone
    expect(await screen.findByText("家长手机号")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("11 位手机号"), "13812345678");
    await user.click(button("获取验证码"));
    expect(await screen.findByText(/秒后重发/)).toBeTruthy();
    await user.type(screen.getByPlaceholderText("6 位数字"), be.sms.lastCode("13812345678")!);
    await user.click(button("登录"));

    // 家长确认
    expect(await screen.findByText("家长确认")).toBeTruthy();
    expect(screen.getByText(/评审人员中有在境外的中国籍大学生/)).toBeTruthy();
    await user.click(button("同意"));

    // A3: first child profile
    expect(await screen.findByText("给孩子建个档案")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("1–12 个字"), "小明");
    await user.click(screen.getByText("四年级"));
    await user.click(screen.getByRole("radio", { name: "头像 葫" }));
    await user.click(button("建好了，开始"));

    // 首页 with the five tabs
    expect(await screen.findByText(/小明$/)).toBeTruthy();
    expect(screen.getByText("今天要做的事")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "主菜单" });
    for (const t of ["首页", "地图", "小组", "战报", "我"]) expect(within(nav).getByText(t)).toBeTruthy();

    const me = await be.services.family.listChildren((await be.db.query.families.findFirst())!.id);
    expect(me.map((c) => [c.nickname, c.grade, c.avatar])).toEqual([["小明", 4, "a2"]]);
    await be.stop();
  });

  it("不同意 on the privacy pop-up keeps everything closed", async () => {
    const be = await startBackend();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "不同意" }));
    expect(screen.getByText(/网站没有收集任何信息/)).toBeTruthy();
    expect(be.fetchMock).not.toHaveBeenCalled();
    await user.click(button("重新阅读"));
    expect(button("同意并继续")).toBeTruthy();
    await be.stop();
  });

  it("wrong code shows the server's message; 不同意 on 家长确认 blocks the site", async () => {
    const be = await startBackend();
    const user = userEvent.setup();
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    renderApp();
    await user.type(await screen.findByPlaceholderText("11 位手机号"), "13812345678");
    await user.click(button("获取验证码"));
    await screen.findByText(/秒后重发/);
    const right = be.sms.lastCode("13812345678")!;
    await user.type(screen.getByPlaceholderText("6 位数字"), right === "000000" ? "111111" : "000000");
    await user.click(button("登录"));
    expect((await screen.findByRole("alert")).textContent).toBe("验证码不对");

    await user.clear(screen.getByPlaceholderText("6 位数字"));
    await user.type(screen.getByPlaceholderText("6 位数字"), right);
    await user.click(button("登录"));
    await user.click(await screen.findByRole("button", { name: "不同意" }));
    expect(await screen.findByText("家长没有同意")).toBeTruthy();
    await user.click(button("重新阅读"));
    await user.click(await screen.findByRole("button", { name: "同意" }));
    expect(await screen.findByText("给孩子建个档案")).toBeTruthy();
    await be.stop();
  });
});

describe("student website: logged in", () => {
  async function loggedIn(kids: string[]) {
    const be = await startBackend();
    await be.services.family.requestCode("13812345678", undefined);
    const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
    await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
    const ids: string[] = [];
    for (const k of kids) ids.push((await be.services.family.createChild(login.family.id, { nickname: k, grade: 5, avatar: "a1", explainPref: "voice" })).id);
    // the browser holds this login
    const realFetch = be.fetchMock.getMockImplementation()!;
    be.fetchMock.mockImplementation((input, init = {}) =>
      realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }),
    );
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    return { ...be, familyId: login.family.id, childIds: ids };
  }

  it("我是谁 with two children; messages with unread badge and read marks", async () => {
    const be = await loggedIn(["哥哥", "妹妹"]);
    await be.services.notifier.notify({ kind: "attacked", childIds: [be.childIds[0]!], title: "你们组被进攻了", body: "三组向火焰山发起了进攻。", dedupeKey: "attacked:K1" });
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByText("我是谁？")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "哥哥，五年级" }));
    expect(await screen.findByText("你有 1 条新消息")).toBeTruthy();

    await user.click(screen.getByText("你有 1 条新消息"));
    expect(await screen.findByText("你们组被进攻了")).toBeTruthy();
    expect(screen.getByLabelText("未读")).toBeTruthy();
    await user.click(screen.getByText("你们组被进攻了"));
    await waitFor(() => expect(screen.queryByLabelText("未读")).toBeNull());
    const [msg] = await be.services.notifier.list([{ kind: "child", id: be.childIds[0]! }]);
    expect(msg!.read).toBe(true);
    await be.stop();
  });

  it("我 → 修改资料 changes the grade; 退出登录 goes back to login", async () => {
    const be = await loggedIn(["小红"]);
    await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, be.childIds[0]!);
    // the confirm dialog animates in; do not wait for pointer-events
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp("/me");
    expect(await screen.findByText("小红")).toBeTruthy();
    await user.click(screen.getByText("修改资料"));
    await user.click(await screen.findByText("六年级"));
    await user.click(button("保存"));
    await waitFor(async () => expect((await be.services.family.listChildren(be.familyId))[0]!.grade).toBe(6));

    await user.click(await screen.findByText("退出登录"));
    await user.click(await screen.findByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(screen.getByText("家长手机号")).toBeTruthy());
    await be.stop();
  });
});
