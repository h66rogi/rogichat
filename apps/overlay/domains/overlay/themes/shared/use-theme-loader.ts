import { useEffect, useRef, useState } from 'react';
import type { ThemeDefinition } from '../types';
import { cleanupThemeAnimations } from './animation-utils';
import { loadThemeFonts, type ThemeFontHandle } from './font-loader';
import { loadThemeWithFallback } from '../registry';

interface UseThemeLoaderResult {
  theme: ThemeDefinition | null;
  isLoading: boolean;
}

function deferThemeStateUpdate(callback: () => void) {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback);
    return;
  }
  void Promise.resolve().then(callback);
}

export function useThemeLoader(
  requestedThemeId: string | null | undefined,
): UseThemeLoaderResult {
  const [theme, setTheme] = useState<ThemeDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Ref mirror of `theme` so the load effect can read the *current* theme without
  // depending on it (which would otherwise cause re-loads on every swap).
  const themeRef = useRef<ThemeDefinition | null>(null);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // 현재 활성 theme의 font release handle. swap 또는 unmount 시 호출.
  const activeFontHandleRef = useRef<ThemeFontHandle | null>(null);

  useEffect(() => {
    if (!requestedThemeId) {
      const current = themeRef.current;
      if (current) {
        activeFontHandleRef.current?.release();
        activeFontHandleRef.current = null;
        cleanupThemeAnimations(current.id);
        themeRef.current = null;
        // Defer state update out of the effect body to avoid cascading-render lint.
        deferThemeStateUpdate(() => setTheme(null));
      }
      deferThemeStateUpdate(() => setIsLoading(false));
      return;
    }

    // Already showing the requested theme — nothing to do.
    if (themeRef.current?.id === requestedThemeId) {
      return;
    }

    let cancelled = false;
    // 이번 effect 실행에서 acquire 한 font handle. swap 직전 또는 cancel 시
    // release 호출. 호출 단위 ownership이라 ref count drift 없음.
    let pendingHandle: ThemeFontHandle | null = null;

    deferThemeStateUpdate(() => {
      if (!cancelled) setIsLoading(true);
    });

    (async () => {
      try {
        const next = await loadThemeWithFallback(requestedThemeId);
        if (cancelled) return;

        // loadThemeFonts는 handle + ready를 즉시 반환. handle.release()를 load
        // 진행 중에도 호출 가능해, cancellation 시 font loop이 release 플래그를
        // 보고 즉시 중단 + 이미 acquire된 font도 한꺼번에 차감된다.
        const { handle, ready } = loadThemeFonts(
          next.id,
          next.fonts,
          next.performance?.maxFontFamilies,
        );
        pendingHandle = handle;
        await ready;

        if (cancelled) {
          handle.release();
          pendingHandle = null;
          return;
        }

        // Swap: 이전 theme의 font handle은 release, animations cleanup.
        const previous = themeRef.current;
        if (previous && previous.id !== next.id) {
          activeFontHandleRef.current?.release();
          cleanupThemeAnimations(previous.id);
        }

        // 새 theme를 active로 등록.
        activeFontHandleRef.current = handle;
        pendingHandle = null;
        themeRef.current = next;
        setTheme(next);
        setIsLoading(false);
      } catch (error) {
        console.error('[use-theme-loader] Failed to load theme', error);
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // cancel 시 pendingHandle이 존재하면(load 진행 중 또는 완료 대기) release.
      // handle 내부 loop이 released 플래그를 보고 이미 acquire된 font도 차감
      // 해준다. 완료 직후 settle된 경우엔 저 ready 분기에서 release 처리.
      if (pendingHandle) {
        pendingHandle.release();
        pendingHandle = null;
      }
    };
  }, [requestedThemeId]);

  // Cleanup on unmount: release active theme font handle + animations.
  useEffect(() => {
    return () => {
      activeFontHandleRef.current?.release();
      activeFontHandleRef.current = null;
      const current = themeRef.current;
      if (current) {
        cleanupThemeAnimations(current.id);
      }
    };
  }, []);

  return { theme, isLoading };
}
