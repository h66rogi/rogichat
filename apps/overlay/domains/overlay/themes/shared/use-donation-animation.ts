import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimationDef } from '../types';

interface UseDonationAnimationOptions {
  animation: AnimationDef | undefined;
  reducedMotion: boolean;
}

interface UseDonationAnimationResult {
  /** Whether a donation animation is currently playing */
  isPlaying: boolean;
  /** Trigger the donation animation. Call when a donation event arrives. */
  trigger: () => void;
}

/**
 * Plays a donation animation when triggered.
 * Supports the AnimationDef.iterations field to control repetition count.
 * Auto-resets after total duration completes.
 */
export function useDonationAnimation(
  options: UseDonationAnimationOptions
): UseDonationAnimationResult {
  const { animation, reducedMotion } = options;
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);

  const trigger = useCallback(() => {
    if (reducedMotion || !animation) return;

    // Clear any in-progress timer
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    setIsPlaying(true);

    const iterations = animation.iterations ?? 1;
    const totalDuration = animation.enterDuration * iterations;

    timerRef.current = window.setTimeout(() => {
      setIsPlaying(false);
      timerRef.current = null;
    }, totalDuration);
  }, [animation, reducedMotion]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { isPlaying, trigger };
}
