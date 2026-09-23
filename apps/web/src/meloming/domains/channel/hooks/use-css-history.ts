import { useState, useCallback, useRef } from "react";

export interface CssHistoryEntry {
  css: string;
  label: string;
  timestamp: number;
}

interface UseCssHistoryOptions {
  maxHistory?: number;
}

export function useCssHistory(options: UseCssHistoryOptions = {}) {
  const { maxHistory = 50 } = options;

  const [history, setHistory] = useState<CssHistoryEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const isUndoRedoRef = useRef(false);

  // 현재 CSS 가져오기
  const currentCss = currentIndex >= 0 ? history[currentIndex]?.css : "";

  // 히스토리에 새 항목 추가
  const pushHistory = useCallback(
    (css: string, label: string = "변경") => {
      // undo/redo 중에는 히스토리 추가 안 함
      if (isUndoRedoRef.current) {
        isUndoRedoRef.current = false;
        return;
      }

      setHistory((prev) => {
        // 현재 인덱스 이후의 히스토리 제거 (redo 스택 클리어)
        const newHistory = prev.slice(0, currentIndex + 1);

        // 새 항목 추가
        newHistory.push({
          css,
          label,
          timestamp: Date.now(),
        });

        // 최대 개수 초과 시 오래된 것 제거
        if (newHistory.length > maxHistory) {
          newHistory.shift();
          return newHistory;
        }

        return newHistory;
      });

      setCurrentIndex((prev) => Math.min(prev + 1, maxHistory - 1));
    },
    [currentIndex, maxHistory]
  );

  // 초기 CSS 설정 (서버에서 로드 시)
  const initHistory = useCallback((css: string) => {
    setHistory([
      {
        css,
        label: "초기 상태",
        timestamp: Date.now(),
      },
    ]);
    setCurrentIndex(0);
  }, []);

  // Undo
  const undo = useCallback((): CssHistoryEntry | null => {
    if (currentIndex <= 0) return null;

    isUndoRedoRef.current = true;
    const newIndex = currentIndex - 1;
    setCurrentIndex(newIndex);
    return history[newIndex];
  }, [currentIndex, history]);

  // Redo
  const redo = useCallback((): CssHistoryEntry | null => {
    if (currentIndex >= history.length - 1) return null;

    isUndoRedoRef.current = true;
    const newIndex = currentIndex + 1;
    setCurrentIndex(newIndex);
    return history[newIndex];
  }, [currentIndex, history]);

  // 특정 인덱스로 이동
  const goToIndex = useCallback(
    (index: number): CssHistoryEntry | null => {
      if (index < 0 || index >= history.length) return null;

      isUndoRedoRef.current = true;
      setCurrentIndex(index);
      return history[index];
    },
    [history]
  );

  // 히스토리 초기화
  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
  }, []);

  return {
    history,
    currentIndex,
    currentCss,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
    pushHistory,
    initHistory,
    undo,
    redo,
    goToIndex,
    clearHistory,
  };
}
