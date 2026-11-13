/** Who is logged in to the console. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdminMe } from "@zhiyouji/shared";
import { api, setUnauthorizedHandler, tokenStore } from "./api";

type AuthState = { status: "loading" } | { status: "out"; reason?: string } | { status: "in"; me: AdminMe };

interface AuthApi {
  state: AuthState;
  signIn: (token: string, me: AdminMe) => void;
  signOut: (reason?: string) => Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export const SIGNED_OUT_TEXT: Record<string, string> = {
  session_expired: "超过 30 分钟没有操作，已自动退出，请重新登录。",
  not_logged_in: "登录已失效，请重新登录。",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (tokenStore.get() ? { status: "loading" } : { status: "out" }));

  useEffect(() => {
    if (state.status !== "loading") return;
    api.me().then(
      (me) => setState({ status: "in", me }),
      () => {
        tokenStore.set(null);
        setState({ status: "out" });
      },
    );
  }, [state.status]);

  useEffect(() => {
    setUnauthorizedHandler((code) => {
      tokenStore.set(null);
      setState({ status: "out", reason: SIGNED_OUT_TEXT[code] ?? SIGNED_OUT_TEXT.not_logged_in });
    });
  }, []);

  const signIn = useCallback((token: string, me: AdminMe) => {
    tokenStore.set(token);
    setState({ status: "in", me });
  }, []);

  const signOut = useCallback(async (reason?: string) => {
    try {
      await api.logout();
    } catch {
      /* already gone */
    }
    tokenStore.set(null);
    setState({ status: "out", reason });
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export function useAdmin(): AdminMe {
  const { state } = useAuth();
  if (state.status !== "in") throw new Error("not logged in");
  return state.me;
}
