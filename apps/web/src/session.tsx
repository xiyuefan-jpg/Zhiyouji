/**
 * Who is using the site right now: not logged in, logged in (with the
 * parent's confirmation state, the children, and the chosen child).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChildView, FamilyMe } from "@zhiyouji/shared";
import { api, ApiError } from "./api";

export type SessionState =
  | { status: "loading" }
  | { status: "out" }
  | { status: "error"; message: string }
  | { status: "in"; me: FamilyMe };

interface SessionApi {
  state: SessionState;
  /** Load /v1/me again (after login, consent, choosing a child …). */
  refresh: () => Promise<void>;
  setMe: (me: FamilyMe) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionApi | null>(null);

export function SessionProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      setState({ status: "in", me: await api.me() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: "out" });
      else setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    // Nothing is requested before the privacy pop-up is accepted (part 5 A1).
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ status: "out" });
    }
  }, []);

  const value = useMemo(() => ({ state, refresh, setMe: (me: FamilyMe) => setState({ status: "in", me }), logout }), [state, refresh, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** The logged-in family (only use inside pages shown after login). */
export function useMe(): FamilyMe {
  const { state } = useSession();
  if (state.status !== "in") throw new Error("not logged in");
  return state.me;
}

/** The chosen child (only use inside pages shown after "我是谁"). */
export function useChild(): ChildView {
  const me = useMe();
  const c = me.children.find((k) => k.id === me.activeChildId);
  if (!c) throw new Error("no active child");
  return c;
}
