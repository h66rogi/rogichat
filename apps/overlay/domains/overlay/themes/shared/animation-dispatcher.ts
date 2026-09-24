import { useCallback } from 'react';
import type { AnimationDef, ThemeAnimationEvent } from '../types';
import { DEFAULT_FALLBACK_ANIMATION } from '../types';
import { buildAnimationShorthand, injectAnimationCss } from './animation-utils';

interface AnimationDispatcherOptions {
  themeId: string;
  animations: Partial<Record<ThemeAnimationEvent, AnimationDef>>;
  reducedMotion: boolean;
}

interface DispatchResult {
  /** CSS animation shorthand to apply to the element */
  animation: string;
  /** Duration in ms (for setTimeout/cleanup) */
  duration: number;
  /** Whether reduced motion was applied (no animation) */
  reduced: boolean;
}

/**
 * Hook that returns a dispatch function for triggering theme animations.
 * The dispatch function looks up the animation definition for an event,
 * injects its keyframes CSS (if provided), and returns the CSS shorthand
 * to apply to a target element.
 *
 * If the theme doesn't define an animation for the event, falls back to
 * DEFAULT_FALLBACK_ANIMATION (fade).
 *
 * If reducedMotion is true, returns a no-op (empty animation, 0 duration).
 */
export function useAnimationDispatcher(options: AnimationDispatcherOptions) {
  const { themeId, animations, reducedMotion } = options;

  const dispatch = useCallback(
    (event: ThemeAnimationEvent, phase: 'enter' | 'exit' = 'enter'): DispatchResult => {
      if (reducedMotion) {
        return { animation: 'none', duration: 0, reduced: true };
      }

      const def = animations[event] ?? DEFAULT_FALLBACK_ANIMATION;

      // Inject keyframes CSS if the theme provided inline css
      if (def.css) {
        injectAnimationCss(themeId, def.name, def.css);
      }

      const animation = buildAnimationShorthand(def, themeId, phase);
      const duration = phase === 'exit' && def.exitDuration !== undefined
        ? def.exitDuration
        : def.enterDuration;

      return { animation, duration, reduced: false };
    },
    [themeId, animations, reducedMotion]
  );

  return { dispatch };
}
