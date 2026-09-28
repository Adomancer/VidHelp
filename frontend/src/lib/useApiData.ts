"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { errorMessage } from "./api";

/**
 * Load data for a page. Re-runs whenever `key` changes (put every input of
 * `load` in it) or `reload()` is called. Keeps the previous data while loading.
 */
export function useApiData<T>(key: string, load: () => Promise<T>) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const requestKey = `${key}#${version}`;
  const runLoad = useEffectEvent(load);

  useEffect(() => {
    let cancelled = false;

    runLoad()
      .then((data) => !cancelled && setState({ key: requestKey, data }))
      .catch((error) => !cancelled && setState((current) => ({ key: requestKey, data: current?.data, error: errorMessage(error) })));

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const setData = useCallback((data: T) => setState((current) => ({ key: current?.key ?? "", data })), []);

  return { data: state?.data, error: state?.error, loading: state?.key !== requestKey, reload, setData };
}
