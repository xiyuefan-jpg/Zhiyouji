import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ConfigProvider } from "antd-mobile";
import { children, families } from "@zhiyouji/db";
import { beijingInstant } from "@zhiyouji/engine";
import { App } from "../src/App";
import { startBackend } from "./backend";

export function renderApp(path: string) {
  return render(
    <ConfigProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ConfigProvider>,
  );
}

/** A logged-in child who is a season player of a confirmed 8-team season, after the D0 evening publication. */
export async function seasonPlayer() {
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

