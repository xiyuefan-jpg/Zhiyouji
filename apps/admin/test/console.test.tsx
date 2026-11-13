import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { totpAt, TOTP_STEP_MS } from "@zhiyouji/server";
import { App } from "../src/App";
import { AuthProvider } from "../src/auth";
import { dualTime } from "../src/time";
import { startBackend } from "./backend";

function renderConsole(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

type Backend = Awaited<ReturnType<typeof startBackend>>;

/** Create an active account directly on the server (like the command-line invite). */
async function account(be: Backend, email: string, role: "admin" | "reviewer") {
  const inv = await be.services.admin.invite("cli", { email, name: email.split("@")[0]!, role });
  const { secret } = await be.services.admin.startInvite(inv.inviteToken, "a-long-password");
  await be.services.admin.finishInvite(inv.inviteToken, totpAt(secret, +be.clock.now()));
  be.clock.advance(TOTP_STEP_MS);
  return { secret };
}

async function login(be: Backend, user: ReturnType<typeof userEvent.setup>, email: string, secret: string) {
  await user.type(await screen.findByLabelText("邮箱"), email);
  await user.type(screen.getByLabelText("密码"), "a-long-password");
  await user.type(screen.getByLabelText("两步验证码"), totpAt(secret, +be.clock.now()));
  await user.click(screen.getByRole("button", { name: "登 录" }));
}

describe("admin console", () => {
  it("shows Beijing time and the viewer's local time", () => {
    expect(dualTime("2027-01-04T13:05:00Z", "America/New_York")).toEqual({ beijing: "1月4日 21:05", local: "08:05" });
    expect(dualTime("2027-01-04T02:00:00Z", "America/New_York")).toEqual({ beijing: "1月4日 10:00", local: "1月3日 21:00" });
    expect(dualTime("2027-01-04T02:00:00Z", "Asia/Shanghai")).toEqual({ beijing: "1月4日 10:00", local: null });
  });

  it("invite link → password → two-step QR → login → console", async () => {
    const be = await startBackend();
    const inv = await be.services.admin.invite("cli", { email: "boss@example.com", name: "老板", role: "admin" });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole(`/invite?token=${encodeURIComponent(inv.inviteToken)}`);

    await user.type(await screen.findByLabelText("设一个密码"), "a-long-password");
    await user.type(screen.getByLabelText("再输一遍"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByAltText("两步验证二维码")).toBeTruthy();
    const { totpSecret } = (await be.db.query.adminUsers.findFirst())!;
    await user.type(screen.getByLabelText("6 位数字"), totpAt(totpSecret!, +be.clock.now()));
    await user.click(screen.getByRole("button", { name: "完 成" }));
    expect(await screen.findByText(/已开通/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "去登录" }));
    be.clock.advance(TOTP_STEP_MS);
    await login(be, user, "boss@example.com", totpSecret!);
    expect(await screen.findByRole("heading", { name: "看板" })).toBeTruthy();
    const menu = screen.getByRole("menu");
    for (const item of ["看板", "复核", "赛季", "管理端账号", "查看记录"]) expect(within(menu).getByText(item)).toBeTruthy();
    await be.stop();
  });

  it("wrong code is refused; reviewers do not see account pages", async () => {
    const be = await startBackend();
    const { secret } = await account(be, "rev@example.com", "reviewer");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole();
    await user.type(await screen.findByLabelText("邮箱"), "rev@example.com");
    await user.type(screen.getByLabelText("密码"), "a-long-password");
    await user.type(screen.getByLabelText("两步验证码"), totpAt(secret, +be.clock.now()) === "000000" ? "111111" : "000000");
    await user.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText("邮箱、密码或两步验证码不对")).toBeTruthy();

    await user.clear(screen.getByLabelText("两步验证码"));
    await user.type(screen.getByLabelText("两步验证码"), totpAt(secret, +be.clock.now()));
    await user.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByRole("heading", { name: "看板" })).toBeTruthy();
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("复核")).toBeTruthy();
    expect(within(menu).queryByText("管理端账号")).toBeNull();
    expect(within(menu).queryByText("赛季")).toBeNull();
    await be.stop();
  });

  it("admins invite reviewers and see the view log; 30 minutes idle logs out", async () => {
    const be = await startBackend();
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole("/users");
    await login(be, user, "boss@example.com", secret);
    expect(await screen.findByRole("heading", { name: "管理端账号" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "邀 请" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("邮箱"), "rev@example.com");
    await user.type(within(dialog).getByLabelText("名字"), "小李");
    await user.click(within(dialog).getByRole("button", { name: "生成邀请链接" }));
    expect(await within(dialog).findByText(/\/invite\?token=/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("待开通").length).toBe(1));

    // the view log page lists what reviewers looked at
    const boss = (await be.db.query.adminUsers.findFirst())!;
    await be.services.admin.recordView(boss.id, { childId: null, contentKind: "work", objectId: "W9", action: "download" });
    await user.click(screen.getByRole("button", { name: "好 了" }));
    await user.click(within(screen.getByRole("menu")).getByText("查看记录"));
    expect(await screen.findByText("W9")).toBeTruthy();
    expect(screen.getByText("下载")).toBeTruthy();

    // 31 minutes without activity: the next request sends the person back to login
    be.clock.advance(31 * 60_000);
    await user.click(within(screen.getByRole("menu")).getByText("管理端账号"));
    expect(await screen.findByText("超过 30 分钟没有操作，已自动退出，请重新登录。")).toBeTruthy();
    await be.stop();
  });
});
