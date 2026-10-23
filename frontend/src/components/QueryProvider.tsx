"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ApiError, isTimeout, onDataChanged } from "@/lib/api";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A page loads its data once: going back to it, or back to the browser tab, shows the cached
        // copy without asking the server again. Data counts as fresh for 10 minutes; after that the
        // next visit loads it again (for changes made by other people meanwhile)
        staleTime: 10 * 60_000,
        // Pages not visited for half an hour are dropped from memory and load fresh next time
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        // Only retry when the server couldn't be reached; its own errors (401, 422, 500…) won't change,
        // and one that took the whole timeout would only keep the spinner going longer
        retry: (failureCount, error) => !(error instanceof ApiError) && !isTimeout(error) && failureCount < 2,
      },
    },
  });
}

/** The shared cache behind `useApiData`. One lives in the root layout. */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  // After any change (save, delete, approve…) other pages may show something else now: mark the
  // whole cache stale without loading anything yet, so each page loads again once, when next opened.
  // The page that made the change reloads its own data as before.
  useEffect(() => {
    onDataChanged(() => void queryClient.invalidateQueries({ refetchType: "none" }));
    return () => onDataChanged(null);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  );
}
