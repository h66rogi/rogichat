'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOverlay, overlayKeys } from '@/domains/overlay/hooks/use-overlay';
import { useOverlaySocket } from '@/domains/overlay/hooks/use-overlay-socket';
import { useWidgetCustomCss } from '@/domains/overlay/hooks/use-widget-custom-css';
import { WidgetShell } from '@/domains/overlay/components/WidgetShell';
import { TextStrokeWrapper } from '@/domains/overlay/components/TextStrokeWrapper';
import type { OverlayChatEvent } from '@/domains/overlay/types/chat';
import { parsePreviewOptions } from '@/domains/overlay/utils/parse-preview-options';
import {
  useReducedMotion,
  useThemeLoader,
} from '@/domains/overlay/themes/shared';
import { DEFAULT_FALLBACK_THEME_ID } from '@/domains/overlay/themes/registry';
import type { OverlayData } from '@/domains/overlay/types/overlay';

const WIDGET_TYPE = 'chatbox' as const;

const DEFAULT_MAX_MESSAGES = 50;

export default function ChatboxWidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const isPreviewMode = searchParams.get('preview') === '1';
  // Accept both ?theme= (new) and ?layout= (legacy back-compat) preview params.
  const previewThemeParam =
    searchParams.get('theme') ?? searchParams.get('layout');
  const previewOptions = parsePreviewOptions(searchParams.get('options'));

  // Live theme override — set by WS `theme-config.updated` events when the user
  // saves settings. Beats `apiTheme` (REST snapshot) for immediate updates.
  const [liveThemeOverride, setLiveThemeOverride] = useState<string | null>(null);
  const [liveResolvedOptions, setLiveResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  const [messages, setMessages] = useState<OverlayChatEvent[]>([]);

  // React Query client for invalidating overlay data after a live theme save.
  const queryClient = useQueryClient();

  const { data: overlayData, error: overlayError } = useOverlay(token, {
    enabled: !!token,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { css: customCss, applyWsUpdate: applyWidgetCssUpdate } = useWidgetCustomCss(
    'chatbox',
    overlayData?.widgetCustomCss?.['chatbox'],
  );

  const appendMessage = (nextMessage: OverlayChatEvent) => {
    setMessages((prev) => {
      const raw =
        (isPreviewMode && previewOptions
          ? (previewOptions as Record<string, unknown>).maxMessages
          : undefined) ??
        liveResolvedOptions?.maxMessages ??
        overlayData?.resolvedOptions?.[WIDGET_TYPE]?.maxMessages;
      const parsed = Number(raw);
      const maxMessages =
        Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_MESSAGES;
      const next = [...prev.filter((item) => item.id !== nextMessage.id), nextMessage];
      return next.slice(-maxMessages);
    });
  };

  const { connectionStatus } = useOverlaySocket(token, {
    widgetType: 'chat',
    enabled: !!token && !isPreviewMode,
    onChatMessage: appendMessage,
    onDonation: appendMessage,
    onThemeConfigUpdated: (data) => {
      // 통합 테마 이벤트: resolvedThemes + resolvedOptions를 모두 반영.
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
    onSessionEnded: () => setMessages([]),
  });

  // === Theme resolution ===
  // Priority: preview URL param > WS live override > REST resolvedThemes > DEFAULT.
  const apiTheme = overlayData?.resolvedThemes?.[WIDGET_TYPE];
  const requestedThemeId =
    previewThemeParam ??
    liveThemeOverride ??
    apiTheme ??
    DEFAULT_FALLBACK_THEME_ID;
  const reducedMotion = useReducedMotion();
  const { theme: registryTheme } = useThemeLoader(requestedThemeId);

  // Merge theme options: catalog defaults ← API resolvedOptions ← live WS override ← preview URL.
  const mergedThemeOptions = useMemo(() => {
    const apiOptions = overlayData?.resolvedOptions?.[WIDGET_TYPE] ?? {};
    return {
      ...(registryTheme?.defaultOptions ?? {}),
      ...apiOptions,
      ...(liveResolvedOptions ?? {}),
      ...(isPreviewMode && previewOptions ? previewOptions : {}),
    };
  }, [registryTheme, overlayData, liveResolvedOptions, isPreviewMode, previewOptions]);

  // Theme is still loading → transparent placeholder (avoids flicker).
  if (!registryTheme) {
    return <WidgetShell widget="chatbox" customCss={customCss} />;
  }

  const ThemeWidget = registryTheme.widgets[WIDGET_TYPE];
  if (!ThemeWidget) {
    return <WidgetShell widget="chatbox" customCss={customCss} />;
  }

  return (
    <WidgetShell widget="chatbox" customCss={customCss}>
      <TextStrokeWrapper options={mergedThemeOptions}>
        <ThemeWidget
          key={registryTheme.id}
          data={(overlayData ?? {}) as OverlayData}
          options={mergedThemeOptions}
          animations={registryTheme.animations}
          fonts={registryTheme.fonts}
          reducedMotion={reducedMotion}
          connectionStatus={connectionStatus}
          chatMessages={messages}
        />
      </TextStrokeWrapper>
    </WidgetShell>
  );
}
