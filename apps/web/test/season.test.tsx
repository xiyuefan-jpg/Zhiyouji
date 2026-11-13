import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ConfigProvider } from "antd-mobile";
import { children, families } from "@zhiyouji/db";
import { beijingInstant } from "@zhiyouji/engine";
import { App } from "../src/App";
import { startBackend } from "./backend";

function renderApp(path: string) {
  return render(
    <ConfigProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ConfigProvider>,
  );
}

/** A logged-in child who is a season player of a confirmed 8-team season, after the D0 evening publication. */
async function seasonPlayer() {
  const be = await startBackend();
  await be.services.family.requestCode("13812345678", undefined);
  const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
  await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
  const me = await be.services.family.createChild(login.family.id, { nickname: "小明", grade: 5, avatar: "a1", explainPref: "voice" });
  const ids = [me.id];
  for (let i = 0; i < 15; i++) {
    const [f] = await be.db.insert(families).values({ phone: `1390000${2000 + i}`, consentVersion: be.cfg.policyVersion }).returning();
    const [c] = await be.db.insert(children).values({ familyId: f!.id, nickname: `组员${i}`, grade: 1 + (i % 9) }).returning();
    ids.push(c!.id);
  }
  const s = await be.services.seasons.create({ name: "第三季", opening: "2027-01-10", seed: 4 }, "admin:test");
  await be.services.seasons.openEnrollment(s.id, "admin:test");
  await be.services.seasons.enroll(s.id, ids.map((childId) => ({ childId })), "admin:test");
  await be.services.seasons.generateGrouping(s.id, "admin:test");
  const lands = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "C1", "C2", "C3", "C4"];
  const conf = await be.services.seasons.confirmGrouping(s.id, { landNames: { E1: "火焰山", C1: "女儿国" }, prompts: Object.fromEntries(lands.map((l) => [l, ["q1", "q2"]])) }, "admin:test");
  const serverId = conf.servers[0]!.serverId;
  be.clock.set(new Date(beijingInstant("2027-01-10", 19, 1)));
  await be.services.scheduler.runDue(serverId);
  await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, me.id);
  const realFetch = be.fetchMock.getMockImplementation()!;
  be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
  localStorage.setItem("zyj_privacy_notice", "2027-01");
  return { ...be, serverId, childId: me.id, seasonId: s.id };
}

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
    await user.type(screen.getByPlaceholderText("作品的文字"), "我们的作品正文");
    await user.click(screen.getByText("小明"));
    await user.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(async () => {
      const v = await be.services.works.versions(await be.services.play.ctx(be.childId), `contest:${c.contest.id}`);
      expect(v.works.map((w) => [w.version, w.text, w.members])).toEqual([[1, "我们的作品正文", [be.childId]]]);
    });
    await be.stop();
  });
});
