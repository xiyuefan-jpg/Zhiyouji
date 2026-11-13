import { describe, expect, it } from "vitest";
import { opLog } from "@zhiyouji/db";
import { base32Encode, hotp, hashPassword, totpAt, verifyPassword, verifyTotp, TOTP_STEP_MS } from "../src/index.js";
import { setup } from "./helpers.js";

describe("security helpers", () => {
  it("TOTP matches the RFC 6238 test vectors (SHA-1, last 6 digits)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpAt(secret, 59_000)).toBe("287082");
    expect(totpAt(secret, 1111111109_000)).toBe("081804");
    expect(totpAt(secret, 2000000000_000)).toBe("279037");
    expect(hotp(secret, 1)).toBe("287082");
    // one step of clock drift either way is accepted
    expect(verifyTotp(secret, "287082", 59_000 + TOTP_STEP_MS)).toBe(1);
    expect(verifyTotp(secret, "287082", 59_000 + 3 * TOTP_STEP_MS)).toBeNull();
  });

  it("scrypt passwords", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});

async function adminSetup() {
  const t = await setup();
  const now = () => +t.clock.now();
  /** Invite → set password → confirm a two-step code → log in. */
  async function onboard(email: string, role: "admin" | "reviewer", by = "cli") {
    const inv = await t.services.admin.invite(by, { email, name: email.split("@")[0]!, role });
    const start = await t.call("POST", "/v1/admin/auth/invite/start", { token: inv.inviteToken, password: "a-long-password" });
    expect(start.statusCode).toBe(200);
    const { secret, otpauthUrl } = start.json();
    expect(otpauthUrl).toContain(`secret=${secret}`);
    const fin = await t.call("POST", "/v1/admin/auth/invite/finish", { token: inv.inviteToken, code: totpAt(secret, now()) });
    expect(fin.statusCode).toBe(200);
    t.clock.advance(TOTP_STEP_MS); // the next login needs a fresh code
    const login = await t.call("POST", "/v1/admin/auth/login", { email, password: "a-long-password", totp: totpAt(secret, now()) });
    expect(login.statusCode).toBe(200);
    return { token: login.json().token as string, id: login.json().me.id as string, secret, inviteToken: inv.inviteToken };
  }
  return { ...t, onboard, now };
}

describe("admin console login (part 7 §0, part 8 §3.1)", () => {
  it("invite → password → two-step code → login; codes and invites work once", async () => {
    const t = await adminSetup();
    const a = await t.onboard("Boss@Example.com".toLowerCase(), "admin");
    const me = await t.call("GET", "/v1/admin/me", undefined, a.token);
    expect(me.json()).toMatchObject({ email: "boss@example.com", role: "admin" });

    // the invite cannot be reused
    expect((await t.call("POST", "/v1/admin/auth/invite/start", { token: a.inviteToken, password: "another-password" })).json().error).toBe("invite_invalid");
    // the same two-step code cannot log in twice
    t.clock.advance(TOTP_STEP_MS);
    const code = totpAt(a.secret, t.now());
    expect((await t.call("POST", "/v1/admin/auth/login", { email: "boss@example.com", password: "a-long-password", totp: code })).statusCode).toBe(200);
    expect((await t.call("POST", "/v1/admin/auth/login", { email: "boss@example.com", password: "a-long-password", totp: code })).json().error).toBe("login_failed");
    // short passwords are refused when setting up
    const inv = await t.services.admin.invite("cli", { email: "x@example.com", name: "x", role: "reviewer" });
    expect((await t.call("POST", "/v1/admin/auth/invite/start", { token: inv.inviteToken, password: "short" })).json().error).toBe("password_short");
    await t.close();
  });

  it("locks after 5 failed logins; unknown emails look the same as wrong passwords", async () => {
    const t = await adminSetup();
    const a = await t.onboard("boss@example.com", "admin");
    const unknown = await t.call("POST", "/v1/admin/auth/login", { email: "nobody@example.com", password: "x", totp: "123456" });
    expect(unknown.json().error).toBe("login_failed");
    for (let i = 0; i < 4; i++)
      expect((await t.call("POST", "/v1/admin/auth/login", { email: "boss@example.com", password: "nope", totp: totpAt(a.secret, t.now()) })).json().error).toBe("login_failed");
    expect((await t.call("POST", "/v1/admin/auth/login", { email: "boss@example.com", password: "nope", totp: totpAt(a.secret, t.now()) })).json().error).toBe("locked");
    t.clock.advance(TOTP_STEP_MS);
    expect((await t.call("POST", "/v1/admin/auth/login", { email: "boss@example.com", password: "a-long-password", totp: totpAt(a.secret, t.now()) })).json().error).toBe("locked");
    t.clock.advance(15 * 60_000);
    expect((await t.call("POST", "/v1/admin/auth/login", { email: "boss@example.com", password: "a-long-password", totp: totpAt(a.secret, t.now()) })).statusCode).toBe(200);
    await t.close();
  });

  it("logged out after 30 minutes without activity and after 12 hours", async () => {
    const t = await adminSetup();
    const a = await t.onboard("boss@example.com", "admin");
    t.clock.advance(29 * 60_000);
    expect((await t.call("GET", "/v1/admin/me", undefined, a.token)).statusCode).toBe(200);
    t.clock.advance(29 * 60_000);
    expect((await t.call("GET", "/v1/admin/me", undefined, a.token)).statusCode).toBe(200);
    t.clock.advance(31 * 60_000);
    expect((await t.call("GET", "/v1/admin/me", undefined, a.token)).json().error).toBe("session_expired");

    t.clock.advance(TOTP_STEP_MS);
    const b = (await t.call("POST", "/v1/admin/auth/login", { email: "boss@example.com", password: "a-long-password", totp: totpAt(a.secret, t.now()) })).json().token;
    for (let i = 0; i < 25; i++) {
      t.clock.advance(29 * 60_000);
      const r = await t.call("GET", "/v1/admin/me", undefined, b);
      if (i < 24) expect(r.statusCode).toBe(200);
      else expect(r.json().error).toBe("session_expired");
    }
    await t.close();
  });

  it("roles: reviewers cannot manage users; admins invite and disable", async () => {
    const t = await adminSetup();
    const a = await t.onboard("boss@example.com", "admin");
    const inv = await t.call("POST", "/v1/admin/users", { email: "rev@example.com", name: "复核员", role: "reviewer" }, a.token);
    expect(inv.statusCode).toBe(200);
    expect(inv.json().inviteToken.length).toBeGreaterThan(20);
    const r = await t.onboard("rev2@example.com", "reviewer");
    expect((await t.call("GET", "/v1/admin/users", undefined, r.token)).statusCode).toBe(403);
    expect((await t.call("POST", "/v1/admin/users", { email: "z@example.com", name: "z", role: "admin" }, r.token)).statusCode).toBe(403);
    const users = (await t.call("GET", "/v1/admin/users", undefined, a.token)).json().users;
    expect(users.map((u: { email: string; status: string }) => [u.email, u.status])).toEqual([
      ["boss@example.com", "active"],
      ["rev@example.com", "invited"],
      ["rev2@example.com", "active"],
    ]);
    // an existing active email cannot be invited again
    expect((await t.call("POST", "/v1/admin/users", { email: "rev2@example.com", name: "x", role: "reviewer" }, a.token)).json().error).toBe("email_taken");
    // disabling logs the person out at once
    expect((await t.call("POST", `/v1/admin/users/${a.id}/disable`, undefined, a.token)).json().error).toBe("cannot_disable_self");
    expect((await t.call("POST", `/v1/admin/users/${r.id}/disable`, undefined, a.token)).statusCode).toBe(200);
    expect((await t.call("GET", "/v1/admin/me", undefined, r.token)).statusCode).toBe(401);
    const log = await t.db.select().from(opLog);
    expect(log.map((l) => l.action)).toContain("disable_admin_user");
    await t.close();
  });

  it("view log: every view and download of a child's data, filterable by admins only", async () => {
    const t = await adminSetup();
    const a = await t.onboard("boss@example.com", "admin");
    const r = await t.onboard("rev@example.com", "reviewer");
    const f = await t.family("13812345678", [{ nickname: "小明", grade: 4 }]);
    await t.services.admin.recordView(r.id, { childId: f.childIds[0], contentKind: "work", objectId: "W1", action: "view" });
    await t.services.admin.recordView(r.id, { childId: f.childIds[0], contentKind: "recording", objectId: "R1", action: "download" });
    await t.services.admin.recordView(a.id, { childId: null, contentKind: "work", objectId: "W2", action: "view" });
    const all = (await t.call("GET", "/v1/admin/view-log", undefined, a.token)).json().entries;
    expect(all).toHaveLength(3);
    const mine = (await t.call("GET", `/v1/admin/view-log?adminUserId=${r.id}`, undefined, a.token)).json().entries;
    expect(mine.map((e: { action: string }) => e.action).sort()).toEqual(["download", "view"]);
    const byChild = (await t.call("GET", `/v1/admin/view-log?childId=${f.childIds[0]}`, undefined, a.token)).json().entries;
    expect(byChild).toHaveLength(2);
    expect((await t.call("GET", "/v1/admin/view-log", undefined, r.token)).statusCode).toBe(403);
    await t.close();
  });
});
