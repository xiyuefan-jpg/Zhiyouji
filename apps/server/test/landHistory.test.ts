import { describe, expect, it } from "vitest";
import { contestSetup } from "./seasonHelpers.js";

describe("归属历史 on the land page (part 5 D2)", () => {
  it("the blind auction gave the lands; a free land has none", async () => {
    const t = await contestSetup();
    const st = await t.services.store.state(t.serverId);
    const owner = st.lands[t.target]!.owner!;
    const h = (await t.a1api("GET", `/v1/season/lands/${t.target}/history`)).json().history;
    expect(h).toEqual([expect.objectContaining({ from: null, to: { id: owner, name: st.teams[owner]!.name }, how: "auction" })]);
    // a free land has no history yet
    const free = st.landOrder.find((l) => st.lands[l]!.owner === null)!;
    expect((await t.a1api("GET", `/v1/season/lands/${free}/history`)).json().history).toEqual([]);
    expect((await t.a1api("GET", "/v1/season/lands/X9/history")).statusCode).toBe(404);
    await t.close();
  });
});
