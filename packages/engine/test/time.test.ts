import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  HOUR,
  assertOpeningDate,
  beijingDate,
  beijingInstant,
  canStartContest,
  contestTimes,
  dateOfSeasonDay,
  dayKind,
  dayOfWeek,
  nextPublicationAfter,
  publicationTime,
  seasonDayOf,
  seasonWeekOf,
} from "../src/index.js";

const OPENING = "2027-03-07"; // a Sunday

describe("Beijing calendar", () => {
  it("converts between instants and Beijing dates", () => {
    expect(dayOfWeek(OPENING)).toBe(0);
    expect(beijingDate(Date.UTC(2027, 2, 7, 16, 0))).toBe("2027-03-08");
    expect(beijingDate(Date.UTC(2027, 2, 7, 15, 59))).toBe("2027-03-07");
    expect(beijingInstant("2027-03-08", 0)).toBe(Date.UTC(2027, 2, 7, 16, 0));
  });
  it("requires a Sunday opening (§20.2)", () => {
    expect(() => assertOpeningDate(OPENING)).not.toThrow();
    expect(() => assertOpeningDate("2027-03-08")).toThrow();
  });
  it("counts season days and weeks", () => {
    expect(seasonDayOf(OPENING, beijingInstant("2027-03-08", 0))).toBe(1);
    expect(seasonDayOf(OPENING, beijingInstant("2027-03-07", 23, 59))).toBe(0);
    expect(dateOfSeasonDay(OPENING, 33)).toBe("2027-04-09");
    expect(dayOfWeek(dateOfSeasonDay(OPENING, 33))).toBe(5);
    expect([1, 7, 8, 28, 29, 33].map(seasonWeekOf)).toEqual([1, 1, 2, 4, 5, 5]);
  });
  it("school days vs rest days, with admin overrides", () => {
    expect(dayKind("2027-03-08")).toBe("school");
    expect(dayKind("2027-03-13")).toBe("rest");
    expect(dayKind("2027-03-08", { "2027-03-08": "rest" })).toBe("rest");
  });
  it("publication times (§1.1)", () => {
    expect(publicationTime("2027-03-08", "morning", P)).toBe(beijingInstant("2027-03-08", 7));
    expect(publicationTime("2027-03-13", "noon", P)).toBe(beijingInstant("2027-03-13", 14));
    expect(nextPublicationAfter(beijingInstant("2027-03-08", 19, 30), P)).toBe(beijingInstant("2027-03-09", 7));
    expect(nextPublicationAfter(beijingInstant("2027-03-12", 20), P)).toBe(beijingInstant("2027-03-13", 9));
    expect(nextPublicationAfter(beijingInstant("2027-03-08", 7), P)).toBe(beijingInstant("2027-03-08", 12));
  });
  it("contest deadlines count from the start date (§10.1, §10.2, §10.4)", () => {
    const start = beijingInstant("2027-03-08", 22);
    const t = contestTimes(start, P);
    expect(t.day0).toBe("2027-03-08");
    expect(t.joinDeadline).toBe(beijingInstant("2027-03-09", 21));
    expect(t.debateOpeningDeadline).toBe(beijingInstant("2027-03-10", 21));
    expect(t.deadline).toBe(beijingInstant("2027-03-11", 21));
    expect(t.debateSideDeadline).toBe(start + 12 * HOUR);
  });
  it("contests may start from D1 21:00 to D25 21:00", () => {
    const d1 = dateOfSeasonDay(OPENING, 1);
    const d25 = dateOfSeasonDay(OPENING, 25);
    expect(canStartContest(OPENING, beijingInstant(d1, 20, 59), P)).toBe(false);
    expect(canStartContest(OPENING, beijingInstant(d1, 21), P)).toBe(true);
    expect(canStartContest(OPENING, beijingInstant(d25, 21), P)).toBe(true);
    expect(canStartContest(OPENING, beijingInstant(d25, 21, 1), P)).toBe(false);
  });
});
