import { describe, expect, it } from "vitest";
import { reviewAssignments } from "@zhiyouji/db";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

const DEBATE = Object.fromEntries(["E2", "E3", "E4", "E5", "E6", "E7", "E8"].map((l) => [l, "朱紫国"]));
const B_DIMS = { claim: 15, argument: 20, response: 15, reality: 10, ai: 5 }; // 65

describe("异步辩论 on debate lands (part 3 §10.4)", () => {
  it("sides (random after 12 h), opening then rebuttal, openings shared, both stages reviewed together", async () => {
    const t = await contestSetup({ landNames: { E1: "火焰山", ...DEBATE } });
    const reviewer = await t.adminUser("r@example.com", "reviewer");
    const a1 = t.a1api;
    let d = (await a1("GET", `/v1/season/contests/${t.contestId}/debate`)).json();
    expect(d).toMatchObject({ debate: true, mySide: null, stage: "opening" });
    expect(d.sideDeadline).toBe(bj("2027-02-09", 22).toISOString());
    expect(d.openingDeadline).toBe(bj("2027-02-11", 21).toISOString());
    expect((await a1("POST", `/v1/season/contests/${t.contestId}/side`, { side: "pro" })).json().error).toBe("not_defender");

    const slots = (await a1("GET", "/v1/season/works")).json().slots as { slot: string; open: boolean; stage: string }[];
    expect(slots.map((s) => [s.slot, s.stage, s.open])).toEqual([
      [`contest:${t.contestId}:open`, "opening", true],
      [`contest:${t.contestId}`, "rebuttal", false],
    ]);
    expect((await a1("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "驳论", members: [t.a1] })).json().error).toBe("too_early");
    expect((await a1("POST", `/v1/season/works/contest:${t.contestId}:open`, { mediaKind: "text", text: "我方立论：……", members: [t.a1] })).json().work.version).toBe(1);

    // 12 hours without the defender choosing: the system picks
    t.clock.set(bj("2027-02-09", 22, 1));
    await t.services.debates.runDue(t.serverId);
    d = (await a1("GET", `/v1/season/contests/${t.contestId}/debate`)).json();
    expect(["pro", "con"]).toContain(d.mySide);
    expect(d.sideBy).toBe("system");
    expect((await a1("GET", "/v1/messages")).json().messages.some((m: { title: string }) => m.title === "辩论持方定了")).toBe(true);

    // opening deadline: the defender handed in nothing → attackers rebut imagined arguments
    t.clock.set(bj("2027-02-11", 21, 1));
    await t.services.debates.runDue(t.serverId);
    d = (await a1("GET", `/v1/season/contests/${t.contestId}/debate`)).json();
    expect(d).toMatchObject({ stage: "rebuttal", noDefender: true, openings: [] });
    expect((await a1("GET", "/v1/messages")).json().messages.find((m: { title: string }) => m.title === "驳论开始了").body).toContain("2 个论点");
    expect((await a1("POST", `/v1/season/works/contest:${t.contestId}:open`, { mediaKind: "text", text: "晚了", members: [t.a1] })).json().error).toBe("too_late");
    expect((await a1("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "text", text: "我方驳论：对方可能会说……", members: [t.a1] })).json().work.version).toBe(1);

    // the deadline: one work per team; the reviewer sees the opening next to the rebuttal; rubric B
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    const as = await t.db.select().from(reviewAssignments);
    expect(as).toHaveLength(1);
    const token = await reviewer.relogin();
    const view = (await t.call("GET", `/v1/admin/reviews/${as[0]!.id}`, undefined, token)).json();
    expect(view.work.text).toBe("我方驳论：对方可能会说……");
    expect(view.opening.text).toBe("我方立论：……");
    expect(view.rubric.id).toBe("B");
    await t.call("POST", `/v1/admin/reviews/${as[0]!.id}`, { dims: B_DIMS, comment: "论证清楚" }, token);
    const st = await t.services.store.state(t.serverId);
    expect(st.lands[t.target]!.owner).toBe(t.myTeam);
    expect((await a1("GET", `/v1/season/works/contest:${t.contestId}/result`)).json().mine.score).toBe(65);
    await t.close();
  });
});
