import { describe, expect, it } from "vitest";
import { children, families, surveyAnswers } from "@zhiyouji/db";
import { bj, setup } from "./helpers.js";

const ROUNDS = Array.from({ length: 8 }, (_, i) => [`q${2 * i + 1}`, `q${2 * i + 2}`, `q${2 * i + 2}`]);
const BODY = { curiosity: { rounds: ROUNDS, final: "q16" }, hobbies: ["画画", "做实验"], ai: { experience: "few", uses: ["问问题"] }, style: "strategist", challenge: { kind: "text", text: "我最近学会了用分数算比萨。" } };

describe("土地公问卷 (part 5 A4; content library §10)", () => {
  it("stores the answers, the curiosity scores and the default way of explaining", async () => {
    const t = await setup();
    const f = await t.family("13400000001", [{ nickname: "小果", grade: 3 }]);
    await t.call("POST", "/v1/session/child", { childId: f.childIds[0] }, f.token);
    expect((await t.call("GET", "/v1/survey", undefined, f.token)).json()).toEqual({ done: false });
    expect((await t.call("POST", "/v1/survey", { ...BODY, curiosity: { rounds: ROUNDS, final: "q1" } }, f.token)).statusCode).toBe(400);
    const r = (await t.call("POST", "/v1/survey", BODY, f.token)).json();
    expect(r).toMatchObject({ done: true, style: "strategist" });
    expect(r.curiosity["数学"]).toBe(4);
    expect(r.curiosity["物理与天文"]).toBeUndefined();
    expect((await t.call("GET", "/v1/children", undefined, f.token)).json().children[0].explainPref).toBe("text");
    // skipping the challenge means voice
    await t.call("POST", "/v1/survey", { ...BODY, challenge: null }, f.token);
    expect((await t.call("GET", "/v1/children", undefined, f.token)).json().children[0].explainPref).toBe("voice");
    expect(await t.db.select().from(surveyAnswers)).toHaveLength(2);
    await t.close();
  });

  it("grouping mixes the four play styles", async () => {
    const t = await setup(bj("2027-02-01", 10));
    const styles = ["fighter", "strategist", "healer", "builder"];
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) {
      const [fam] = await t.db.insert(families).values({ phone: `1340000${1000 + i}` }).returning();
      const [c] = await t.db.insert(children).values({ familyId: fam!.id, nickname: `k${i}`, grade: 5 }).returning();
      ids.push(c!.id);
      await t.db.insert(surveyAnswers).values({ childId: c!.id, version: "v0.3", answers: {}, curiosity: {}, style: styles[Math.floor(i / 4)]!, completedAt: new Date() });
    }
    const s = await t.services.seasons.create({ name: "S", opening: "2027-02-07", seed: 1 }, "admin:x");
    await t.services.seasons.openEnrollment(s.id, "admin:x");
    await t.services.seasons.enroll(s.id, ids.map((childId) => ({ childId })), "admin:x");
    const g = await t.services.seasons.generateGrouping(s.id, "admin:x");
    const styleOf = new Map(ids.map((id, i) => [id, styles[Math.floor(i / 4)]]));
    for (const team of g.servers[0]!.teams) expect(new Set(team.members.map((m) => styleOf.get(m.childId))).size).toBe(2);
    await t.close();
  });
});
