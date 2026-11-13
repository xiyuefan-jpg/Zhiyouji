/**
 * Server settings that are not season rules (those live in SeasonParams).
 * Everything has a default so tests and local runs need no setup.
 */

export interface ServerConfig {
  /** Secret for keyed hashes of SMS codes (set SERVER_SECRET in production). */
  secret: string;
  /** Version of the three documents (用户协议、隐私政策、儿童个人信息保护规则). Bump on a real change → parents re-confirm. */
  policyVersion: string;
  /** Links to the three documents shown on the consent screen. */
  policyLinks: { title: string; url: string }[];
  sms: {
    codeTtlMs: number;
    /** Wait before another code to the same phone. */
    resendMs: number;
    /** Codes per phone per Beijing day. */
    perPhonePerDay: number;
    /** Code requests per IP per hour. */
    perIpPerHour: number;
    /** Wrong tries before a code stops working. */
    maxAttempts: number;
    /** Wrong tries for a phone in the last 24 hours before the graphic captcha is required. */
    captchaAfterFails: number;
    /** Reminder SMS per phone per Beijing day (part 8 §1.3). */
    remindersPerDay: number;
  };
  family: {
    /** Login stays valid this long after the last use (sliding). */
    sessionDays: number;
    maxChildren: number;
  };
  admin: {
    /** Logged out after this long without any request (part 8 §3.1). */
    idleMinutes: number;
    /** Logged out after this long regardless. */
    maxSessionHours: number;
    maxFailedLogins: number;
    lockMinutes: number;
    inviteDays: number;
  };
  /** Session cookie names; cookies are httpOnly, SameSite=Lax, Secure in production. */
  cookies: { family: string; admin: string; secure: boolean };
}

export function defaultConfig(env: Record<string, string | undefined> = {}): ServerConfig {
  return {
    secret: env.SERVER_SECRET ?? "dev-secret-change-me",
    policyVersion: env.POLICY_VERSION ?? "2027-01",
    policyLinks: [
      { title: "用户协议", url: "/docs/terms" },
      { title: "隐私政策", url: "/docs/privacy" },
      { title: "儿童个人信息保护规则", url: "/docs/children" },
    ],
    sms: {
      codeTtlMs: 5 * 60_000,
      resendMs: 60_000,
      perPhonePerDay: 10,
      perIpPerHour: 30,
      maxAttempts: 5,
      captchaAfterFails: 3,
      remindersPerDay: 5,
    },
    family: { sessionDays: 365, maxChildren: 6 },
    admin: { idleMinutes: 30, maxSessionHours: 12, maxFailedLogins: 5, lockMinutes: 15, inviteDays: 7 },
    cookies: { family: "zyj_s", admin: "zyj_a", secure: env.NODE_ENV === "production" },
  };
}
