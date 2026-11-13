import { render, screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { totpAt, TOTP_STEP_MS } from "@zhiyouji/server";
import { children, families } from "@zhiyouji/db";
import { beijingInstant } from "@zhiyouji/engine";
import { App } from "../src/App";
import { AuthProvider } from "../src/auth";
import type { startBackend } from "./backend";

export function renderConsole(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

export type Backend = Awaited<ReturnType<typeof startBackend>>;

/** Create an active account directly on the server (like the command-line invite). */
export async function account(be: Backend, email: string, role: "admin" | "reviewer") {
  const inv = await be.services.admin.invite("cli", { email, name: email.split("@")[0]!, role });
  const { secret } = await be.services.admin.startInvite(inv.inviteToken, "a-long-password");
  await be.services.admin.finishInvite(inv.inviteToken, totpAt(secret, +be.clock.now()));
  be.clock.advance(TOTP_STEP_MS);
  return { secret };
}

export async function login(be: Backend, user: ReturnType<typeof userEvent.setup>, email: string, secret: string) {
  await user.type(await screen.findByLabelText("邮箱"), email);
  await user.type(screen.getByLabelText("密码"), "a-long-password");
  await user.type(screen.getByLabelText("两步验证码"), totpAt(secret, +be.clock.now()));
  await user.click(screen.getByRole("button", { name: "登 录" }));
}


/**
 * A confirmed 16-player season (opening 2027-01-10), after the D0 evening
 * publication. With `contest`: a team's leader attacked another team's land on
 * D2 and handed in a text work; the clock is then past the deadline.
 */
export async function seasonWithWork(be: Backend) {
  const ids: string[] = [];
  for (let i = 0; i < 16; i++) {
    const [f] = await be.db.insert(families).values({ phone: `1390000${2000 + i}`, consentVersion: be.cfg.policyVersion }).returning();
    const [c] = await be.db.insert(children).values({ familyId: f!.id, nickname: `孩子${i}`, grade: 1 + (i % 9) }).returning();
    ids.push(c!.id);
  }
  const s = await be.services.seasons.create({ name: "第三季", opening: "2027-01-10", seed: 4 }, "admin:test");
  await be.services.seasons.openEnrollment(s.id, "admin:test");
  await be.services.seasons.enroll(s.id, ids.map((childId) => ({ childId })), "admin:test");
  await be.services.seasons.generateGrouping(s.id, "admin:test");
  const lands = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "C1", "C2", "C3", "C4"];
  const conf = await be.services.seasons.confirmGrouping(s.id, { landNames: { E1: "火焰山" }, prompts: Object.fromEntries(lands.map((l) => [l, ["q1", "q2"]])) }, "admin:test");
  const serverId = conf.servers[0]!.serverId;
  be.clock.set(new Date(beijingInstant("2027-01-10", 19, 1)));
  await be.services.scheduler.runDue(serverId);
  const leader = ids[0]!;
  const ctx = await be.services.play.ctx(leader);
  await be.services.play.claimRole(ctx, "leader");
  await be.services.play.submitRound(ctx, "blind_auction", { bid: 10, prefs: ["E1"] });
  be.clock.set(new Date(beijingInstant("2027-01-11", 21, 1)));
  await be.services.scheduler.runDue(serverId);
  be.clock.set(new Date(beijingInstant("2027-01-12", 10, 0)));
  const st = await be.services.store.state(serverId);
  const target = st.landOrder.find((l) => st.lands[l]!.kind === "edge" && st.lands[l]!.owner && st.lands[l]!.owner !== ctx.teamId)!;
  const c = await be.services.play.startContest(await be.services.play.ctx(leader), target);
  const w = await be.services.works.submit(await be.services.play.ctx(leader), `contest:${c.contest.id}`, { mediaKind: "text", fileIds: [], text: "我们用弹簧讲大气压", members: [leader] });
  return { seasonId: s.id, serverId, leader, teamId: ctx.teamId, contestId: c.contest.id, workId: w.work.id, target };
}
