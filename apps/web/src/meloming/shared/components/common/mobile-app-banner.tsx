"use client";

import { useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight, X } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import Image from "next/image";
import { useInAppMode } from "@/meloming/shared/hooks/use-inapp-mode";

type Platform = "android" | "ios" | null;
const DISMISS_STORAGE_KEY = "mobile-app-banner-dismiss-until";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return null;

  const ua = navigator.userAgent.toLowerCase();

  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";

  return null;
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

export function MobileAppBanner() {
  const pathname = usePathname();
  const isInApp = useInAppMode();

  // SSR + hydration 첫 render 시점은 모두 false 로 고정해 React #418 hydration mismatch 방지.
  // navigator / localStorage 같은 brouser-only API 는 useEffect 안에서만 호출하고 그 결과를 state 에 commit 한다.
  // 이 컴포넌트가 (default)/layout 의 children 으로 매 페이지에 mount 되므로 mismatch 발생 시 전체 페이지가
  // app/error.tsx ("일시 오류") 로 떨어짐.
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPlatform(detectPlatform());
    setIsMobile(isMobileDevice());

    const stored = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (stored) {
      const parsed = Number.parseInt(stored, 10);
      if (!Number.isNaN(parsed) && Date.now() < parsed) {
        setIsDismissed(true);
      }
    }
  }, []);

  const isVisible = mounted && !!platform && !isInApp && isMobile && !isDismissed;

  const handleDismiss = useCallback(() => {
    const dismissUntil = Date.now() + DISMISS_DURATION_MS;
    localStorage.setItem(DISMISS_STORAGE_KEY, dismissUntil.toString());
    setIsDismissed(true);
  }, []);

  const handleOpenApp = useCallback(() => {
    const platform = detectPlatform();
    if (!platform) return;

    // 앱 패키지/스토어 정보
    const ANDROID_PACKAGE = "com.meloming.android";
    const IOS_APP_ID = "6670341066"; // App Store ID

    // Deep link path 구성
    let deepLinkPath = "";

    // 채널 페이지인 경우
    const channelMatch = pathname.match(/^\/channel\/([^/]+)/);
    if (channelMatch) {
      deepLinkPath = `channel/${channelMatch[1]}`;
    }

    // 콘텐츠 페이지인 경우
    const contentMatch = pathname.match(/^\/content\/(\d+)/);
    if (contentMatch) {
      deepLinkPath = `content/${contentMatch[1]}`;
    }

    if (platform === "android") {
      // Android: Intent URL 사용 (더 안정적)
      const playStoreUrl = `market://details?id=${ANDROID_PACKAGE}`;
      const webFallbackUrl = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

      if (deepLinkPath) {
        // 특정 딥링크가 있는 경우 (channel/content)
        // Intent URL: intent://HOST/PATH#Intent;scheme=SCHEME;package=PACKAGE;S.browser_fallback_url=URL;end
        const intentUrl = `intent://${deepLinkPath}#Intent;scheme=meloming;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(webFallbackUrl)};end`;
        window.location.href = intentUrl;

        // Intent가 실패할 경우를 대비한 fallback
        setTimeout(() => {
          if (!document.hidden) {
            window.location.href = playStoreUrl;
          }
        }, 1000);
      } else {
        // 딥링크가 없는 일반 페이지 - Play Store로 바로 이동
        // Play Store에서 "열기" 버튼으로 앱 실행 가능
        window.location.href = playStoreUrl;
      }
    } else {
      // iOS: Universal Links 또는 Custom Scheme 사용
      const deepLink = deepLinkPath
        ? `meloming://${deepLinkPath}`
        : "meloming://";
      const appStoreUrl = `https://apps.apple.com/app/id${IOS_APP_ID}`;

      // visibility change 감지
      let appOpened = false;

      const onVisibilityChange = () => {
        if (document.hidden) {
          appOpened = true;
        }
      };

      document.addEventListener("visibilitychange", onVisibilityChange);

      // 앱 열기 시도
      window.location.href = deepLink;

      // 타임아웃 후 스토어로 이동
      setTimeout(() => {
        document.removeEventListener("visibilitychange", onVisibilityChange);

        if (!appOpened && !document.hidden) {
          window.location.href = appStoreUrl;
        }
      }, 1500);
    }
  }, [pathname]);

  if (!isVisible) return null;

  return (
    <div className="pointer-events-none fixed bottom-[var(--floating-stack-bottom)] left-0 right-0 z-[80] p-3 pb-[var(--floating-app-banner-padding-bottom)]">
      <div className="pointer-events-auto bg-background/80 backdrop-blur-xl border-2 border-indigo-500/50 rounded-2xl shadow-2xl shadow-indigo-500/20">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            {/* 앱 아이콘 */}
            <div className="shrink-0">
              <div className="w-11 h-11 rounded-xl overflow-hidden shadow-md border border-indigo-500/30">
                <Image
                  src="/logo/meloming-logo-512.png"
                  alt="멜로밍"
                  width={44}
                  height={44}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* 텍스트 */}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm paperlogy truncate">
                멜로밍 앱
              </div>
              <div className="text-xs text-muted-foreground truncate">
                앱에서 더 편하게 이용하세요
              </div>
            </div>

            {/* 버튼 */}
            <div className="shrink-0 flex items-center gap-1">
              <Button
                size="sm"
                variant="indigo"
                onClick={handleOpenApp}
                className="font-semibold px-4 gap-1"
              >
                앱 열기
                <ArrowUpRight className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleDismiss}
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">배너 닫기</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
