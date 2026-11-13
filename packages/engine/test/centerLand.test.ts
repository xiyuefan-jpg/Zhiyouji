import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS as P, centerLandPrice } from "../src/index.js";

describe("center land price (§9.2)", () => {
  it("starts at 75 and falls linearly to a 20% floor", () => {
    expect(centerLandPrice(8, P)).toBe(75);
    expect(centerLandPrice(9, P)).toBe(72);
    expect(centerLandPrice(20, P)).toBe(39);
    expect(centerLandPrice(30, P)).toBe(15);
    expect(centerLandPrice(33, P)).toBe(15);
  });
});
