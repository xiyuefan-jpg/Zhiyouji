/** Load the child's season once per page, with a reload function. */

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api";
import { seasonApi, type SeasonMe } from "../../seasonApi";

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fn().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e: unknown) => setError(e instanceof ApiError ? e.message : String(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function useSeasonMe() {
  return useLoad<SeasonMe>(() => seasonApi.me());
}
