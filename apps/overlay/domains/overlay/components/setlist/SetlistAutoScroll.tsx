'use client';

import { useRef, useEffect, useState, type ReactNode } from 'react';

interface SetlistAutoScrollProps {
  threshold: number;
  children: ReactNode;
  className?: string;
}

export function SetlistAutoScroll({ threshold, children, className }: SetlistAutoScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsScroll, setNeedsScroll] = useState(false);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      setNeedsScroll(content.scrollHeight > threshold);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [threshold]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !needsScroll) return;

    let animationId: number;
    let direction = 1;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    const speed = 0.5;

    const scroll = () => {
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll <= 0) return;

      container.scrollTop += speed * direction;

      if (container.scrollTop >= maxScroll) {
        direction = 0;
        pauseTimer = setTimeout(() => {
          direction = -1;
          animationId = requestAnimationFrame(scroll);
        }, 3000);
        return;
      }
      if (container.scrollTop <= 0 && direction === -1) {
        direction = 0;
        pauseTimer = setTimeout(() => {
          direction = 1;
          animationId = requestAnimationFrame(scroll);
        }, 3000);
        return;
      }

      animationId = requestAnimationFrame(scroll);
    };

    animationId = requestAnimationFrame(scroll);
    return () => {
      cancelAnimationFrame(animationId);
      if (pauseTimer) clearTimeout(pauseTimer);
    };
  }, [needsScroll]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-overlay-scroll
      style={needsScroll ? { maxHeight: threshold, overflow: 'hidden' } : undefined}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
