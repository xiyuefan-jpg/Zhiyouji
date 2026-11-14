import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beijingInstant } from "@zhiyouji/engine";
import { startBackend } from "./backend";
import { renderApp, seasonPlayer } from "./seasonPlayer";

describe("student website: the season (part 5 D, E, F)", () => {
  it("小组: claim the leader seat; 地图: lands and a land page; 战报: ranking", async () => {
    const be = await seasonPlayer();
    const user = userEvent.setup();
    const team = (await be.services.play.me(be.childId)) as { team: { name: string } };
    renderApp("/team");
    expect(await screen.findByRole("heading", { name: team.team.name })).toBeTruthy();
    expect(screen.getByText("我是组员")).toBeTruthy();
    expect(await screen.findByText("60")).toBeTruthy(); // opening grain
    await user.click(screen.getByRole("button", { name: "认领组长" }));
    expect(await screen.findByText("我是组长")).toBeTruthy();
    await waitFor(async () => expect(((await be.services.play.me(be.childId)) as { role: string }).role).toBe("leader"));

    // 地图
    const nav = screen.getByRole("navigation", { name: "主菜单" });
    await user.click(within(nav).getByText("地图"));
    expect(await screen.findByText("中心地（产出 2）")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "火焰山，无主" }));
    expect(await screen.findByRole("heading", { name: "火焰山" })).toBeTruthy();
    expect(screen.getByText("主人：还没有主人")).toBeTruthy();
    // an unowned edge land can be neither attacked nor bought
    expect(screen.queryByRole("button", { name: "发起进攻" })).toBeNull();
    expect(screen.queryByRole("button", { name: "购买" })).toBeNull();
    await be.stop();
  });

  it("排行榜 and 战报 after the first publication", async () => {
    const be = await seasonPlayer();
    await be.services.reports.runDue(be.serverId);
    const user = userEvent.setup();
    renderApp("/report?tab=ranking");
    await screen.findAllByText(/块地/);
    expect((await screen.findAllByText(/块地/)).length).toBe(8);
    expect(screen.getByText(/（本组）/)).toBeTruthy();
    await user.click(screen.getByText("战报", { selector: ".adm-tabs-tab" }));
    expect(await screen.findByText(/战报 · 1月10日 19:00/)).toBeTruthy();
    await be.stop();
  });

  it("not a season player: only what the season is, no prices or sign-up", async () => {
    const be = await startBackend();
    await be.services.family.requestCode("13812345678", undefined);
    const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
    await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
    const c = await be.services.family.createChild(login.family.id, { nickname: "小红", grade: 3, avatar: "a1", explainPref: "voice" });
    await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, c.id);
    const realFetch = be.fetchMock.getMockImplementation()!;
    be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    renderApp("/team");
    expect(await screen.findByText("仅赛季玩家可用")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/价格|报名|元/);
    await be.stop();
  });

  it("作品工坊: a contest work slot, the material box, the leader submits a version", async () => {
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
    const user = userEvent.setup();
    renderApp("/team/works");
    await user.click(await screen.findByText("区域争夺（进攻方）"));
    expect(await screen.findByText("素材箱")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("写下想法或文字素材"), "用弹簧比喻大气压");
    await user.click(screen.getByRole("button", { name: "放进素材箱" }));
    expect(await screen.findByText("用弹簧比喻大气压")).toBeTruthy();
    // video is the default form now; this team hands in text only
    await user.click(screen.getByText("只有文字"));
    expect(screen.getByText(/最容易被 AI 代写/)).toBeTruthy();
    await user.type(screen.getByPlaceholderText("作品的文字"), "我们的作品正文");
    // 人机协作说明 (content library §2; 10 points in every rubric)
    await user.type(screen.getByPlaceholderText(/用了什么 AI/), "问了 AI，它举的例子不对，我们改了");
    await user.click(screen.getByText("小明"));
    await user.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(async () => {
      const v = await be.services.works.versions(await be.services.play.ctx(be.childId), `contest:${c.contest.id}`);
      expect(v.works.map((w) => [w.version, w.text, w.members])).toEqual([[1, "我们的作品正文", [be.childId]]]);
      expect((v.works[0] as { aiNote?: string | null }).aiNote).toBe("问了 AI，它举的例子不对，我们改了");
    });
    // how the work is judged is on the same page
    expect(screen.getByText(/怎么评分/)).toBeTruthy();
    await be.stop();
  });
});
