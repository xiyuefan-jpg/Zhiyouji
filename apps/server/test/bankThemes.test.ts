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
