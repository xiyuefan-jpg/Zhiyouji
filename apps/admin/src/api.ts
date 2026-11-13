/**
 * Talking to the server from the admin console. The console is served from
 * a different place than the API (OSS + CDN, part 2 §4.11), so the login is a
 * Bearer token kept in sessionStorage: closing the tab logs out.
 */

import type { AdminMe, AdminRole, MessageView } from "@zhiyouji/shared";

const BASE: string = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "zyj_admin_token";

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

export const tokenStore = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(t: string | null): void {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked */
    }
  },
};

/** Called when the server says the login is gone (idle 30 minutes, disabled account …). */
let onUnauthorized: (code: string) => void = () => {};
export function setUnauthorizedHandler(fn: (code: string) => void): void {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "连不上服务器，请检查网络后再试");
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const { error, message, ...extra } = data ?? {};
    const code = typeof error === "string" ? error : "server";
    if (res.status === 401 && token && !path.startsWith("/v1/admin/auth/")) onUnauthorized(code);
    throw new ApiError(res.status, code, typeof message === "string" ? message : "服务器出了点问题，请稍后再试", extra);
  }
  return data as T;
}

export interface AdminUserRow extends AdminMe {
  status: "invited" | "active" | "disabled";
  lastLoginAt: string | null;
}

export interface ViewLogEntry {
  id: string;
  adminUserId: string;
  childId: string | null;
  contentKind: string;
  objectId: string | null;
  action: "view" | "download";
  at: string;
}

export const api = {
  login: (email: string, password: string, totp: string) =>
    request<{ token: string; expiresAt: string; idleMinutes: number; me: AdminMe }>("POST", "/v1/admin/auth/login", { email, password, totp }),
  logout: () => request<{ ok: true }>("POST", "/v1/admin/auth/logout"),
  me: () => request<AdminMe>("GET", "/v1/admin/me"),
  inviteStart: (token: string, password: string) => request<{ secret: string; otpauthUrl: string; email: string }>("POST", "/v1/admin/auth/invite/start", { token, password }),
  inviteFinish: (token: string, code: string) => request<{ me: AdminMe }>("POST", "/v1/admin/auth/invite/finish", { token, code }),
  users: () => request<{ users: AdminUserRow[] }>("GET", "/v1/admin/users"),
  invite: (i: { email: string; name: string; role: AdminRole; timezone?: string }) =>
    request<{ user: AdminMe; inviteToken: string; expiresAt: string }>("POST", "/v1/admin/users", i),
  disable: (id: string) => request<{ ok: true }>("POST", `/v1/admin/users/${id}/disable`),
  viewLog: (q: { adminUserId?: string; childId?: string; from?: string; to?: string; limit?: number }) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();
    return request<{ entries: ViewLogEntry[] }>("GET", `/v1/admin/view-log${qs ? `?${qs}` : ""}`);
  },
  messages: (before?: string) => request<{ messages: MessageView[] }>("GET", `/v1/admin/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  unreadCount: () => request<{ unread: number }>("GET", "/v1/admin/messages/unread-count"),
  readMessage: (id: string) => request<{ marked: number }>("POST", `/v1/admin/messages/${id}/read`),
  readAll: () => request<{ marked: number }>("POST", "/v1/admin/messages/read-all"),
};
