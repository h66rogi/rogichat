'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOverlay, overlayKeys } from '@/domains/overlay/hooks/use-overlay';
import { useOverlaySocket } from '@/domains/overlay/hooks/use-overlay-socket';
import { useWidgetCustomCss } from '@/domains/overlay/hooks/use-widget-custom-css';
import { WidgetShell } from '@/domains/overlay/components/WidgetShell';
import { SongbookQrWidget } from '@/domains/overlay/components/songbook-qr/SongbookQrWidget';
import { parsePreviewOptions } from '@/domains/overlay/utils/parse-preview-options';
import { useThemeLoader } from '@/domains/overlay/themes/shared';
import { DEFAULT_FALLBACK_THEME_ID } from '@/domains/overlay/themes/registry';

const WIDGET_TYPE = 'songbook-qr' as const;

export default function SongbookQrWidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const isPreviewMode = searchParams.get('preview') === '1';
  const previewThemeParam =
    searchParams.get('theme') ?? searchParams.get('layout');
  const previewOptions = parsePreviewOptions(searchParams.get('options'));
  const [liveThemeOverride, setLiveThemeOverride] = useState<string | null>(null);
  const [liveResolvedOptions, setLiveResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  const queryClient = useQueryClient();

  const { data: overlayData } = useOverlay(token, {
    enabled: !!token,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { css: customCss, applyWsUpdate: applyWidgetCssUpdate } =
    useWidgetCustomCss(
      WIDGET_TYPE,
      overlayData?.widgetCustomCss?.[WIDGET_TYPE],
    );

  useOverlaySocket(token, {
    widgetType: WIDGET_TYPE,
    enabled: !!token && !isPreviewMode,
    onThemeConfigUpdated: (data) => {
      const nextTheme = data.resolvedThemes?.[WIDGET_TYPE];
      const nextOptions = data.resolvedOptions?.[WIDGET_TYPE];
      if (nextTheme) {
        setLiveThemeOverride(nextTheme);
      }
      if (nextOptions) {
        setLiveResolvedOptions(nextOptions);
      }
      queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
    },
    onWidgetCssUpdated: applyWidgetCssUpdate,
  });

  const apiTheme = overlayData?.resolvedThemes?.[WIDGET_TYPE];
  const requestedThemeId =
    previewThemeParam ??
    liveThemeOverride ??
    apiTheme ??
    DEFAULT_FALLBACK_THEME_ID;
  const { theme: registryTheme } = useThemeLoader(requestedThemeId);
  const mergedThemeOptions = useMemo(() => {
    const apiOptions = overlayData?.resolvedOptions?.[WIDGET_TYPE] ?? {};
    return {
      ...(registryTheme?.defaultOptions ?? {}),
      ...apiOptions,
      ...(liveResolvedOptions ?? {}),
      ...(isPreviewMode && previewOptions ? previewOptions : {}),
    };
  }, [
    registryTheme,
    overlayData,
    liveResolvedOptions,
    isPreviewMode,
    previewOptions,
  ]);

  return (
    <WidgetShell widget={WIDGET_TYPE} customCss={customCss}>
      <SongbookQrWidget
        data={overlayData}
        options={mergedThemeOptions}
        fonts={registryTheme?.fonts}
        themeId={registryTheme?.id ?? requestedThemeId}
      />
    </WidgetShell>
  );
}
