import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS as P, dailyTerritoryIncome } from "../src/index.js";

describe("daily territory income (§6)", () => {
  it("matches the PRD example: 1 center + 3 edges = 3.96", () => {
    const r = dailyTerritoryIncome(
      [
        { landId: "e1", kind: "edge" },
        { landId: "c1", kind: "center" },
        { landId: "e2", kind: "edge" },
        { landId: "e3", kind: "edge" },
      ],
      P,
    );
    expect(r.total).toBe(396);
    expect(r.lands.map((l) => l.landId)).toEqual(["c1", "e1", "e2", "e3"]);
  });
  it("compounds the decay and rounds each land to 0.01", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => ({ landId: id, kind: "edge" as const }));
    expect(dailyTerritoryIncome(five, P).lands.map((l) => l.pts)).toEqual([100, 100, 60, 36, 22]);
  });
  it("a land zeroed by 生死簿 keeps its place in the order", () => {
    const r = dailyTerritoryIncome(
      [
        { landId: "c1", kind: "center", zeroed: true },
        { landId: "e1", kind: "edge" },
        { landId: "e2", kind: "edge" },
        { landId: "e3", kind: "edge" },
      ],
      P,
    );
    expect(r.total).toBe(100 + 60 + 36);
  });
  it("no land, no income", () => {
    expect(dailyTerritoryIncome([], P).total).toBe(0);
  });
});
