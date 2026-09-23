import { useEffect, useRef, useState, useCallback } from "react";

interface UseIntersectionObserverProps {
  threshold?: number;
  root?: Element | null;
  rootMargin?: string;
  enabled?: boolean;
  triggerOnce?: boolean; // 한 번만 트리거할지 여부
}

export function useIntersectionObserver({
  threshold = 0.1,
  root = null,
  rootMargin = "100px",
  enabled = true,
  triggerOnce = false,
}: UseIntersectionObserverProps = {}) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 디바운싱을 위한 콜백
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      const isCurrentlyIntersecting = entry.isIntersecting;

      if (triggerOnce && hasTriggered) {
        return; // 이미 트리거되었으면 무시
      }

      setIsIntersecting(isCurrentlyIntersecting);

      if (isCurrentlyIntersecting && triggerOnce) {
        setHasTriggered(true);
      }
    },
    [triggerOnce, hasTriggered]
  );

  useEffect(() => {
    if (!enabled || !elementRef.current) {
      setIsIntersecting(false);
      return;
    }

    // 기존 옵저버 정리
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(handleIntersection, {
      threshold,
      root,
      rootMargin,
    });

    observerRef.current.observe(elementRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [threshold, root, rootMargin, enabled, handleIntersection]);

  // Reset 함수 제공
  const reset = useCallback(() => {
    setIsIntersecting(false);
    setHasTriggered(false);
  }, []);

  return { elementRef, isIntersecting, reset };
}
