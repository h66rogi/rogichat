"use client";

import { useCallback, useState } from "react";
import { useClipboard } from "./use-clipboard";
import { toast } from "sonner";

export type SharePlatform =
  | "native"
  | "copy"
  | "twitter"
  | "facebook";

export interface ShareData {
  title: string;
  text?: string;
  url: string;
}

interface UseShareReturn {
  share: (platform: SharePlatform, data: ShareData) => Promise<boolean>;
  canNativeShare: boolean;
  copyLink: (url: string) => Promise<boolean>;
  createShortUrl: (url: string) => Promise<string | null>;
  isCreatingShortUrl: boolean;
}

// 네이티브 공유 API 지원 여부 확인
function canUseNativeShare(): boolean {
  return typeof navigator !== "undefined" && !!navigator.share;
}

// SNS 공유 URL 생성
function getSnsShareUrl(
  platform: SharePlatform,
  data: ShareData
): string | null {
  const encodedUrl = encodeURIComponent(data.url);
  const encodedText = encodeURIComponent(data.text || data.title);

  switch (platform) {
    case "twitter":
      return `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    default:
      return null;
  }
}

// 단축 URL API 호출 (서버 사이드 API 라우트 사용)
async function createShortUrlApi(url: string): Promise<string | null> {
  try {
    const response = await fetch("/api/short-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error("Failed to create short URL");
    }

    const result = await response.json();
    if (result.success && result.data?.shortUrl) {
      return result.data.shortUrl;
    }
    return null;
  } catch (error) {
    console.error("Short URL creation failed:", error);
    return null;
  }
}

// 팝업 창 열기
function openPopup(url: string, name: string): boolean {
  const width = 600;
  const height = 400;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const popup = window.open(
    url,
    name,
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
  );

  return popup !== null;
}

export function useShare(): UseShareReturn {
  const { copy } = useClipboard();
  const [isCreatingShortUrl, setIsCreatingShortUrl] = useState(false);

  const copyLink = useCallback(
    async (url: string): Promise<boolean> => {
      const success = await copy(url);
      if (success) {
        toast.success("링크가 복사되었습니다");
      } else {
        toast.error("링크 복사에 실패했습니다");
      }
      return success;
    },
    [copy]
  );

  const createShortUrl = useCallback(
    async (url: string): Promise<string | null> => {
      setIsCreatingShortUrl(true);
      try {
        const shortUrl = await createShortUrlApi(url);
        if (shortUrl) {
          const success = await copy(shortUrl);
          if (success) {
            toast.success("단축 URL이 복사되었습니다");
          }
          return shortUrl;
        } else {
          toast.error("단축 URL 생성에 실패했습니다");
          return null;
        }
      } finally {
        setIsCreatingShortUrl(false);
      }
    },
    [copy]
  );

  const shareNative = useCallback(
    async (data: ShareData): Promise<boolean> => {
      if (!canUseNativeShare()) {
        return false;
      }

      try {
        await navigator.share({
          title: data.title,
          text: data.text || data.title,
          url: data.url,
        });
        return true;
      } catch (error) {
        // 사용자가 공유를 취소한 경우
        if (error instanceof Error && error.name === "AbortError") {
          return false;
        }
        console.error("Native share failed:", error);
        return false;
      }
    },
    []
  );

  const share = useCallback(
    async (platform: SharePlatform, data: ShareData): Promise<boolean> => {
      switch (platform) {
        case "native":
          return shareNative(data);

        case "copy":
          return copyLink(data.url);

        case "twitter":
        case "facebook": {
          const shareUrl = getSnsShareUrl(platform, data);
          if (shareUrl) {
            const success = openPopup(shareUrl, `share-${platform}`);
            if (!success) {
              // 팝업이 차단된 경우 새 탭으로 열기
              window.open(shareUrl, "_blank");
            }
            return true;
          }
          return false;
        }

        default:
          return false;
      }
    },
    [shareNative, copyLink]
  );

  return {
    share,
    canNativeShare: canUseNativeShare(),
    copyLink,
    createShortUrl,
    isCreatingShortUrl,
  };
}
