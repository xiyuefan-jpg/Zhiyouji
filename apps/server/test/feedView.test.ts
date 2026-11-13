import { describe, expect, it } from "vitest";
import { describe as text, viewFor } from "../src/index.js";

const names = { team: (id?: string | null) => ({ A: "花果山", B: "流沙河" })[id ?? ""] ?? "", land: (id?: string | null) => (id === "E1" ? "火焰山" : id ?? ""), child: () => "小明" };

describe("feed visibility (items are secret between teams)", () => {
  it("cuts chest items of other teams out of war results", () => {
    const n = { kind: "war_result", broadcast: false, data: { week: 1, results: [{ teamId: "A", outcome: "lose", points: 0, chestItem: "bihuo" }, { teamId: "B", outcome: "win", points: 1000, chestItem: null }] } };
    expect((viewFor(n, "B")!.data.results as { chestItem: unknown }[])[0]!.chestItem).toBeNull();
    expect((viewFor(n, "A")!.data.results as { chestItem: unknown }[])[0]!.chestItem).toBe("bihuo");
  });

  it("scouting is known only to the team that used it; other items are broadcast", () => {
    expect(viewFor({ kind: "item_used", broadcast: false, data: { teamId: "A", itemId: "zhencha" } }, "B")).toBeNull();
    expect(viewFor({ kind: "item_used", broadcast: false, data: { teamId: "A", itemId: "zhencha" } }, "A")!.scope).toBe("team");
    const v = viewFor({ kind: "item_used", broadcast: true, data: { teamId: "A", itemId: "zijin", targetTeamId: "B" } }, "B")!;
    expect(v.scope).toBe("server");
    expect(text("item_used", v.data, names, "B")).toBe("花果山对流沙河使用了紫金红葫芦");
  });

  it("team matters and purchases stay in the team; daily settlement is not shown", () => {
    expect(viewFor({ kind: "shop_bought", broadcast: false, data: { teamId: "A", itemId: "dianhua" } }, "B")).toBeNull();
    expect(viewFor({ kind: "role_claimed", broadcast: false, data: { teamId: "A", leader: "x", deputy: null } }, "A")!.scope).toBe("team");
    expect(viewFor({ kind: "daily_settled", broadcast: false, data: { day: 3 } }, "A")).toBeNull();
    const rare = viewFor({ kind: "rare_round", broadcast: true, data: { allocations: [{ teamId: "A", item: "dianhua" }, { teamId: "B", item: "shengsi" }] } }, "B")!;
    expect(rare.data.allocations).toEqual([{ teamId: "B", item: "shengsi" }]);
    expect(text("rare_round", rare.data, names, "B")).toBe("灵品分配完成，本组分到：生死簿");
    expect(text("contest_started", { attacker: "A", defender: "B", landId: "E1" }, names, "B")).toBe("花果山向流沙河的火焰山发起了进攻");
  });
});
