import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

type Sym = { symbol: string; name: string };

export function useAllSymbols() {
  const { data, isLoading, error } = useQuery<Sym[], Error>({
    queryKey: ["symbols-all"],
    queryFn: () => api.symbolsAll(),
    // Symbol list rarely changes within a session; the production
    // QueryClient already pins staleTime=5m. Keeping the explicit Infinity
    // here matches the previous module-level cache (cached for the page's
    // entire lifetime once successfully fetched).
    staleTime: Infinity,
  });

  return {
    symbols: data ?? [],
    loading: isLoading,
    error: error ? error.message : null,
  };
}
