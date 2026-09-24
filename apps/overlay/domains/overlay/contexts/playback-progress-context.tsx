'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { PlaybackProgress } from '../components/now-playing/types';

/**
 * PlaybackProgressContext
 *
 * Why this exists:
 *   The unified overlay (`/widgets/total`) used to keep `playbackProgress`
 *   in the root component's `useState`. The WS `playback.progress` event
 *   fires every ~1 second, so every tick caused the entire root component
 *   to re-render — even though only the now-playing sub-widget actually
 *   reads progress. The other three sub-widgets (queue, chatbox, setlist)
 *   were paying for re-renders they didn't need (saved by `memo` for sibling
 *   widgets but Now Playing itself still re-rendered every tick).
 *
 * Solution:
 *   Hold the `playbackProgress` state inside a dedicated Provider. The root
 *   component uses `useSetPlaybackProgress()` (a stable setter from this
 *   context) inside the WS callback, but never subscribes to the value —
 *   so progress updates do NOT re-render the root. Only components that
 *   call `usePlaybackProgress()` re-render when progress changes; for the
 *   total overlay that's just the small wrapper around the Now Playing
 *   widget.
 *
 * Pattern:
 *   Two contexts (value + setter) are intentionally separated so consumers
 *   that only need to *update* progress don't re-render when progress
 *   changes, and consumers that only need to *read* progress aren't given
 *   a setter that would needlessly invalidate their memo references.
 */

export const DEFAULT_PLAYBACK_PROGRESS: PlaybackProgress = {
  currentTime: 0,
  duration: 0,
  state: 'unstarted',
  percentage: 0,
};

const PlaybackProgressValueContext = createContext<PlaybackProgress>(
  DEFAULT_PLAYBACK_PROGRESS,
);

type SetProgress = (progress: PlaybackProgress) => void;

const NOOP_SET_PROGRESS: SetProgress = () => {
  /* default no-op when no provider is mounted */
};

const PlaybackProgressSetterContext = createContext<SetProgress>(NOOP_SET_PROGRESS);

interface PlaybackProgressProviderProps {
  children: ReactNode;
  initialProgress?: PlaybackProgress;
}

export function PlaybackProgressProvider({
  children,
  initialProgress,
}: PlaybackProgressProviderProps) {
  const [progress, setProgress] = useState<PlaybackProgress>(
    initialProgress ?? DEFAULT_PLAYBACK_PROGRESS,
  );

  // Stable setter reference — `useState`'s setter is already stable, but
  // wrapping with `useCallback` makes the intent explicit and protects
  // against future refactors (e.g. switching to `useReducer`).
  const setStableProgress = useCallback<SetProgress>((next) => {
    setProgress(next);
  }, []);

  // Memoise the value object reference so consumers of `usePlaybackProgress()`
  // only re-render when the actual fields change. (Same object identity is
  // already preserved by `useState`, but this guards against accidental
  // re-creation if we later wrap in `useMemo` of an object literal.)
  const valueMemo = useMemo(() => progress, [progress]);

  return (
    <PlaybackProgressSetterContext.Provider value={setStableProgress}>
      <PlaybackProgressValueContext.Provider value={valueMemo}>
        {children}
      </PlaybackProgressValueContext.Provider>
    </PlaybackProgressSetterContext.Provider>
  );
}

/** Subscribe to playback progress. Re-renders the caller when progress changes. */
export function usePlaybackProgress(): PlaybackProgress {
  return useContext(PlaybackProgressValueContext);
}

/** Get a stable setter for playback progress. Does NOT subscribe to value updates. */
export function useSetPlaybackProgress(): SetProgress {
  return useContext(PlaybackProgressSetterContext);
}
