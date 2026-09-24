import { useCallback, useState } from 'react';
import type { WidgetCssUpdatedData } from './use-overlay-socket';

export type OverlayWidgetType =
  | 'queue'
  | 'now-playing'
  | 'setlist'
  | 'chatbox'
  | 'lyrics'
  | 'songbook-qr';

export function useWidgetCustomCss(
  widget: OverlayWidgetType,
  initial: string | null | undefined,
) {
  const [override, setOverride] = useState<string | null | undefined>(undefined);
  const css = override !== undefined ? override : (initial ?? null);

  const applyWsUpdate = useCallback(
    (data: WidgetCssUpdatedData) => {
      if (data.widgetType !== widget) return;
      setOverride(data.isEnabled ? (data.customCss ?? null) : null);
    },
    [widget],
  );

  return { css, applyWsUpdate };
}
