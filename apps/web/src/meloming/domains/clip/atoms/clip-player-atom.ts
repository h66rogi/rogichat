import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Clip } from "@/meloming/domains/clip/types/clip";

// 기본 atoms
export const globalClipAtom = atom<Clip | null>(null);
export const playerVisibleAtom = atom<boolean>(true);

// 플레이어 슬롯 element를 저장 (Portal 타겟)
export const playerSlotElementAtom = atom<HTMLElement | null>(null);

// 자동 재생 설정 (localStorage 저장)
export const autoplayEnabledAtom = atomWithStorage("meloming:autoplay", true);

// 플레이어 볼륨/음소거 (localStorage 저장 — 클립 전환·세션 간 유지)
// 클립이 바뀌면 플레이어가 통째로 remount 되므로, 새 video element 에 이 값을 복원한다.
export const playerVolumeAtom = atomWithStorage("meloming:player-volume", 1);
export const playerMutedAtom = atomWithStorage("meloming:player-muted", false);

// 다음 재생할 클립 큐 (사이드바에서 설정)
export const nextClipQueueAtom = atom<Clip[]>([]);

// 영상 종료 시 다음 클립 재생 action
export const playNextClipAtom = atom(null, (get, set) => {
  const queue = get(nextClipQueueAtom);
  const autoplayEnabled = get(autoplayEnabledAtom);

  if (!autoplayEnabled || queue.length === 0) return null;

  const [nextClip, ...rest] = queue;
  set(nextClipQueueAtom, rest);
  set(globalClipAtom, nextClip);
  return nextClip;
});

// 플레이어 닫기 action atom
export const closePlayerAtom = atom(null, (get, set) => {
  set(globalClipAtom, null);
  set(playerVisibleAtom, true);
  set(playerSlotElementAtom, null);
});
