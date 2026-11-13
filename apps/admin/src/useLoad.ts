/** Load data for a page, with a reload function. */

import { useCallback, useEffect, useState } from "react";

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    fn().then(
      (d) => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload, loading };
}

/** Download a CSV (or any text) the server returns at `path` with the login token. */
export async function downloadText(path: string, filename: string): Promise<void> {
  const BASE: string = import.meta.env.VITE_API_BASE ?? "";
  let token: string | null = null;
  try {
    token = sessionStorage.getItem("zyj_admin_token");
  } catch {
    token = null;
  }
  const res = await fetch(`${BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("下载没有成功，请再试一次");
  const blob = new Blob([await res.text()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
