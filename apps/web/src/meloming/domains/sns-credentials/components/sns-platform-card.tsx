"use client";

import { useState } from "react";
import { Loader2, Plug2, Unplug, Twitter, BookText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import type { SnsCredentialResponse } from "@/meloming/domains/sns-credentials/types/sns-credential";
import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";

interface PlatformMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  /** 연동 해제 확인 다이얼로그 본문 */
  disconnectQuestion: string;
}

const PLATFORM_META: Record<SnsPlatform, PlatformMeta> = {
  X: {
    label: "X (트위터)",
    description: "방송 일정 이미지를 X 에 자동 게시할 수 있습니다.",
    icon: Twitter,
    disconnectQuestion:
      "X 연동을 해제하시겠습니까? 이미 예약된 게시물에는 영향을 주지 않습니다.",
  },
  NAVER_CAFE: {
    label: "네이버 카페",
    description:
      "방송 일정 이미지를 운영하는 네이버 카페 게시판에 자동 게시할 수 있습니다.",
    icon: BookText,
    disconnectQuestion:
      "네이버 카페 연동을 해제하시겠습니까? 이미 예약된 게시물에는 영향을 주지 않습니다.",
  },
};

/**
 * yyyy-MM-dd 형태로 포맷.
 *
 * - 입력값이 null / 잘못된 ISO 면 `null` 반환 → 호출 측에서 표시 생략.
 */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface SnsPlatformCardProps {
  credential: SnsCredentialResponse;
  isConnecting: boolean;
  isDisconnecting: boolean;
  /** 연결/재연결 클릭 — 부모가 platform 을 받아 connect 시작 */
  onConnect: (platform: SnsPlatform) => void;
  /** 연동 해제 확정 클릭 */
  onDisconnect: (platform: SnsPlatform) => void;
}

export function SnsPlatformCard({
  credential,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: SnsPlatformCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const meta = PLATFORM_META[credential.platform];
  const Icon = meta.icon;
  const connectedAtText = formatDate(credential.connectedAt);
  const expiresAtText = formatDate(credential.expiresAt);

  // 상태 결정
  // - isConnected=false → 미연동
  // - isConnected=true & isActive=true → 연결됨
  // - isConnected=true & isActive=false → 비활성 (재연결 가능)
  const status: "disconnected" | "connected" | "inactive" =
    !credential.isConnected
      ? "disconnected"
      : credential.isActive
        ? "connected"
        : "inactive";

  const handleConfirmDisconnect = () => {
    setConfirmOpen(false);
    onDisconnect(credential.platform);
  };

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* 좌측: 아이콘 + 라벨 + 상태 */}
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Icon className="size-5 text-foreground" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-base">{meta.label}</h3>
                {status === "connected" && (
                  <Badge variant="secondary" className="text-xs">
                    연결됨
                  </Badge>
                )}
                {status === "inactive" && (
                  <Badge variant="outline" className="text-xs">
                    비활성
                  </Badge>
                )}
                {status === "disconnected" && (
                  <Badge variant="outline" className="text-xs">
                    미연동
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {meta.description}
              </p>
              {/* 연결 상세 */}
              {status !== "disconnected" && (
                <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                  {credential.handle ? (
                    <p>
                      <span className="font-mono">{credential.handle}</span>
                      {connectedAtText &&
                        ` 로 연결됨 (${connectedAtText} 연결)`}
                    </p>
                  ) : connectedAtText ? (
                    <p>{connectedAtText} 연결</p>
                  ) : null}
                  {expiresAtText && <p>만료: {expiresAtText}</p>}
                </div>
              )}
            </div>
          </div>

          {/* 우측: 액션 버튼 */}
          <div className="flex items-center gap-2 sm:shrink-0">
            {status === "disconnected" && (
              <Button
                variant="outline"
                onClick={() => onConnect(credential.platform)}
                disabled={isConnecting}
                aria-label={`${meta.label} 연결`}
              >
                {isConnecting ? (
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                ) : (
                  <Plug2 className="size-4 mr-1.5" />
                )}
                연결
              </Button>
            )}

            {status === "inactive" && (
              <Button
                variant="outline"
                onClick={() => onConnect(credential.platform)}
                disabled={isConnecting}
                aria-label={`${meta.label} 재연결`}
              >
                {isConnecting ? (
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                ) : (
                  <Plug2 className="size-4 mr-1.5" />
                )}
                재연결
              </Button>
            )}

            {status === "connected" && (
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(true)}
                disabled={isDisconnecting}
                aria-label={`${meta.label} 연결 해제`}
                className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              >
                {isDisconnecting ? (
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                ) : (
                  <Unplug className="size-4 mr-1.5" />
                )}
                연결 해제
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{meta.label} 연결 해제</AlertDialogTitle>
            <AlertDialogDescription>
              {meta.disconnectQuestion}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              연결 해제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
