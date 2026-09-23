"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/meloming/shared/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import type { ChannelCustomizationColorMode } from "@/meloming/domains/channel/types/customization";

export type DeviceType = "desktop" | "tablet" | "mobile" | "fold";

export const DEVICE_CONFIG: Record<
  DeviceType,
  {
    width: number;
    height: number;
    label: string;
    icon: typeof Monitor;
  }
> = {
  desktop: {
    width: 1920,
    height: 1080,
    label: "Desktop (FHD)",
    icon: Monitor,
  },
  tablet: {
    width: 820,
    height: 1180,
    label: "Tablet (iPad)",
    icon: Tablet,
  },
  mobile: {
    width: 390,
    height: 844,
    label: "Mobile (iPhone)",
    icon: Smartphone,
  },
  fold: {
    width: 882,
    height: 786,
    label: "Galaxy Fold (펼침)",
    icon: Smartphone,
  },
};

// iframe 설정 함수 (네비게이션 차단만 담당, CSS는 postMessage로 처리)
export function setupIframeNavigation(
  iframe: HTMLIFrameElement,
  _cssContent: string, // 더 이상 사용하지 않지만 호환성 유지
  pathPrefix: string,
  url: string
) {
  const isChannelPage = () => {
    try {
      const iframeLocation = iframe.contentWindow?.location;
      if (!iframeLocation) return false;
      return iframeLocation.pathname.startsWith(pathPrefix);
    } catch {
      return false;
    }
  };

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    // 채널 페이지가 아니면 리다이렉트
    if (!isChannelPage()) {
      iframe.src = url;
      return;
    }

    // CSS 주입은 postMessage로 처리됨 (ChannelCustomCss 컴포넌트에서)

    const iframeWindow = iframe.contentWindow;
    if (!iframeWindow) return;

    // 클릭 이벤트 차단 (채널 내부 링크만 허용)
    iframeDoc.addEventListener(
      "click",
      (e) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest("a");

        if (anchor) {
          const href = anchor.getAttribute("href");

          // 앵커 링크는 허용
          if (href && href.startsWith("#")) return;

          // 채널 내부 링크 허용
          if (href && href.startsWith(pathPrefix)) {
            if (!href.includes("cssPreview=true")) {
              e.preventDefault();
              const separator = href.includes("?") ? "&" : "?";
              iframeWindow.location.href = `${href}${separator}cssPreview=true`;
            }
            return;
          }

          // 상대 경로 채널 내부 링크 허용
          if (
            href &&
            !href.startsWith("/") &&
            !href.startsWith("http") &&
            !href.startsWith("mailto:")
          ) {
            e.preventDefault();
            iframeWindow.location.href = `${pathPrefix}/${href}?cssPreview=true`;
            return;
          }

          // 외부 링크 차단
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      true
    );

    // 폼 제출 차단
    iframeDoc.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );

    // History API 오버라이드
    const originalPushState = iframeWindow.history.pushState.bind(
      iframeWindow.history
    );
    const originalReplaceState = iframeWindow.history.replaceState.bind(
      iframeWindow.history
    );

    const addCssPreviewParam = (urlStr: string): string => {
      if (urlStr.includes("cssPreview=true")) return urlStr;
      const separator = urlStr.includes("?") ? "&" : "?";
      return `${urlStr}${separator}cssPreview=true`;
    };

    iframeWindow.history.pushState = function (
      state: unknown,
      title: string,
      urlParam?: string | URL | null
    ) {
      if (urlParam) {
        const urlStr = urlParam.toString();
        if (!urlStr.startsWith(pathPrefix)) return;
        return originalPushState(state, title, addCssPreviewParam(urlStr));
      }
      return originalPushState(state, title, urlParam);
    };

    iframeWindow.history.replaceState = function (
      state: unknown,
      title: string,
      urlParam?: string | URL | null
    ) {
      if (urlParam) {
        const urlStr = urlParam.toString();
        if (!urlStr.startsWith(pathPrefix)) return;
        return originalReplaceState(state, title, addCssPreviewParam(urlStr));
      }
      return originalReplaceState(state, title, urlParam);
    };

    // popstate 감시
    iframeWindow.addEventListener("popstate", () => {
      if (!isChannelPage()) {
        iframe.src = url;
      }
    });

    // 주기적 URL 체크 (fallback)
    const urlCheckInterval = setInterval(() => {
      if (!isChannelPage()) {
        iframe.src = url;
      }
    }, 500);

    (
      iframe as HTMLIFrameElement & { _urlCheckInterval?: NodeJS.Timeout }
    )._urlCheckInterval = urlCheckInterval;
  } catch (error) {
    console.warn("iframe 설정 실패:", error);
  }
}

interface DevicePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: DeviceType;
  onDeviceChange: (device: DeviceType) => void;
  webPath: string;
  css: string;
  colorMode?: ChannelCustomizationColorMode | null;
}

/**
 * 디바이스별 미리보기 모달
 * - 디바이스 비율에 맞게 모달 크기 자동 조정
 * - 스케일 조절 슬라이더
 * - 실시간 CSS 반영
 * - 채널 외부 이동 차단
 */
export function DevicePreviewModal({
  open,
  onOpenChange,
  device,
  onDeviceChange,
  webPath,
  css,
  colorMode,
}: DevicePreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [isPreviewReady, setIsPreviewReady] = useState(false);

  const channelUrl = `/channel/${webPath}?cssPreview=true`;
  const channelPathPrefix = `/channel/${webPath}`;

  const currentDevice = DEVICE_CONFIG[device];

  // 뷰포트 크기 측정
  const [viewportSize, setViewportSize] = useState({
    width: 1200,
    height: 800,
  });

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

  // iframe에서 준비 완료 메시지 수신
  useEffect(() => {
    if (!open) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === "CSS_PREVIEW_READY") {
        setIsPreviewReady(true);
        sendCssToIframe(css, colorMode);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open, css, colorMode, sendCssToIframe]);

  // CSS 변경 시 postMessage로 전송
  useEffect(() => {
    if (isPreviewReady && open) {
      sendCssToIframe(css, colorMode);
    }
  }, [css, colorMode, isPreviewReady, open, sendCssToIframe]);

  useEffect(() => {
    if (!open) return;

    const updateSize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);

    return () => {
      window.removeEventListener("resize", updateSize);
    };
  }, [open]);

  // 자동 스케일 계산 (뷰포트 기준)
  const scale = useMemo(() => {
    const headerHeight = 100;
    const padding = 80;

    // 최대 사용 가능한 공간 (뷰포트의 95%)
    const maxAvailableWidth = viewportSize.width * 0.95 - padding;
    const maxAvailableHeight =
      viewportSize.height * 0.95 - headerHeight - padding;

    const scaleX = maxAvailableWidth / currentDevice.width;
    const scaleY = maxAvailableHeight / currentDevice.height;

    return Math.min(scaleX, scaleY, 1);
  }, [viewportSize, currentDevice]);

  // iframe 로드 핸들러
  const handleIframeLoad = useCallback(() => {
    setIframeLoaded(true);
    setIsPreviewReady(false); // 로드 시 리셋
    const iframe = iframeRef.current;
    if (iframe) {
      setupIframeNavigation(iframe, css, channelPathPrefix, channelUrl);
    }
  }, [css, channelPathPrefix, channelUrl]);

  // 디바이스 변경 핸들러
  const handleDeviceChange = useCallback(
    (newDevice: DeviceType) => {
      setIframeLoaded(false);
      setIsPreviewReady(false);
      onDeviceChange(newDevice);
    },
    [onDeviceChange]
  );

  // 모달 크기 계산 (스케일에 맞춤)
  const HEADER_HEIGHT = 100; // 헤더 + 탭 높이
  const PADDING = 48; // 상하좌우 패딩
  const MIN_MODAL_WIDTH = 580; // 4개 탭이 스크롤 없이 보이는 최소 너비
  const MIN_MODAL_HEIGHT = 450;

  const modalWidth = Math.max(
    currentDevice.width * scale + PADDING,
    MIN_MODAL_WIDTH
  );
  const modalHeight = Math.max(
    currentDevice.height * scale + HEADER_HEIGHT + PADDING,
    MIN_MODAL_HEIGHT
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 flex flex-col overflow-hidden transition-all duration-200"
        style={{
          width: modalWidth,
          maxWidth: "95vw",
          height: modalHeight,
          maxHeight: "95vh",
        }}
      >
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          {/* 제목 */}
          <DialogTitle className="text-base">디바이스별 미리보기</DialogTitle>

          {/* 디바이스 탭 */}
          <div className="pt-2">
            <Tabs
              value={device}
              onValueChange={(v) => handleDeviceChange(v as DeviceType)}
            >
              <TabsList className="h-9 w-full flex">
                {(
                  Object.entries(DEVICE_CONFIG) as [
                    DeviceType,
                    (typeof DEVICE_CONFIG)[DeviceType]
                  ][]
                ).map(([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className="h-8 flex-1 px-2 gap-1"
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="text-xs whitespace-nowrap hidden sm:inline">
                        {config.label}
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>
        </DialogHeader>

        {/* 디바이스 미리보기 영역 */}
        <div className="flex-1 flex items-center justify-center bg-muted/30 overflow-auto p-4">
          {/* 스케일 적용 wrapper */}
          <div
            style={{
              width: currentDevice.width * scale,
              height: currentDevice.height * scale,
              minWidth: currentDevice.width * scale,
              minHeight: currentDevice.height * scale,
            }}
          >
            <div
              className="relative bg-background rounded-xl border-[6px] border-gray-800 shadow-2xl overflow-hidden"
              style={{
                width: currentDevice.width,
                height: currentDevice.height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <iframe
                ref={iframeRef}
                key={`modal-${device}`}
                src={channelUrl}
                className="w-full h-full border-0"
                onLoad={handleIframeLoad}
                title={`채널 미리보기 - ${currentDevice.label}`}
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
