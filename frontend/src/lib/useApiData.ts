"use client";

import { useCallback } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "./api";

interface ApiDataOptions {
  /** Load again every `ms` while the tab is visible. */
  refetchInterval?: number | false;
  /** false: don't load (yet), e.g. while a popover is closed. */
  enabled?: boolean;
  /** How long loaded data counts as fresh (no reload on mount or window focus). */
  staleTime?: number;
}

/**
 * Load data for a page. Re-runs whenever `key` changes (put every input of
 * `load` in it) or `reload()` is called. Keeps the previous data while loading.
 *
 * The key names one entry in the shared cache, so every component asking for the
 * same key gets the same data (one request). Start it with something unique to the
 * endpoint, e.g. `periods-${brandId}`.
 */
export function useApiData<T>(key: string, load: () => Promise<T>, options: ApiDataOptions = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [key], queryFn: load, placeholderData: keepPreviousData, ...options });
  const { refetch } = query;

  const reload = useCallback(() => void refetch(), [refetch]);
  const setData = useCallback((data: T) => queryClient.setQueryData([key], data), [queryClient, key]);

  return {
    data: query.data,
    error: query.error ? errorMessage(query.error) : undefined,
    loading: query.isFetching,
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
