/**
 * Accounts: what the student website, the admin console and the server agree
 * on (PRD part 5 A1–A3, part 7 §0, part 8 §2.1 and §3.1).
 */

import { z } from "zod";

/** Mainland China mobile number: 11 digits starting with 1[3-9]. */
export const PHONE_RE = /^1[3-9]\d{9}$/;

export function isMainlandMobile(s: string): boolean {
  return PHONE_RE.test(s);
}

/** 138****1234 — what the site shows back to the parent. */
export function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : "****";
}

/** Grades on the registration survey (content library 10.2): 一年级 … 初三, 高中. */
export const GRADE_LABELS: Readonly<Record<number, string>> = {
  1: "一年级",
  2: "二年级",
  3: "三年级",
  4: "四年级",
  5: "五年级",
  6: "六年级",
  7: "初一",
  8: "初二",
  9: "初三",
  10: "高中",
};
export const MIN_GRADE = 1;
export const MAX_GRADE = 10;

/** Preset avatars (no photos of the child are collected). */
export const AVATARS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"] as const;

export const phoneSchema = z.string().trim().regex(PHONE_RE, "phone");

export const smsCodeRequest = z.object({
  phone: phoneSchema,
  /** Graphic captcha token, required after several wrong codes (part 8 §3.1). */
  captcha: z.string().min(1).max(2000).optional(),
});
export type SmsCodeRequest = z.infer<typeof smsCodeRequest>;

export const loginRequest = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, "code"),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const consentRequest = z.object({
  choice: z.enum(["agree", "disagree"]),
  /** The document version shown on the consent screen. */
  version: z.string().min(1).max(40),
});
export type ConsentRequest = z.infer<typeof consentRequest>;

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, "nickname")
  .max(12, "nickname")
  .refine((s) => !/[\u0000-\u001f<>]/.test(s), "nickname");

export const childCreate = z.object({
  nickname: nicknameSchema,
  avatar: z.enum(AVATARS).default("a1"),
  grade: z.number().int().min(MIN_GRADE).max(MAX_GRADE),
  explainPref: z.enum(["voice", "text"]).default("voice"),
});
export type ChildCreate = z.infer<typeof childCreate>;

export const childUpdate = z
  .object({
    nickname: nicknameSchema.optional(),
    avatar: z.enum(AVATARS).optional(),
    grade: z.number().int().min(MIN_GRADE).max(MAX_GRADE).optional(),
    explainPref: z.enum(["voice", "text"]).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty");
export type ChildUpdate = z.infer<typeof childUpdate>;

export const chooseChild = z.object({ childId: z.uuid() });

export interface ChildView {
  id: string;
  nickname: string;
  avatar: string;
  grade: number;
  gradeLabel: string;
  explainPref: "voice" | "text";
}

export interface FamilyMe {
  family: { id: string; phone: string };
  /** The parent must (re)confirm the documents before anything else. */
  needsConsent: boolean;
  /** The parent pressed 不同意 last time. */
  refused: boolean;
  policyVersion: string;
  children: ChildView[];
  activeChildId: string | null;
}

// ---- admin console ------------------------------------------------------------

export const ADMIN_ROLES = ["admin", "reviewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const MIN_ADMIN_PASSWORD = 10;

export const adminLoginRequest = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
  totp: z.string().trim().regex(/^\d{6}$/, "totp"),
});

export const adminInviteRequest = z.object({
  email: z.email().trim().toLowerCase(),
  name: z.string().trim().min(1).max(40),
  role: z.enum(ADMIN_ROLES),
  timezone: z.string().max(60).optional(),
});

export const inviteStartRequest = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(MIN_ADMIN_PASSWORD, "password_short").max(200),
});

export const inviteFinishRequest = z.object({
  token: z.string().min(20).max(200),
  code: z.string().trim().regex(/^\d{6}$/, "totp"),
});

export interface AdminMe {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  timezone: string;
}

/** 申请导出或删除我的数据 (PRD part 5 G4). Delete without a child = the whole family account. */
export const dataRequestCreate = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("export"), childId: z.uuid() }),
  z.object({ kind: z.literal("delete"), childId: z.uuid().nullable() }),
]);
