'use client';

import { useEffect } from 'react';
import type { OverlayWidgetType } from '../hooks/use-widget-custom-css';

interface Props {
  widget: OverlayWidgetType;
  css: string | null;
}

export function CustomCssInjector({ widget, css }: Props) {
  useEffect(() => {
    const id = `overlay-widget-custom-css-${widget}`;
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    if (!css || !css.trim()) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);

    return () => {
      // Only remove the specific element we appended (not whatever currently
      // has this id, which may be a newer instance after rapid re-renders).
      style.remove();
    };
  }, [widget, css]);

  return null;
}
