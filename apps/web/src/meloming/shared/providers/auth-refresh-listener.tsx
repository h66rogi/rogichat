"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, useIsMutating } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { onAuthRefreshed } from "@/meloming/shared/lib/auth-events";

/**
 * /auth/refresh 성공 broadcast를 받아
 *  1) 인증 의존 React Query 캐시(invalidateQueries)
 *  2) 서버 컴포넌트 트리(router.refresh)
 * 를 동기화한다.
 *
 * 가드:
 * - in-flight 단일화 (이미 처리 중이면 스킵)
 * - 500ms debounce — 다중 401 burst가 한 번의 refresh로 묶여도 한 번만 sync
 * - 진행 중 mutation(useIsMutating>0)이면 끝날 때까지 대기 → optimistic update와의 race 회피
 */

const DEBOUNCE_MS = 500;
const MUTATION_WAIT_TIMEOUT_MS = 5000;

// 실제 query key root와 정확히 매칭되어야 한다.
// authKeys.all = ["auth"], myChannelKeys.all = ["my-channel"],
// notifications: ["notifications", ...]
const AUTH_DEPENDENT_KEY_PREFIXES: ReadonlyArray<string> = [
  "auth",
  "my-channel",
  "notifications",
];

function isAuthDependentQueryKey(key: readonly unknown[]): boolean {
  if (key.length === 0) return false;
  const head = key[0];
  if (typeof head === "string" && AUTH_DEPENDENT_KEY_PREFIXES.includes(head)) {
    return true;
  }
  // 'permission'으로 끝나는 키 (use-channel.ts의 channelKeys.identifierPermission 등)
  const tail = key[key.length - 1];
  if (typeof tail === "string" && tail === "permission") return true;
  return false;
}

export function AuthRefreshListener() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mutatingCount = useIsMutating();

  const inFlightRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
  const mutatingCountRef = useRef(mutatingCount);

  useEffect(() => {
    mutatingCountRef.current = mutatingCount;
  }, [mutatingCount]);

  useEffect(() => {
    async function runSync() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        // mutation이 끝날 때까지 짧게 대기 (timeout 보호).
        const start = Date.now();
        while (
          mutatingCountRef.current > 0 &&
          Date.now() - start < MUTATION_WAIT_TIMEOUT_MS
        ) {
          await new Promise((r) => setTimeout(r, 100));
        }

        await queryClient.invalidateQueries({
          predicate: (query) => isAuthDependentQueryKey(query.queryKey),
        });

        // RSC 트리 재실행 — Header SSR(getUserMeServer)이
        // 만료 토큰으로 null을 반환했던 경우, fresh token으로 다시 렌더된다.
        router.refresh();
      } finally {
        inFlightRef.current = false;
      }
    }

    function scheduleSync() {
      pendingSyncRef.current = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (!pendingSyncRef.current) return;
        pendingSyncRef.current = false;
        void runSync();
      }, DEBOUNCE_MS);
    }

    const off = onAuthRefreshed(scheduleSync);
    return () => {
      off();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [queryClient, router]);

  return null;
}
