"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ApiError } from "@/lib/api";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cached data shows straight away, and a fresh copy still loads on every mount and when the
        // tab regains focus, so a page never sits on data from before a change made elsewhere
        staleTime: 0,
        refetchOnWindowFocus: true,
        // Only retry when the server couldn't be reached; its own errors (401, 422, 500…) won't change
        retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 2,
      },
    },
  });
}

/** The shared cache behind `useApiData`. One lives in the root layout. */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  );
}
