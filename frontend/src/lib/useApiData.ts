"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, withSignal } from "./api";

interface ApiDataOptions {
  /** Load again every `ms` while the tab is visible. */
  refetchInterval?: number | false;
  /** false: don't load (yet), e.g. while a popover is closed. */
  enabled?: boolean;
  /** How long loaded data counts as fresh (no reload on mount or window focus). */
  staleTime?: number;
  /**
   * While a new key loads, keep showing the data of the previous key (`stale` is true meanwhile).
   * Only for lists where that is harmless, e.g. the next page or another search; never for data
   * people act on, like the hosts of the chosen brand. A function decides per previous key.
   */
  keepPrevious?: boolean | ((previousKey: string) => boolean);
}

/**
 * Load data for a page. Re-runs whenever `key` changes (put every input of
 * `load` in it) or `reload()` is called. A new key starts without data unless `keepPrevious`.
 *
 * The key names one entry in the shared cache, so every component asking for the
 * same key gets the same data (one request). Start it with something unique to the
 * endpoint, e.g. `periods-${brandId}`.
 */
export function useApiData<T>(key: string, load: () => Promise<T>, { keepPrevious = false, ...options }: ApiDataOptions = {}) {
  const queryClient = useQueryClient();
  const query = useQuery<T>({
    queryKey: [key],
    // Requests stop when nothing shows this key anymore (page left, filter changed)
    queryFn: ({ signal }) => withSignal(signal, load),
    placeholderData: (previous, previousQuery) => {
      const previousKey = String(previousQuery?.queryKey[0] ?? "");
      return keepPrevious === true || (typeof keepPrevious === "function" && keepPrevious(previousKey)) ? previous : undefined;
    },
    ...options,
  });
  const { refetch } = query;
  const [reloading, setReloading] = useState(false);

  const reload = useCallback(() => {
    setReloading(true);
    void refetch().finally(() => setReloading(false));
  }, [refetch]);
  const setData = useCallback((data: T) => queryClient.setQueryData([key], data), [queryClient, key]);

  return {
    data: query.data,
    error: query.error ? errorMessage(query.error) : undefined,
    /**
     * Waiting on something the user did: the first load, another key (a filter, a page) or `reload()`.
     * Background polling (`refetchInterval`) doesn't count, so buttons don't spin or lock every minute.
     */
    loading: query.isLoading || query.isPlaceholderData || reloading,
    /** Any request in flight, background polling included. */
    refreshing: query.isFetching,
    /** Showing the previous key's data while this key loads (see `keepPrevious`). */
    stale: query.isPlaceholderData,
    reload,
    setData,
  };
}

/**
 * Mark cached data stale so whatever shows it loads again, e.g. `invalidate("brands")`
 * after a change that also alters the brand list. Matches every key starting with `prefix`.
 */
export function useInvalidate() {
  const queryClient = useQueryClient();
  return useCallback((prefix: string) => queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith(prefix) }), [queryClient]);
}
