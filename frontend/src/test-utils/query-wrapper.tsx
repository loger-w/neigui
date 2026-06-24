import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Tests want fresh fetches per render and no retry-storm on rejection,
// so we override the production defaults. Pair with renderHook via
// `wrapper: makeQueryWrapper()`.
export function makeQueryWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
