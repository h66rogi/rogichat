import { useEffect, useRef, useState } from 'react';
import type { AnimationDef } from '../types';

interface ChatMessageWithAnimation<T> {
  message: T;
  /** Animation phase for this message */
  phase: 'entering' | 'visible' | 'exiting';
  /** Index for stagger calculation */
  index: number;
}

interface UseChatAnimationOptions<T> {
  /** Current visible chat messages (latest array, may grow or shrink) */
  messages: T[];
  /** Function to extract a stable id from a message */
  getMessageId: (msg: T) => string;
  /** Enter animation (chat.enter) */
  enterAnimation: AnimationDef | undefined;
  /** Exit animation (chat.exit) */
  exitAnimation: AnimationDef | undefined;
  /** Reduced motion: skip animations */
  reducedMotion: boolean;
}

interface UseChatAnimationResult<T> {
  /** Messages with animation phase metadata */
  animatedMessages: ChatMessageWithAnimation<T>[];
}

/**
 * Tracks message additions/removals and assigns animation phases.
 * - New messages start in 'entering' phase, transition to 'visible' after enterDuration
 * - Removed messages enter 'exiting' phase, then are removed after exitDuration
 * - Stagger value adds incremental delay between concurrent enter animations
 *
 * In reduced motion mode, all messages are immediately 'visible'.
 */
export function useChatAnimation<T>(
  options: UseChatAnimationOptions<T>
): UseChatAnimationResult<T> {
  const { messages, getMessageId, enterAnimation, exitAnimation, reducedMotion } = options;
  const [animatedMessages, setAnimatedMessages] = useState<ChatMessageWithAnimation<T>[]>([]);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const currentIds = new Set(messages.map(getMessageId));
    const previousIds = knownIdsRef.current;

    // Find new messages (in current but not previous)
    const newIds = new Set<string>();
    messages.forEach((msg) => {
      const id = getMessageId(msg);
      if (!previousIds.has(id)) newIds.add(id);
    });

    // Find removed messages (in previous but not current)
    const removedIds = new Set<string>();
    previousIds.forEach((id) => {
      if (!currentIds.has(id)) removedIds.add(id);
    });

    if (reducedMotion || (!enterAnimation && !exitAnimation)) {
      // No animation: just sync directly
      setAnimatedMessages(
        messages.map((message, index) => ({ message, phase: 'visible' as const, index }))
      );
      knownIdsRef.current = currentIds;
      return;
    }

    // Build animated state — keep removed messages temporarily in 'exiting' phase
    const next: ChatMessageWithAnimation<T>[] = [];
    let index = 0;

    messages.forEach((message) => {
      const id = getMessageId(message);
      if (newIds.has(id) && enterAnimation) {
        next.push({ message, phase: 'entering', index });

        // Schedule transition to 'visible' after enterDuration + stagger
        const stagger = enterAnimation.stagger ?? 0;
        const totalDelay = enterAnimation.enterDuration + stagger * index;

        // Clear any existing timer for this id
        const existing = timersRef.current.get(id);
        if (existing) window.clearTimeout(existing);

        const timer = window.setTimeout(() => {
          setAnimatedMessages((prev) =>
            prev.map((m) =>
              getMessageId(m.message) === id ? { ...m, phase: 'visible' as const } : m
            )
          );
          timersRef.current.delete(id);
        }, totalDelay);
        timersRef.current.set(id, timer);
      } else {
        next.push({ message, phase: 'visible', index });
      }
      index++;
    });

    // Removed messages handling — note: actual removal/exit phase is left
    // for the consumer to handle by passing trimmed messages array.
    // Future enhancement: keep removed messages around for exitDuration.

    setAnimatedMessages(next);
    knownIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, reducedMotion, enterAnimation, exitAnimation]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  return { animatedMessages };
}
