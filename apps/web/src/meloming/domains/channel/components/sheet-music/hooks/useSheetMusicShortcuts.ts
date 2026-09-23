import { useEffect } from 'react';

export interface SheetMusicShortcutHandlers {
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitWidth?: () => void;
  onFitPage?: () => void;
  onToggleFullscreen?: () => void;
  onRotate?: () => void;
  onDownload?: () => void;
}

/**
 * Sheet-music global keyboard shortcuts.
 *
 * Round 4 Low (Codex review):
 * - 실제로 처리하는 키에서만 preventDefault 호출하여 페이지 스크롤/내장 단축키 충돌 방지
 *   (처리 안 하는 키는 브라우저 기본 동작 유지)
 * - INPUT/TEXTAREA/contenteditable focus 시 skip (기존 동작 유지)
 */
export function useSheetMusicShortcuts(enabled: boolean, h: SheetMusicShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // skip if user is typing in an input/textarea/contenteditable
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      let handler: (() => void) | undefined;
      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          handler = h.onPrevPage;
          break;
        case 'ArrowRight':
        case 'PageDown':
          handler = h.onNextPage;
          break;
        case '+':
        case '=':
          handler = h.onZoomIn;
          break;
        case '-':
        case '_':
          handler = h.onZoomOut;
          break;
        case '0':
          handler = h.onFitWidth;
          break;
        case '1':
          handler = h.onFitPage;
          break;
        case 'f':
        case 'F':
          handler = h.onToggleFullscreen;
          break;
        case 'r':
        case 'R':
          handler = h.onRotate;
          break;
        case 'd':
        case 'D':
          if (e.ctrlKey || e.metaKey) return; // don't override browser Ctrl+D (bookmark)
          handler = h.onDownload;
          break;
        default:
          return;
      }
      if (!handler) return;
      // 처리하는 키에만 preventDefault 호출 — 방향키 스크롤/Space 스크롤 등 충돌 방지
      e.preventDefault();
      handler();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, h]);
}
