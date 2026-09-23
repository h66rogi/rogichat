"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Photoshop 히스토리 패널을 위한 라벨드 undo/redo 훅.
 *
 * 기존 `useUndoableState` 와 차이:
 *  - 각 히스토리 entry 에 `label` 을 붙여 "이동", "텍스트 색상", "삭제" 같이
 *    Photoshop 히스토리 패널에 표시할 수 있게 함.
 *  - 패널에서 임의 entry 클릭 → 해당 시점으로 점프 (`jumpTo`).
 *  - 히스토리 길이 limit + coalesce 정책은 동일.
 */

const HISTORY_LIMIT = 64;
const COALESCE_WINDOW_MS = 500;

export interface SetStateOptions {
  /** 같은 키 + 500ms 안이면 직전 entry 의 state 만 교체 (label 은 유지). */
  coalesce?: string;
  /** 히스토리 패널에 표시할 액션 라벨. */
  label?: string;
}

export type Updater<T> = (prev: T) => T;

export interface HistoryEntry<T> {
  state: T;
  label: string;
  /** 정렬/표시용 ms epoch. */
  at: number;
}

export interface UseEditorHistoryResult<T> {
  state: T;
  setState: (next: T | Updater<T>, options?: SetStateOptions) => void;
  undo: () => void;
  redo: () => void;
  reset: (next: T, label?: string) => void;
  /** 히스토리 패널: 임의 entry 로 점프. index 는 entries 배열 기준. */
  jumpTo: (index: number) => void;
  clearFuture: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 히스토리 패널 표시용 — past + 현재 + future 를 시간순으로 합친 list. */
  entries: HistoryEntry<T>[];
  /** 현재 present 가 entries 의 몇 번째 (0-base) 인지. */
  currentIndex: number;
  pastSize: number;
  futureSize: number;
}

interface InternalState<T> {
  past: HistoryEntry<T>[];
  present: HistoryEntry<T>;
  future: HistoryEntry<T>[];
}

function isUpdater<T>(value: T | Updater<T>): value is Updater<T> {
  return typeof value === "function";
}

export function useEditorHistory<T>(
  initial: T,
  initialLabel = "초기 상태",
): UseEditorHistoryResult<T> {
  const [history, setHistory] = useState<InternalState<T>>(() => ({
    past: [],
    present: { state: initial, label: initialLabel, at: Date.now() },
    future: [],
  }));

  const lastReasonRef = useRef<string | null>(null);
  const lastEditAtRef = useRef<number>(0);

  const setState = useCallback(
    (next: T | Updater<T>, options?: SetStateOptions) => {
      setHistory((prev) => {
        const resolved: T = isUpdater(next)
          ? next(prev.present.state)
          : next;
        if (Object.is(resolved, prev.present.state)) {
          return prev;
        }

        const now = Date.now();
        const reason = options?.coalesce;
        const label = options?.label ?? prev.present.label;
        const shouldCoalesce =
          reason !== undefined &&
          lastReasonRef.current === reason &&
          now - lastEditAtRef.current < COALESCE_WINDOW_MS;

        lastEditAtRef.current = now;
        lastReasonRef.current = reason ?? null;

        if (shouldCoalesce) {
          return {
            past: prev.past,
            present: { state: resolved, label, at: now },
            future: [],
          };
        }

        const nextPast =
          prev.past.length >= HISTORY_LIMIT
            ? [
                ...prev.past.slice(prev.past.length - HISTORY_LIMIT + 1),
                prev.present,
              ]
            : [...prev.past, prev.present];

        return {
          past: nextPast,
          present: { state: resolved, label, at: now },
          future: [],
        };
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      const nextPast = prev.past.slice(0, prev.past.length - 1);
      lastReasonRef.current = null;
      lastEditAtRef.current = 0;
      return {
        past: nextPast,
        present: previous,
        future: [...prev.future, prev.present],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[prev.future.length - 1];
      const nextFuture = prev.future.slice(0, prev.future.length - 1);
      lastReasonRef.current = null;
      lastEditAtRef.current = 0;
      return {
        past: [...prev.past, prev.present],
        present: next,
        future: nextFuture,
      };
    });
  }, []);

  const reset = useCallback((next: T, label = "초기 상태") => {
    lastReasonRef.current = null;
    lastEditAtRef.current = 0;
    setHistory({
      past: [],
      present: { state: next, label, at: Date.now() },
      future: [],
    });
  }, []);

  const clearFuture = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      return { past: prev.past, present: prev.present, future: [] };
    });
  }, []);

  const jumpTo = useCallback((index: number) => {
    setHistory((prev) => {
      const all = [...prev.past, prev.present, ...[...prev.future].reverse()];
      if (index < 0 || index >= all.length) return prev;
      const nextPast = all.slice(0, index);
      const nextPresent = all[index];
      const nextFuture = all.slice(index + 1).reverse();
      lastReasonRef.current = null;
      lastEditAtRef.current = 0;
      return {
        past: nextPast,
        present: nextPresent,
        future: nextFuture,
      };
    });
  }, []);

  // future 는 최근(top) 이 마지막 — 표시용으로는 reverse 해서 시간순 합친다.
  const entries = [
    ...history.past,
    history.present,
    ...[...history.future].reverse(),
  ];
  const currentIndex = history.past.length;

  return {
    state: history.present.state,
    setState,
    undo,
    redo,
    reset,
    jumpTo,
    clearFuture,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    entries,
    currentIndex,
    pastSize: history.past.length,
    futureSize: history.future.length,
  };
}
