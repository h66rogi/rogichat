"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { AuthRefreshListener } from "./auth-refresh-listener";

// 글로벌 onError — react-query 의 query/mutation 실패가 컴포넌트 단에서
// isError 분기 누락으로 silent 하게 사라지지 않도록 console.error 로 기록.
// PostHog 분석 이벤트 발화는 hook 단에서 별도로 처리.
function logQueryError(
  error: unknown,
  context: { kind: "query" | "mutation"; queryKey?: unknown },
) {
  if (typeof window === "undefined") return;
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");
  // eslint-disable-next-line no-console
  console.error(`[react-query] ${context.kind} error:`, message, {
    queryKey: context.queryKey,
    error,
  });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      logQueryError(error, { kind: "query", queryKey: query.queryKey });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      logQueryError(error, { kind: "mutation" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthRefreshListener />
      {children}
    </QueryClientProvider>
  );
}
