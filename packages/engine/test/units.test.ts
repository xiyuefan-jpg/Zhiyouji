import { describe, expect, it } from "vitest";
import { ceilGrain, floorGrain, formatPts, pts, roundHalfAway } from "../src/index.js";

describe("units", () => {
  it("stores points as hundredths", () => {
    expect(pts(3.96)).toBe(396);
    expect(pts(0.36)).toBe(36);
    expect(pts(0.216)).toBe(22);
    expect(pts(-2.5)).toBe(-250);
  });
  it("rounds half away from zero", () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.49)).toBe(2);
  });
  it("formats with one decimal", () => {
    expect(formatPts(396)).toBe("4.0");
    expect(formatPts(-250)).toBe("-2.5");
    expect(formatPts(5)).toBe("0.1");
    expect(formatPts(0)).toBe("0.0");
  });
  it("rounds grain costs up and refunds down, ignoring float noise", () => {
    expect(ceilGrain(45.5)).toBe(46);
    expect(ceilGrain(50 * 0.7)).toBe(35);
    expect(ceilGrain(65 * 0.7)).toBe(46);
    expect(floorGrain(22.5)).toBe(22);
  });
});
