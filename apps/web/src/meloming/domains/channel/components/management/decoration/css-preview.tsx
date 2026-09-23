"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Monitor,
  RefreshCw,
  ExternalLink,
  Maximize2,
  Crosshair,
  Copy,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { cn } from "@/meloming/shared/lib/utils";
import Link from "next/link";
import type { ChannelCustomizationColorMode } from "@/meloming/domains/channel/types/customization";
import {
  DevicePreviewModal,
  setupIframeNavigation,
  type DeviceType,
} from "./device-preview-modal";

interface CssPreviewProps {
  webPath: string;
  css: string;
  colorMode?: ChannelCustomizationColorMode | null;
  className?: string;
  /** 요소 선택기 활성 상태 (부모가 관리) */
  inspectorActive?: boolean;
  /** "요소 선택" 버튼 토글 */
  onInspectorToggle?: () => void;
  /** 사용자가 요소를 선택했거나 ESC로 취소했을 때 호출 */
  onInspectorResult?: (result: { selector: string } | null) => void;
  /** 직전에 선택된 셀렉터 (있으면 툴바 아래 pill로 노출) */
  pickedSelector?: string | null;
  /** "에디터에 삽입" 버튼 클릭 시 호출 */
  onInsertSelector?: (selector: string) => void;
  /** 선택자 pill을 닫을 때 호출 */
  onClearPickedSelector?: () => void;
}

/**
 * 채널 페이지 미리보기 컴포넌트
 * - postMessage로 CSS 실시간 반영 (새로고침 없음)
 * - 다른 비율로 보기: 디바이스별 미리보기 모달
 */
export function CssPreview({
  webPath,
  css,
  colorMode,
  className,
  inspectorActive = false,
  onInspectorToggle,
  onInspectorResult,
  pickedSelector,
  onInsertSelector,
  onClearPickedSelector,
}: CssPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDevice, setModalDevice] = useState<DeviceType>("desktop");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const channelUrl = `/channel/${webPath}?cssPreview=true`;
  const channelPathPrefix = `/channel/${webPath}`;

  // postMessage로 CSS 전송
  const sendCssToIframe = useCallback(
    (cssCode: string, mode?: ChannelCustomizationColorMode | null) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      iframe.contentWindow.postMessage(
        { type: "CSS_PREVIEW_UPDATE", css: cssCode, forcedColorMode: mode },
        window.location.origin
      );
    },
    []
  );

  // iframe에서 준비 완료 / 인스펙터 결과 메시지 수신
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // origin + source + schema 검증 (same-origin 스푸핑 방지)
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") {
        return;
      }

      if (data.type === "CSS_PREVIEW_READY") {
        setIsPreviewReady(true);
        // 준비되면 현재 CSS 전송
        sendCssToIframe(css, colorMode);
      } else if (data.type === "CHANNEL_CSS_INSPECTOR_PICKED") {
        if (typeof data.selector === "string") {
          onInspectorResult?.({ selector: data.selector });
        }
      } else if (data.type === "CHANNEL_CSS_INSPECTOR_STOPPED") {
        onInspectorResult?.(null);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [css, colorMode, sendCssToIframe, onInspectorResult]);

  // 인스펙터 활성 상태를 iframe으로 전달 (START/STOP)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !isPreviewReady) return;

    iframe.contentWindow.postMessage(
      {
        type: inspectorActive
          ? "CHANNEL_CSS_INSPECTOR_START"
          : "CHANNEL_CSS_INSPECTOR_STOP",
      },
      window.location.origin
    );
  }, [inspectorActive, isPreviewReady]);

  // CSS 변경 시 postMessage로 전송
  useEffect(() => {
    if (isPreviewReady) {
      sendCssToIframe(css, colorMode);
    }
  }, [css, colorMode, isPreviewReady, sendCssToIframe]);

  // iframe 로드 시 네비게이션 설정
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      setIsLoading(false);
      setIsPreviewReady(false); // 로드될 때마다 리셋, 리스너에서 다시 설정
      setupIframeNavigation(iframe, css, channelPathPrefix, channelUrl);
    };

    iframe.addEventListener("load", handleLoad);

    return () => {
      iframe.removeEventListener("load", handleLoad);
      const storedIframe = iframe as HTMLIFrameElement & {
        _urlCheckInterval?: NodeJS.Timeout;
      };
      if (storedIframe._urlCheckInterval) {
        clearInterval(storedIframe._urlCheckInterval);
      }
    };
  }, [css, channelPathPrefix, channelUrl]);

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const handleRefresh = () => {
    setIsLoading(true);
    setIsPreviewReady(false);
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <>
      <div className={cn("flex flex-col h-full", className)}>
        {/* 상단 툴바 */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Monitor className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">미리보기</span>
          </div>

          <div className="flex items-center gap-2">
            {/* 요소 선택기 토글 */}
            {onInspectorToggle && (
              <Button
                variant={inspectorActive ? "default" : "outline"}
                size="sm"
                onClick={onInspectorToggle}
                className="h-8 gap-1.5"
              >
                <Crosshair className="size-4" />
                <span className="hidden sm:inline">
                  {inspectorActive ? "선택 중… (ESC)" : "요소 선택"}
                </span>
              </Button>
            )}
            {/* 다른 비율로 보기 버튼 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(true)}
              className="h-8 gap-1.5"
            >
              <Maximize2 className="size-4" />
              <span className="hidden sm:inline">다른 비율로 보기</span>
            </Button>
            {/* 새로고침 버튼 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="h-8 px-2"
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("size-4", isLoading && "animate-spin")}
              />
            </Button>
            {/* 새 탭에서 열기 */}
            <Button variant="ghost" size="sm" asChild className="h-8 px-2">
              <Link href={channelUrl} target="_blank">
                <ExternalLink className="size-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* 선택된 셀렉터 pill */}
        {pickedSelector && (
          <div className="flex items-center gap-2 px-4 py-2 border-b bg-indigo-500/5">
            <span className="text-xs text-muted-foreground shrink-0">선택됨:</span>
            <code className="text-xs bg-background border px-2 py-1 rounded truncate flex-1 min-w-0">
              {pickedSelector}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pickedSelector);
                  toast.success("셀렉터를 복사했습니다.");
                } catch {
                  toast.error("복사에 실패했습니다.");
                }
              }}
            >
              <Copy className="size-4" />
              <span className="hidden md:inline">복사</span>
            </Button>
            {onInsertSelector && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                onClick={() => onInsertSelector(pickedSelector)}
              >
                <Plus className="size-4" />
                <span className="hidden md:inline">에디터에 삽입</span>
              </Button>
            )}
            {onClearPickedSelector && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onClearPickedSelector}
                aria-label="선택자 지우기"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        )}

        {/* 메인 미리보기 영역 (데스크탑 반응형) */}
        <div className="flex-1 overflow-auto bg-muted/20">
          <div className="relative bg-background overflow-hidden h-full">
            {isLoading && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-2">
                  <RefreshCw className="size-6 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    로딩 중...
                  </span>
                </div>
              </div>
            )}

            <iframe
              ref={iframeRef}
              key={refreshKey}
              src={channelUrl}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              title="채널 미리보기"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />
          </div>
        </div>
      </div>

      {/* 디바이스별 미리보기 모달 */}
      <DevicePreviewModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        device={modalDevice}
        onDeviceChange={setModalDevice}
        webPath={webPath}
        css={css}
        colorMode={colorMode}
      />
    </>
  );
}
