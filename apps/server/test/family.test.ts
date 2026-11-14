import { describe, expect, it } from "vitest";
import { consentRecords, gradeChanges, loginCodes } from "@zhiyouji/db";
import { eq } from "drizzle-orm";
import { setup } from "./helpers.js";

const PHONE = "13812345678";
const DAY = 86_400_000;

describe("student login (part 5 A2, part 8 §3.1)", () => {
  it("phone + code → parent confirms → child profiles → choose 我是谁", async () => {
    const t = await setup();
    const r1 = await t.call("POST", "/v1/auth/sms-code", { phone: PHONE });
    expect(r1.statusCode).toBe(200);
    const code = t.sms.lastCode(PHONE)!;
    expect(code).toMatch(/^\d{6}$/);
    // only the keyed hash is stored
    const [row] = await t.db.select().from(loginCodes);
    expect(row!.codeHash).not.toContain(code);

    const login = await t.call("POST", "/v1/auth/login", { phone: PHONE, code });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toContain("zyj_s=");
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    const { token, me } = login.json();
    expect(me.family.phone).toBe("138****5678");
    expect(me.needsConsent).toBe(true);

    // nothing works before the parent agrees
    const blocked = await t.call("GET", "/v1/children", undefined, token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe("consent_required");

    const c = await t.call("POST", "/v1/family/consent", { choice: "agree", version: t.cfg.policyVersion }, token);
    expect(c.json()).toEqual({ needsConsent: false, refused: false });

    const kid = await t.call("POST", "/v1/children", { nickname: "小明", grade: 4 }, token);
    expect(kid.statusCode).toBe(200);
    expect(kid.json().child).toMatchObject({ nickname: "小明", grade: 4, gradeLabel: "四年级", explainPref: "voice", avatar: "a1" });
    const kidId = kid.json().child.id;

    // the cookie works as well as the bearer token
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const me2 = await t.call("GET", "/v1/me", undefined, undefined, { cookie });
    expect(me2.json().children).toHaveLength(1);
    expect(me2.json().activeChildId).toBeNull();

    expect((await t.call("POST", "/v1/session/child", { childId: kidId }, token)).statusCode).toBe(200);
    expect((await t.call("GET", "/v1/me", undefined, token)).json().activeChildId).toBe(kidId);

    // logging out ends the session
    await t.call("POST", "/v1/auth/logout", undefined, token);
    expect((await t.call("GET", "/v1/me", undefined, token)).statusCode).toBe(401);
    await t.close();
  });

  it("code rules: resend wait, wrong tries, expiry, daily limit, captcha", async () => {
    const t = await setup();
    await t.call("POST", "/v1/auth/sms-code", { phone: PHONE });
    const again = await t.call("POST", "/v1/auth/sms-code", { phone: PHONE });
    expect(again.statusCode).toBe(429);
    expect(again.json().error).toBe("too_soon");

    const wrong = await t.call("POST", "/v1/auth/login", { phone: PHONE, code: t.sms.lastCode(PHONE) === "000000" ? "111111" : "000000" });
    expect(wrong.json()).toMatchObject({ error: "code_wrong", attemptsLeft: 4 });
    for (let i = 0; i < 3; i++) await t.call("POST", "/v1/auth/login", { phone: PHONE, code: "999999" === t.sms.lastCode(PHONE) ? "888888" : "999999" });
    const fifth = await t.call("POST", "/v1/auth/login", { phone: PHONE, code: "999999" === t.sms.lastCode(PHONE) ? "888888" : "999999" });
    expect(fifth.json().error).toBe("code_expired");
    // even the right code no longer works
    expect((await t.call("POST", "/v1/auth/login", { phone: PHONE, code: t.sms.lastCode(PHONE) })).json().error).toBe("code_expired");

    // 5 wrong tries in 24h → graphic captcha needed for a new code
    t.clock.advance(61_000);
    expect((await t.call("POST", "/v1/auth/sms-code", { phone: PHONE })).json().error).toBe("captcha_required");
    expect((await t.call("POST", "/v1/auth/sms-code", { phone: PHONE, captcha: "bad" })).json().error).toBe("captcha_wrong");
    expect((await t.call("POST", "/v1/auth/sms-code", { phone: PHONE, captcha: "ok" })).statusCode).toBe(200);

    // a code expires after 5 minutes
    t.clock.advance(5 * 60_000 + 1);
    expect((await t.call("POST", "/v1/auth/login", { phone: PHONE, code: t.sms.lastCode(PHONE) })).json().error).toBe("code_expired");

    // 10 codes per phone per Beijing day
    const other = "13900000000";
    for (let i = 0; i < 10; i++) {
      t.clock.advance(61_000);
      expect((await t.call("POST", "/v1/auth/sms-code", { phone: other })).statusCode).toBe(200);
    }
    t.clock.advance(61_000);
    expect((await t.call("POST", "/v1/auth/sms-code", { phone: other })).json().error).toBe("daily_limit");

    // bad phone, SMS service down
    expect((await t.call("POST", "/v1/auth/sms-code", { phone: "123" })).json().error).toBe("phone");
    t.sms.fail = true;
    const down = await t.call("POST", "/v1/auth/sms-code", { phone: "13700000000" });
    expect(down.statusCode).toBe(502);
    await t.close();
  });

  it("不同意 blocks the site; agreeing later works; a new document version asks again", async () => {
    const t = await setup();
    const f = await t.family(PHONE, [], false);
    const no = await t.call("POST", "/v1/family/consent", { choice: "disagree", version: t.cfg.policyVersion }, f.token);
    expect(no.json()).toEqual({ needsConsent: true, refused: true });
    expect((await t.call("GET", "/v1/children", undefined, f.token)).json().error).toBe("refused");
    expect((await t.call("GET", "/v1/me", undefined, f.token)).json().refused).toBe(true);

    await t.call("POST", "/v1/family/consent", { choice: "agree", version: t.cfg.policyVersion }, f.token);
    expect((await t.call("GET", "/v1/children", undefined, f.token)).statusCode).toBe(200);
    expect(await t.db.select().from(consentRecords).where(eq(consentRecords.familyId, f.familyId))).toHaveLength(2);

    // the documents change: parents confirm again; an old version is refused
    t.cfg.policyVersion = "2027-06";
    expect((await t.call("GET", "/v1/children", undefined, f.token)).json().error).toBe("policy_changed");
    expect((await t.call("POST", "/v1/family/consent", { choice: "agree", version: "2027-01" }, f.token)).statusCode).toBe(409);
    await t.call("POST", "/v1/family/consent", { choice: "agree", version: "2027-06" }, f.token);
    expect((await t.call("GET", "/v1/children", undefined, f.token)).statusCode).toBe(200);
    await t.close();
  });

  it("child profiles: grade history, only your own children, at most 6", async () => {
    const t = await setup();
    const a = await t.family(PHONE, [{ nickname: "小明", grade: 4 }]);
    const b = await t.family("13911112222", [{ nickname: "小红", grade: 6 }]);
    const id = a.childIds[0]!;
    const up = await t.call("PATCH", `/v1/children/${id}`, { grade: 5, explainPref: "text" }, a.token);
    expect(up.json().child).toMatchObject({ grade: 5, explainPref: "text" });
    const hist = await t.db.select().from(gradeChanges).where(eq(gradeChanges.childId, id));
    expect(hist.map((h) => [h.fromGrade, h.toGrade, h.source])).toEqual([
      [null, 4, "created"],
      [4, 5, "parent"],
    ]);
    // another family cannot see, change or choose this child
    expect((await t.call("PATCH", `/v1/children/${id}`, { grade: 6 }, b.token)).statusCode).toBe(404);
    expect((await t.call("POST", "/v1/session/child", { childId: id }, b.token)).statusCode).toBe(404);
    expect((await t.call("PATCH", "/v1/children/not-a-uuid", { grade: 6 }, a.token)).statusCode).toBe(404);
    expect((await t.call("PATCH", `/v1/children/${id}`, {}, a.token)).statusCode).toBe(400);
    for (let i = 0; i < 5; i++) await t.call("POST", "/v1/children", { nickname: `孩子${i}`, grade: 3 }, a.token);
    const seventh = await t.call("POST", "/v1/children", { nickname: "第七个", grade: 3 }, a.token);
    expect(seventh.json().error).toBe("too_many_children");
    expect((await t.call("POST", "/v1/children", { nickname: "x", grade: 11 }, a.token)).statusCode).toBe(400);
    await t.close();
  });

});

describe("login lifetime (PRD part 3 §20.7: 180 days, a parameter)", () => {
  it("stays valid while used within 180 days; 180 days unused → log in again", async () => {
    const t = await setup();
    expect(t.cfg.family.sessionDays).toBe(180);
    const f = await t.family("13812340000", [{ nickname: "小天", grade: 4 }]);
    t.clock.advance(179 * DAY);
    expect((await t.call("GET", "/v1/me", undefined, f.token)).statusCode).toBe(200);
    t.clock.advance(179 * DAY);
    expect((await t.call("GET", "/v1/me", undefined, f.token)).statusCode).toBe(200);
    t.clock.advance(181 * DAY);
    expect((await t.call("GET", "/v1/me", undefined, f.token)).json().error).toBe("session_expired");
    await t.close();
  });
});
