'use client';

import { useEffect, useRef } from 'react';
import type { OverlayWidgetType } from '../hooks/use-widget-custom-css';

interface Props {
  widget: OverlayWidgetType;
}

/**
 * Chrome DevTools-style element picker for the overlay preview iframe.
 * Listens for OVERLAY_CSS_INSPECTOR_START / STOP messages. When active:
 *   - Shows a crosshair cursor and highlights the hovered element.
 *   - On click: builds a CSS selector path and posts it back as
 *     OVERLAY_CSS_INSPECTOR_PICKED, then auto-exits.
 *
 * The extractor prefers the stable `[data-overlay-widget]` root and walks
 * up from the click target, attaching `tag` or `tag.class` per segment.
 * It filters out CSS-in-JS hashes and Tailwind arbitrary values so the
 * result stays readable.
 */
export function OverlayCssInspector({ widget }: Props) {
  const activeRef = useRef(false);
  const highlightedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const rootSelector = `[data-overlay-widget="${widget}"]`;

    const clearHighlight = () => {
      if (highlightedRef.current) {
        highlightedRef.current.style.outline = '';
        highlightedRef.current.style.outlineOffset = '';
        highlightedRef.current = null;
      }
    };

    const setHighlight = (el: HTMLElement) => {
      if (highlightedRef.current === el) return;
      clearHighlight();
      el.style.outline = '2px solid #3b82f6';
      el.style.outlineOffset = '-2px';
      highlightedRef.current = el;
    };

    const buildSelector = (target: HTMLElement): string => {
      const root = document.querySelector(rootSelector) as HTMLElement | null;
      if (!root) return rootSelector;
      if (target === root) return rootSelector;

      const path: string[] = [];
      let node: HTMLElement | null = target;
      let depth = 0;
      while (node && node !== root && depth < 6) {
        const tag = node.tagName.toLowerCase();
        const stableClass = Array.from(node.classList).find(
          (cls) =>
            cls.length >= 3 &&
            cls.length <= 40 &&
            !/^(css-|sc-|cm-|_)/i.test(cls) &&
            !/^[a-z0-9]{8,}$/i.test(cls) &&
            !/\[|\]|\(|\)/.test(cls),
        );
        path.unshift(stableClass ? `${tag}.${stableClass}` : tag);
        node = node.parentElement;
        depth += 1;
      }
      return `${rootSelector} ${path.join(' > ')}`.trim();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!activeRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && target.nodeType === 1) {
        setHighlight(target);
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const selector = buildSelector(target);
      window.parent?.postMessage(
        { type: 'OVERLAY_CSS_INSPECTOR_PICKED', widget, selector },
        '*',
      );
      stopInspector();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeRef.current && e.key === 'Escape') {
        stopInspector();
      }
    };

    const startInspector = () => {
      if (activeRef.current) return;
      activeRef.current = true;
      document.body.style.cursor = 'crosshair';
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);
    };

    const stopInspector = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      document.body.style.cursor = '';
      clearHighlight();
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.parent?.postMessage(
        { type: 'OVERLAY_CSS_INSPECTOR_STOPPED', widget },
        '*',
      );
    };

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'OVERLAY_CSS_INSPECTOR_START' && data.widget === widget) {
        startInspector();
      } else if (
        data?.type === 'OVERLAY_CSS_INSPECTOR_STOP' &&
        data.widget === widget
      ) {
        stopInspector();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      stopInspector();
      window.removeEventListener('message', handleMessage);
    };
  }, [widget]);

  return null;
}
