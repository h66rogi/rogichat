import { useEffect, useRef, useState } from 'react';
import type { AnimationDef } from '../types';

interface UseTrackTransitionOptions<T> {
  /** Current track data (changes trigger transition) */
  currentTrack: T | null;
  /** Stable semantic key for currentTrack; use this instead of object identity */
  trackKey?: string | number | null;
  /** Animation definition (from theme.animations['track.change']) */
  animation: AnimationDef | undefined;
  /** Reduced motion: skip animations entirely */
  reducedMotion: boolean;
  /** Theme identifier for namespaced CSS class (e.g. 'glassmorphism') */
  themeId?: string;
  /** Function to compare track identity (default: === comparison) */
  isSameTrack?: (a: T | null, b: T | null) => boolean;
}

interface UseTrackTransitionResult<T> {
  /** The track to render (may lag behind currentTrack during exit phase) */
  displayTrack: T | null;
  /** Current transition phase: 'idle' | 'exiting' | 'entering' */
  phase: 'idle' | 'exiting' | 'entering';
  /** CSS class to apply to the track display element */
  className: string;
}

/**
 * Animates track changes with three phases:
 *   1. exit (exitDuration ms) — old track plays exit animation
 *   2. swap — display data swaps to new track
 *   3. enter (enterDuration ms) — new track plays enter animation
 *
 * If exitDuration is undefined, uses enterDuration for both phases.
 * If reducedMotion or no animation, swaps immediately with no transition.
 */
export function useTrackTransition<T>(
  options: UseTrackTransitionOptions<T>
): UseTrackTransitionResult<T> {
  const { currentTrack, animation, reducedMotion, themeId, isSameTrack } = options;
  const trackKey = options.trackKey ?? currentTrack;
  const [displayTrack, setDisplayTrack] = useState<T | null>(currentTrack);
  const [phase, setPhase] = useState<'idle' | 'exiting' | 'entering'>('idle');
  const currentTrackRef = useRef<T | null>(currentTrack);
  const displayTrackRef = useRef<T | null>(currentTrack);
  const timersRef = useRef<number[]>([]);

  currentTrackRef.current = currentTrack;

  const commitDisplayTrack = (track: T | null) => {
    displayTrackRef.current = track;
    setDisplayTrack(track);
  };

  // Default identity check
  const compare = isSameTrack ?? ((a, b) => a === b);

  useEffect(() => {
    // Skip if same track or no change
    const nextTrack = currentTrackRef.current;
    const visibleTrack = displayTrackRef.current;

    if (compare(nextTrack, visibleTrack)) {
      return;
    }

    // Skip animation in reduced motion mode
    if (reducedMotion || !animation) {
      commitDisplayTrack(nextTrack);
      setPhase('idle');
      return;
    }

    // Clear any in-progress timers (handles rapid track changes)
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];

    const exitDuration = animation.exitDuration ?? animation.enterDuration;
    const enterDuration = animation.enterDuration;

    setPhase('exiting');

    const swapTimer = window.setTimeout(() => {
      commitDisplayTrack(currentTrackRef.current);
      setPhase('entering');

      const enterTimer = window.setTimeout(() => {
        setPhase('idle');
      }, enterDuration);
      timersRef.current.push(enterTimer);
    }, exitDuration);
    timersRef.current.push(swapTimer);

    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey, animation, reducedMotion]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, []);

  const className = phase === 'idle'
    ? ''
    : themeId
      ? `theme-track-${phase}-${themeId}`
      : `theme-track-${phase}`;

  return { displayTrack, phase, className };
}
