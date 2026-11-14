/**
 * Server settings that are not season rules (those live in SeasonParams).
 * Everything has a default so tests and local runs need no setup.
 */

import { DAILY_VOICE_MAX_SEC, MEDIA_MAX_SEC } from "@zhiyouji/shared";

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
  /** Requests per minute per login (or per IP before login) on /v1 (PRD part 8 §3.3: no hammering the API). */
  rateLimit: { perMinute: number };
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
  /**
   * Upload limits (PRD part 3 §20.6): hard limits are looser than the content
   * rules (videos and audio ≤ 5 minutes, ≤ 10 pages); the submit page warns but
   * does not refuse within these.
   */
  uploads: {
    maxBytes: Record<"video" | "audio" | "image" | "pdf", number>;
    /** Images per work. */
    maxImages: number;
    allowedTypes: Record<"video" | "audio" | "image" | "pdf", string[]>;
    /** Hard length limits in seconds: one video or audio file of a work, and a daily-task narration (§20.6). */
    maxDurationSec: { video: number; audio: number; narration: number };
    /** Slack for container rounding (a 90-second recording can report 91 s). */
    durationGraceSec: number;
    /** Content rules for works (content library §2): longer only warns on the submit page. */
    contentSec: { work: number; opening: number; rebuttal: number };
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
    rateLimit: { perMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 600) },
    family: { sessionDays: 180, maxChildren: 6 },
    admin: { idleMinutes: 30, maxSessionHours: 12, maxFailedLogins: 5, lockMinutes: 15, inviteDays: 7 },
    uploads: {
      maxBytes: { video: 500 * 1024 * 1024, audio: 100 * 1024 * 1024, image: 20 * 1024 * 1024, pdf: 50 * 1024 * 1024 },
      maxImages: 9,
      maxDurationSec: { video: MEDIA_MAX_SEC, audio: MEDIA_MAX_SEC, narration: DAILY_VOICE_MAX_SEC },
      durationGraceSec: 2,
      contentSec: { work: 300, opening: 180, rebuttal: 120 },
      allowedTypes: {
        video: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/3gpp"],
        audio: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a", "audio/amr"],
        image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"],
        pdf: ["application/pdf"],
      },
    },
    cookies: { family: "zyj_s", admin: "zyj_a", secure: env.NODE_ENV === "production" },
  };
}
