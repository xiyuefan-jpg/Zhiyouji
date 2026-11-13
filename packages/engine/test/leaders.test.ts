import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS as P,
  DAY,
  adminSetRole,
  canTakeOver,
  claimRole,
  createRng,
  systemAssignLeader,
  takeOver,
  transferRole,
} from "../src/index.js";

const members = ["a", "b", "c"];
const empty = { leader: null, deputy: null };

describe("leaders (§5)", () => {
  it("claim: first come, one role per person", () => {
    const r1 = claimRole(empty, "leader", "a", members);
    expect(r1).toEqual({ leader: "a", deputy: null });
    expect(claimRole(r1 as never, "leader", "b", members)).toBe("taken");
    expect(claimRole(r1 as never, "deputy", "a", members)).toBe("holds_other_role");
    expect(claimRole(empty, "leader", "zz", members)).toBe("not_member");
  });
  it("transfer to another member; receiving a role frees the other one", () => {
    const roles = { leader: "a", deputy: "b" };
    expect(transferRole(roles, "leader", "a", "c", members)).toEqual({ leader: "c", deputy: "b" });
    expect(transferRole(roles, "leader", "a", "b", members)).toEqual({ leader: "b", deputy: null });
    expect(transferRole(roles, "leader", "b", "c", members)).toBe("not_holder");
  });
  it("deputy takes over after the leader is away 3 days", () => {
    const roles = { leader: "a", deputy: "b" };
    expect(canTakeOver(roles, "b", 0, 3 * DAY - 1, P)).toBe(false);
    expect(takeOver(roles, "b", 0, 3 * DAY, P)).toEqual({ leader: "b", deputy: null });
    expect(takeOver(roles, "c", 0, 9 * DAY, P)).toBe("not_deputy");
  });
  it("system picks the highest grade when nobody claimed", () => {
    const r = systemAssignLeader({ leader: null, deputy: "b" }, [
      { childId: "a", grade: 3 },
      { childId: "b", grade: 7 },
      { childId: "c", grade: 5 },
    ], createRng(1));
    expect(r).toEqual({ leader: "b", deputy: null });
    expect(systemAssignLeader({ leader: "a", deputy: null }, [{ childId: "c", grade: 9 }], createRng(1))).toEqual({ leader: "a", deputy: null });
  });
  it("admin can set either role", () => {
    expect(adminSetRole({ leader: "a", deputy: "b" }, "leader", "b")).toEqual({ leader: "b", deputy: null });
  });
});
