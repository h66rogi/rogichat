"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { useShare, type ShareData } from "@/meloming/shared/hooks/use-share";
import { cn } from "@/meloming/shared/lib/utils";
import { Link2, Share2, Loader2 } from "lucide-react";

// SNS 아이콘 컴포넌트들
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

interface ShareOption {
  id: "native" | "copy" | "twitter" | "facebook";
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

export interface ExtraShareOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  /** 옵션 클릭 시 실행. 자체 toast 처리 필요. */
  onClick: () => void | Promise<void>;
  /** true 면 클릭 후 시트가 닫히지 않음 (단축 URL 토글 같은 경우). */
  keepOpenAfterClick?: boolean;
}

interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ShareData;
  /** 기본 옵션 (copy/native/X/Facebook) 뒤에 추가로 노출할 옵션. 임베드 코드 복사 같은 도메인 특화 옵션 주입용. */
  extraOptions?: ExtraShareOption[];
}

export function ShareSheet({ open, onOpenChange, data, extraOptions }: ShareSheetProps) {
  const { share, canNativeShare, isCreatingShortUrl, createShortUrl, copyLink } = useShare();
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [isShortened, setIsShortened] = useState(false);
  const attemptedUrlRef = useRef<string | null>(null);

  // 모달이 열릴 때 자동으로 단축 URL 생성 (1회만 시도, 실패 시 원본 URL 사용)
  useEffect(() => {
    if (!open || attemptedUrlRef.current === data.url) {
      return;
    }

    let isActive = true;
    attemptedUrlRef.current = data.url;

    fetch("/api/short-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: data.url }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        if (!isActive) {
          return;
        }
        if (result?.success && result?.data?.shortUrl) {
          setShortUrl(result.data.shortUrl);
          setIsShortened(true);
        }
      })
      .catch(() => {
        // 실패해도 무시 - 원본 URL 사용
      });

    return () => {
      isActive = false;
    };
  }, [open, data.url]);

  const currentUrl = isShortened && shortUrl ? shortUrl : data.url;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setShortUrl(null);
      setIsShortened(false);
      attemptedUrlRef.current = null;
    }
    onOpenChange(nextOpen);
  };

  const shareOptions: ShareOption[] = [
    {
      id: "copy",
      label: "링크 복사",
      icon: <Link2 className="w-6 h-6" />,
      color: "text-gray-700 dark:text-gray-200",
      bgColor: "bg-gray-100 dark:bg-gray-800",
    },
    ...(canNativeShare
      ? [
          {
            id: "native" as const,
            label: "더보기",
            icon: <Share2 className="w-6 h-6" />,
            color: "text-indigo-600 dark:text-indigo-400",
            bgColor: "bg-indigo-100 dark:bg-indigo-900/50",
          },
        ]
      : []),
    {
      id: "twitter",
      label: "X",
      icon: <XIcon className="w-6 h-6" />,
      color: "text-black dark:text-white",
      bgColor: "bg-gray-100 dark:bg-gray-800",
    },
    {
      id: "facebook",
      label: "Facebook",
      icon: <FacebookIcon className="w-6 h-6" />,
      color: "text-white",
      bgColor: "bg-[#1877F2]",
    },
  ];

  const handleShare = async (optionId: ShareOption["id"]) => {
    if (optionId === "copy") {
      // 현재 표시된 URL(단축 또는 원본)을 복사
      await copyLink(currentUrl);
      return;
    }

    await share(optionId, data);
    handleOpenChange(false);
  };

  const handleToggleShortUrl = async () => {
    if (shortUrl) {
      // 이미 단축 URL이 있으면 토글만
      setIsShortened(!isShortened);
      if (!isShortened) {
        // 단축 URL로 전환할 때 복사
        await copyLink(shortUrl);
      }
    } else {
      // 단축 URL이 없으면 생성
      const newShortUrl = await createShortUrl(data.url);
      if (newShortUrl) {
        setShortUrl(newShortUrl);
        setIsShortened(true);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="overflow-hidden">
          <DialogTitle>공유하기</DialogTitle>
          <DialogDescription className="truncate max-w-full">{data.title}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* 공유 옵션 그리드 */}
          <div className="grid grid-cols-4 gap-4">
            {shareOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => handleShare(option.id)}
                className="flex flex-col items-center gap-2 group"
              >
                <div
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center transition-transform group-hover:scale-105 group-active:scale-95",
                    option.bgColor,
                    option.color
                  )}
                >
                  {option.icon}
                </div>
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  {option.label}
                </span>
              </button>
            ))}
            {extraOptions?.map((option) => (
              <button
                key={option.id}
                onClick={async () => {
                  await option.onClick();
                  if (!option.keepOpenAfterClick) handleOpenChange(false);
                }}
                className="flex flex-col items-center gap-2 group"
              >
                <div
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center transition-transform group-hover:scale-105 group-active:scale-95",
                    option.bgColor,
                    option.color
                  )}
                >
                  {option.icon}
                </div>
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  {option.label}
                </span>
              </button>
            ))}
          </div>

          {/* URL 미리보기 */}
          <div className="mt-6 p-3 bg-muted rounded-lg flex items-center gap-2">
            <p className="text-xs text-muted-foreground truncate flex-1">
              {currentUrl}
            </p>
            <button
              onClick={handleToggleShortUrl}
              disabled={isCreatingShortUrl}
              className={cn(
                "shrink-0 px-2 py-1 text-xs rounded-md font-medium transition-colors",
                isShortened
                  ? "bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:hover:bg-purple-900/70"
                  : "bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600",
                isCreatingShortUrl && "opacity-50 cursor-not-allowed"
              )}
            >
              {isCreatingShortUrl ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isShortened ? (
                "원본 URL"
              ) : (
                "URL 단축"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 공유 버튼 컴포넌트 (편의를 위해 제공)
interface ShareButtonProps {
  data: ShareData;
  className?: string;
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "lg" | "icon";
  children?: React.ReactNode;
}

export function ShareButton({
  data,
  className,
  variant = "ghost",
  size = "icon",
  children,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className={className}
      >
        {children || <Share2 className="w-5 h-5" />}
      </Button>
      <ShareSheet open={open} onOpenChange={setOpen} data={data} />
    </>
  );
}
