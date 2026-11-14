import { describe, expect, it } from "vitest";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("weekly war themes and supply tasks from the question bank (content library §5, §6; part 7 §4)", () => {
  it("an enabled 周战争主题 is week 1 (with its fixed card); an enabled 军需任务 is slot 1a; the others keep the drafts", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    const add = (b: unknown) => t.call("POST", "/v1/admin/prompts", b, boss.token);
    await add({ category: "war_theme", title: "让小区更安静", body: "找一个让小区变吵的原因，设计一个办法。", status: "enabled", extra: { fixedCard: "只能用回收材料" } });
    await add({ category: "war_theme", title: "草稿主题", body: "还没定", status: "draft" });
    await add({ category: "supply", title: "城市里的鸟", body: "拍一种你家附近的鸟，说说它吃什么", status: "enabled", extra: { summaryTask: "我们这一组找到的鸟里，哪一种最适应城市？" } });

    t.clock.set(bj("2027-02-09", 19, 1)); // supply 1a is published
    const s = (await t.a1api("GET", "/v1/season/supply")).json().tasks[0];
    expect(s).toMatchObject({ supplyId: "1a", title: "城市里的鸟", perPerson: "拍一种你家附近的鸟，说说它吃什么", summaryTask: "我们这一组找到的鸟里，哪一种最适应城市？" });

    t.clock.set(bj("2027-02-11", 19, 1)); // W1 pairing
    await t.services.scheduler.runDue(t.serverId);
    const w1 = (await t.a1api("GET", "/v1/season/wars/1")).json();
    expect(w1.theme).toEqual({ title: "让小区更安静", task: "找一个让小区变吵的原因，设计一个办法。" });
    expect(w1.received).toMatchObject({ kind: "固定", text: "只能用回收材料" });
    const task = (await t.a1api("GET", "/v1/season/works/war%3A1/task")).json();
    expect(task.task.title).toBe("让小区更安静");
    await t.close();
  });
});

describe("约束词条 and 每日任务模板 in the database (part 7 §4)", () => {
  it("the admin's card list is what gift weeks offer; the templates' wording reaches the child and the AI", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    const cards = (await t.call("GET", "/v1/admin/content/war-cards", undefined, boss.token)).json().cards;
    expect(cards).toHaveLength(24);
    // only three cards allowed in week 2: those are the three offered
    const mine = [
      { id: "Z1", kind: "情境", text: "只能在楼道里", weeks: [2] },
      { id: "Z2", kind: "资源", text: "只能用旧报纸", weeks: [2] },
      { id: "Z3", kind: "对象", text: "使用者是外卖员", weeks: [2, 4] },
      { id: "Z4", kind: "对象", text: "只有第 4 周", weeks: [4] },
    ];
    expect((await t.call("PUT", "/v1/admin/content/war-cards", { cards: [...mine, { ...mine[0], text: "重复" }] }, boss.token)).statusCode).toBe(400);
    expect((await t.call("PUT", "/v1/admin/content/war-cards", { cards: mine }, boss.token)).json().cards).toHaveLength(4);

    const tpls = (await t.call("GET", "/v1/admin/content/daily-templates", undefined, boss.token)).json().templates;
    const edited = tpls.map((x: { id: number; name: string; prompt: string; evidence: string }) => ({ id: x.id, name: x.name, prompt: x.id === 1 ? "今天 AI 教会了你什么？" : x.prompt, evidence: x.evidence }));
    await t.call("PUT", "/v1/admin/content/daily-templates", { templates: edited }, boss.token);
    const today = (await t.a1api("GET", "/v1/daily/today")).json();
    expect(today.templates[0]).toMatchObject({ id: 1, prompt: "今天 AI 教会了你什么？", noAiAllowed: false });
    expect((await t.call("PUT", "/v1/admin/content/daily-templates", { templates: edited.slice(1) }, boss.token)).statusCode).toBe(400);

    // W2 pairing (Thursday of week 2): every team sees exactly Z1–Z3
    t.clock.set(bj("2027-02-18", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const w2 = (await t.a1api("GET", "/v1/season/wars/2")).json();
    expect(w2.gift).toBe(true);
    expect(w2.offered.map((c: { id: string }) => c.id).sort()).toEqual(["Z1", "Z2", "Z3"]);
    expect(w2.offered.find((c: { id: string }) => c.id === "Z2").text).toBe("只能用旧报纸");
    await t.close();
  });
});
