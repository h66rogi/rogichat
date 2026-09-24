import { useEffect, useRef, useState } from 'react';
import type { AnimationDef } from '../types';

interface QueueItemWithAnimation<T> {
  item: T;
  phase: 'entering' | 'visible' | 'exiting';
  index: number;
}

interface UseQueueAnimationOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  addAnimation: AnimationDef | undefined;
  removeAnimation: AnimationDef | undefined;
  reducedMotion: boolean;
}

interface UseQueueAnimationResult<T> {
  animatedItems: QueueItemWithAnimation<T>[];
}

/**
 * Same shape as useChatAnimation but for queue lists.
 * Tracks add/remove and applies enter/exit animations with stagger.
 */
export function useQueueAnimation<T>(
  options: UseQueueAnimationOptions<T>
): UseQueueAnimationResult<T> {
  const { items, getItemId, addAnimation, reducedMotion } = options;
  const [animatedItems, setAnimatedItems] = useState<QueueItemWithAnimation<T>[]>([]);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const currentIds = new Set(items.map(getItemId));

    if (reducedMotion || !addAnimation) {
      setAnimatedItems(items.map((item, index) => ({ item, phase: 'visible' as const, index })));
      knownIdsRef.current = currentIds;
      return;
    }

    const next: QueueItemWithAnimation<T>[] = items.map((item, index) => {
      const id = getItemId(item);
      const isNew = !knownIdsRef.current.has(id);
      if (isNew) {
        const stagger = addAnimation.stagger ?? 0;
        const totalDelay = addAnimation.enterDuration + stagger * index;

        const existing = timersRef.current.get(id);
        if (existing) window.clearTimeout(existing);

        const timer = window.setTimeout(() => {
          setAnimatedItems((prev) =>
            prev.map((it) =>
              getItemId(it.item) === id ? { ...it, phase: 'visible' as const } : it
            )
          );
          timersRef.current.delete(id);
        }, totalDelay);
        timersRef.current.set(id, timer);

        return { item, phase: 'entering' as const, index };
      }
      return { item, phase: 'visible' as const, index };
    });

    setAnimatedItems(next);
    knownIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, reducedMotion, addAnimation]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  return { animatedItems };
}
