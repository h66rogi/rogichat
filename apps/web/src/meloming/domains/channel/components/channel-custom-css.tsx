"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  normalizeChannelColorMode,
  type ChannelCustomizationColorMode,
} from "@/meloming/domains/channel/types/customization";

const CHANNEL_CSS_ID = "channel-custom-css";
const PREVIEW_CSS_ID = "preview-custom-css";
const CHANNEL_THEME_CLASS = "channel-theme-active";
const FORCE_COLOR_MODE_STYLE_ID = "channel-force-color-mode";

interface ChannelCustomCssPreviewProps {
  forcedColorMode?: ChannelCustomizationColorMode | null;
}

// postMessage 타입
interface CssPreviewMessage {
  type: "CSS_PREVIEW_UPDATE";
  css: string;
  forcedColorMode?: ChannelCustomizationColorMode | null;
}

/**
 * 채널 커스텀 CSS Preview 모드 컴포넌트
 *
 * 일반 모드:
 * - 서버에서 이미 <style> 태그가 렌더링되어 있음 (ChannelLayout에서 처리)
 * - body에 channel-theme-active 클래스를 추가하여 body 선택자 CSS도 작동하도록 함
 *
 * Preview 모드 (cssPreview=true):
 * - 서버에서 렌더링된 CSS를 제거하고 postMessage로 받은 CSS를 적용
 * - 편집기에서 실시간 미리보기를 위해 사용
 */
export function ChannelCustomCssPreview({
  forcedColorMode,
}: ChannelCustomCssPreviewProps) {
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const originalThemeRef = useRef<"dark" | "light" | null>(null);

  const resolveColorMode = useCallback(
    (mode?: ChannelCustomizationColorMode | null) =>
      normalizeChannelColorMode(mode ?? forcedColorMode),
    [forcedColorMode]
  );

  const restoreOriginalTheme = useCallback(() => {
    const html = document.documentElement;

    const forceStyle = document.getElementById(FORCE_COLOR_MODE_STYLE_ID);
    if (forceStyle) {
      forceStyle.remove();
    }

    if (originalThemeRef.current === "dark") {
      html.classList.add("dark");
    }
    if (originalThemeRef.current === "light") {
      html.classList.remove("dark");
    }

    originalThemeRef.current = null;
  }, []);

  const applyColorMode = useCallback(
    (mode?: ChannelCustomizationColorMode | null) => {
      const html = document.documentElement;
      const normalizedMode = resolveColorMode(mode);

      if (normalizedMode === "system") {
        restoreOriginalTheme();
        return;
      }

      if (originalThemeRef.current === null) {
        originalThemeRef.current = html.classList.contains("dark")
          ? "dark"
          : "light";
      }

      if (normalizedMode === "dark") {
        html.classList.add("dark");
      } else {
        html.classList.remove("dark");
      }

      let forceStyle = document.getElementById(FORCE_COLOR_MODE_STYLE_ID);
      if (!forceStyle) {
        forceStyle = document.createElement("style");
        forceStyle.id = FORCE_COLOR_MODE_STYLE_ID;
        document.head.appendChild(forceStyle);
      }

      forceStyle.textContent =
        normalizedMode === "dark"
          ? `
        /* 커스텀 CSS 활성화 시 다크모드 강제 */
        :root {
          color-scheme: dark !important;
        }
        /* 라이트모드 미디어쿼리 무시 */
        @media (prefers-color-scheme: light) {
          :root {
            color-scheme: dark !important;
          }
        }
      `
          : `
        /* 커스텀 CSS 활성화 시 라이트모드 강제 */
        :root {
          color-scheme: light !important;
        }
        /* 다크모드 미디어쿼리 무시 */
        @media (prefers-color-scheme: dark) {
          :root {
            color-scheme: light !important;
          }
        }
      `;
    },
    [resolveColorMode, restoreOriginalTheme]
  );

  // CSS 주입 함수
  const injectPreviewCss = useCallback(
    (css: string, mode?: ChannelCustomizationColorMode | null) => {
      // 기존 미리보기 스타일 제거
      const existingStyle = document.getElementById(PREVIEW_CSS_ID);
      if (existingStyle) {
        existingStyle.remove();
      }

      if (css.trim()) {
        // 새 스타일 주입
        const styleElement = document.createElement("style");
        styleElement.id = PREVIEW_CSS_ID;
        styleElement.textContent = css;
        document.head.appendChild(styleElement);
        document.body.classList.add(CHANNEL_THEME_CLASS);
        // 커스텀 CSS 활성화 시 색상 모드 강제
        applyColorMode(mode);
      } else {
        document.body.classList.remove(CHANNEL_THEME_CLASS);
        // 커스텀 CSS 비활성화 시 원래 테마 복원
        restoreOriginalTheme();
      }
    },
    [applyColorMode, restoreOriginalTheme]
  );

  // 클라이언트 마운트 후 모드 체크 및 body 클래스 관리
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isPreview = urlParams.get("cssPreview") === "true";
    setIsPreviewMode(isPreview);

    if (isPreview) {
      // Preview 모드: 서버에서 렌더링된 CSS를 제거 (postMessage로 받은 CSS 사용)
      const serverStyle = document.getElementById(CHANNEL_CSS_ID);
      if (serverStyle) {
        serverStyle.remove();
      }
    } else {
      // 일반 모드: 서버에서 렌더링된 CSS가 있으면 body에 클래스 추가
      // body.channel-theme-active 선택자를 사용한 CSS가 작동하도록 함
      const serverStyle = document.getElementById(CHANNEL_CSS_ID);
      if (serverStyle && serverStyle.textContent?.trim()) {
        document.body.classList.add(CHANNEL_THEME_CLASS);
        // 커스텀 CSS 활성화 시 색상 모드 강제
        applyColorMode();
      }
    }

    // 클린업: 페이지 이탈 시 body 클래스 제거 및 원래 테마 복원
    return () => {
      document.body.classList.remove(CHANNEL_THEME_CLASS);
      restoreOriginalTheme();
    };
  }, [applyColorMode, restoreOriginalTheme]);

  // 미리보기 모드일 때 postMessage 리스너 설정
  useEffect(() => {
    if (!isPreviewMode) return;

    const handleMessage = (event: MessageEvent<CssPreviewMessage>) => {
      // 같은 origin에서 온 메시지만 처리
      if (event.origin !== window.location.origin) return;

      // CSS 업데이트 메시지 처리
      if (event.data?.type === "CSS_PREVIEW_UPDATE") {
        injectPreviewCss(event.data.css, event.data.forcedColorMode);
      }
    };

    window.addEventListener("message", handleMessage);

    // 부모에게 준비 완료 알림
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: "CSS_PREVIEW_READY" },
        window.location.origin
      );
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      // 클린업: 미리보기 스타일 제거 및 원래 테마 복원
      const style = document.getElementById(PREVIEW_CSS_ID);
      if (style) {
        style.remove();
      }
      restoreOriginalTheme();
    };
  }, [isPreviewMode, injectPreviewCss, restoreOriginalTheme]);

  // 이 컴포넌트는 UI를 렌더링하지 않음
  return null;
}

/**
 * @deprecated ChannelCustomCssPreview를 사용하세요.
 * 하위 호환성을 위해 유지됩니다.
 */
export const ChannelCustomCss = ChannelCustomCssPreview;
