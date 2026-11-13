/**
 * Talking to the server (apps/server, `/v1`). The login lives in an httpOnly
 * cookie, so the page never handles the token itself. Errors come back with
 * the Chinese text from the server, or a plain message when the network is down.
 */

import type { ChildCreate, ChildUpdate, ChildView, FamilyMe, MessageView } from "@zhiyouji/shared";

const BASE: string = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const NETWORK_MESSAGE = "网络连不上，请检查一下网络再试";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", NETWORK_MESSAGE);
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const { error, message, ...extra } = data ?? {};
    throw new ApiError(res.status, typeof error === "string" ? error : "server", typeof message === "string" ? message : "服务器出了点问题，请稍后再试", extra);
  }
  return data as T;
}

export const api = {
  policy: () => request<{ version: string; links: { title: string; url: string }[] }>("GET", "/v1/policy"),
  sendCode: (phone: string, captcha?: string) => request<{ resendAfterMs: number }>("POST", "/v1/auth/sms-code", { phone, captcha }),
  login: (phone: string, code: string) => request<{ me: FamilyMe }>("POST", "/v1/auth/login", { phone, code }),
  logout: () => request<{ ok: true }>("POST", "/v1/auth/logout"),
  me: () => request<FamilyMe>("GET", "/v1/me"),
  consent: (choice: "agree" | "disagree", version: string) => request<{ needsConsent: boolean; refused: boolean }>("POST", "/v1/family/consent", { choice, version }),
  createChild: (c: ChildCreate) => request<{ child: ChildView }>("POST", "/v1/children", c),
  updateChild: (id: string, patch: ChildUpdate) => request<{ child: ChildView }>("PATCH", `/v1/children/${id}`, patch),
  chooseChild: (childId: string) => request<{ child: ChildView }>("POST", "/v1/session/child", { childId }),
  messages: (before?: string) => request<{ messages: MessageView[] }>("GET", `/v1/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  unreadCount: () => request<{ unread: number }>("GET", "/v1/messages/unread-count"),
  readMessage: (id: string) => request<{ marked: number }>("POST", `/v1/messages/${id}/read`),
  readAll: () => request<{ marked: number }>("POST", "/v1/messages/read-all"),
};
