import { useCallback, useEffect, useState } from "react";

export type SheetMusicFitMode = "width" | "page" | "none";

export interface SheetMusicViewState {
  zoom: number;
  page: number;
  rotation: number;
  fitMode: SheetMusicFitMode;
}

const DEFAULT: SheetMusicViewState = {
  zoom: 1,
  page: 1,
  rotation: 0,
  fitMode: "width",
};

function key(songId: number) {
  return `meloming:sheet-music:${songId}`;
}

export function useLastViewState(songId: number) {
  const [state, setState] = useState<SheetMusicViewState>(() => {
    if (typeof window === "undefined") return DEFAULT;
    try {
      const raw = localStorage.getItem(key(songId));
      if (!raw) return DEFAULT;
      return { ...DEFAULT, ...JSON.parse(raw) };
    } catch {
      return DEFAULT;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    // P2: 200ms 는 단축키 연타 시 setItem flood + multi-tab race 가속.
    // 500ms 로 늘려 사용자가 멈춘 뒤에만 한 번 저장. 곡 전환은 hook key 변경
    // (songId) 으로 즉시 새 state 로 갈아끼워지므로 debounce 지연이 사용자에게
    // 보이지 않음.
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(key(songId), JSON.stringify(state));
      } catch {
        // ignore quota errors
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [songId, state]);

  const update = useCallback((patch: Partial<SheetMusicViewState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  return { state, update };
}
