"use client";

import { useState } from "react";
import {
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Gamepad2,
  ExternalLink,
  Eye,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { SegmentedControl } from "@/meloming/shared/components/ui/segmented-control";
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
import {
  useConsoleToken,
  useRegenerateConsoleToken,
} from "@/meloming/domains/channel/hooks/use-console-token";
import {
  useActiveSession,
  useUpdateSessionSettings,
} from "@/meloming/domains/overlay/hooks/use-session";
import type {
  KaraokePlaybackMode,
  KaraokeVideoType,
} from "@/meloming/domains/overlay/apis/session";
import { openConsolePopup } from "@/meloming/domains/channel/utils/console-popup";
import { toast } from "sonner";
import { ManagementHeader } from "./management-header";
import { cn } from "@/meloming/shared/lib/utils";
import {
  SettingsRow,
  SettingsSectionHeader,
} from "@/meloming/shared/components/common/settings-form";

function BlurredUrlField({
  value,
  onCopy,
  copied,
}: {
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex gap-2">
      <div
        className="relative flex-1 cursor-pointer"
        onClick={() => !revealed && setRevealed(true)}
      >
        <Input
          readOnly
          value={value}
          className={cn(
            "font-mono text-xs transition-[filter] duration-200",
            !revealed && "blur-[6px] select-none"
          )}
        />
        {!revealed && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 pointer-events-none">
            <Eye className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">
              클릭하여 URL 표시
            </span>
          </div>
        )}
      </div>
      <Button size="icon" variant="outline" onClick={onCopy}>
        {copied ? (
          <Check className="size-4 text-green-500" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </div>
  );
}

export function ConsoleSettingsContent({ user }: { user: string }) {
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [copiedConsoleUrl, setCopiedConsoleUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const { data: consoleTokenData, isLoading: tokenLoading } =
    useConsoleToken(user);
  const regenerateConsoleTokenMutation = useRegenerateConsoleToken(user);

  const { data: activeSession, isLoading: isSessionLoading } =
    useActiveSession(user);
  const updateSessionSettingsMutation = useUpdateSessionSettings(user);

  const karaokePlaybackMode: KaraokePlaybackMode =
    activeSession?.settings?.karaokePlaybackMode ?? "DIRECT";
  const karaokeVideoType: KaraokeVideoType =
    activeSession?.settings?.karaokeVideoType ?? "KARAOKE";
  const playbackSettingsDisabled =
    !activeSession?.id ||
    isSessionLoading ||
    updateSessionSettingsMutation.isPending;

  const handlePlaybackModeChange = async (value: KaraokePlaybackMode) => {
    if (!activeSession?.id) {
      toast.error("신청곡 모드가 활성화되어 있지 않습니다");
      return;
    }
    try {
      await updateSessionSettingsMutation.mutateAsync({
        sessionId: activeSession.id,
        settings: { karaokePlaybackMode: value },
      });
      toast.success("영상 재생 방식이 변경되었습니다");
    } catch {
      toast.error("재생 방식 변경에 실패했습니다");
    }
  };

  const handleVideoTypeChange = async (value: KaraokeVideoType) => {
    if (!activeSession?.id) {
      toast.error("신청곡 모드가 활성화되어 있지 않습니다");
      return;
    }
    try {
      await updateSessionSettingsMutation.mutateAsync({
        sessionId: activeSession.id,
        settings: { karaokeVideoType: value },
      });
      toast.success("재생 영상 종류가 변경되었습니다");
    } catch {
      toast.error("재생 영상 종류 변경에 실패했습니다");
    }
  };

  const consoleToken = consoleTokenData?.consoleToken ?? null;
  const appBaseUrl = (
    typeof window !== "undefined" ? window.location.origin : ""
  ).replace(/\/$/, "");
  const consoleUrl = consoleToken
    ? `${appBaseUrl}/console/${user}?token=${consoleToken}`
    : "";

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedConsoleUrl(true);
    toast.success("URL이 복사되었습니다");
    setTimeout(() => setCopiedConsoleUrl(false), 2000);
  };

  const handleOpenConsole = () => {
    openConsolePopup(user, consoleToken);
  };

  return (
    <div className="p-6">
      <ManagementHeader
        title="리모컨 (신청곡 콘솔)"
        description="OBS 독(Dock)에 등록하여 신청곡을 관리할 수 있습니다."
        icon={Gamepad2}
      />

      {tokenLoading ? (
        <Card className="py-0">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 콘솔 열기 */}
          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="콘솔 열기" />
              <div className="py-4">
                <Button onClick={handleOpenConsole}>
                  <Gamepad2 className="size-4 mr-2" />
                  리모컨 (신청곡 콘솔) 열기
                  <ExternalLink className="size-3.5 ml-2" />
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  새 창에서 리모컨 (신청곡 콘솔)을 엽니다.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 콘솔 접속 URL */}
          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="OBS 콘솔 접속" />

              <SettingsRow
                title="콘솔 접속 URL"
                description="OBS 독(dock)에 등록하여 콘솔을 사용할 수 있습니다"
              >
                {consoleToken ? (
                  <div className="space-y-2">
                    <BlurredUrlField
                      value={consoleUrl}
                      onCopy={() => handleCopy(consoleUrl)}
                      copied={copiedConsoleUrl}
                    />
                    <p className="text-xs text-muted-foreground">
                      이 URL을 OBS의 독(Dock) &rarr; 사용자 지정 브라우저 독에
                      등록하세요.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    토큰이 아직 생성되지 않았습니다. 아래에서 토큰을 생성하세요.
                  </p>
                )}
              </SettingsRow>

              {consoleToken && (
                <SettingsRow
                  title="콘솔 토큰"
                  description="토큰만 따로 복사할 수 있습니다"
                >
                  <BlurredUrlField
                    value={consoleToken}
                    onCopy={() => {
                      navigator.clipboard.writeText(consoleToken);
                      setCopiedToken(true);
                      toast.success("토큰이 복사되었습니다");
                      setTimeout(() => setCopiedToken(false), 2000);
                    }}
                    copied={copiedToken}
                  />
                </SettingsRow>
              )}

              <SettingsRow
                title="토큰 재생성"
                description="기존 OBS 독에 등록한 URL이 무효화됩니다"
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsRegenerateDialogOpen(true)}
                  disabled={regenerateConsoleTokenMutation.isPending}
                >
                  {regenerateConsoleTokenMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="size-4 mr-2" />
                  )}
                  새 토큰 생성
                </Button>
              </SettingsRow>
            </CardContent>
          </Card>

          {/* 재생 설정 */}
          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="재생 설정" />

              <SettingsRow
                title="영상 재생 방식"
                description="리모컨에서 노래방 영상을 어떻게 재생할지 선택합니다"
              >
                <div className="space-y-2">
                  <SegmentedControl
                    value={karaokePlaybackMode}
                    options={[
                      { value: "DIRECT", label: "직접 재생" },
                      { value: "YOUTUBE", label: "YouTube 임베드" },
                    ]}
                    disabled={playbackSettingsDisabled}
                    onValueChange={(value) =>
                      handlePlaybackModeChange(value as KaraokePlaybackMode)
                    }
                    aria-label="영상 재생 방식"
                  />
                  {!activeSession?.id && (
                    <p className="text-xs text-muted-foreground">
                      신청곡 모드 시작 후에 변경할 수 있습니다
                    </p>
                  )}
                </div>
              </SettingsRow>

              <SettingsRow
                title="재생 영상 종류"
                description="리모컨에서 기본으로 재생할 영상을 선택합니다"
              >
                <div className="space-y-2">
                  <SegmentedControl
                    value={karaokeVideoType}
                    options={[
                      { value: "KARAOKE", label: "노래방 영상" },
                      { value: "ORIGINAL", label: "원본(원곡) 영상" },
                    ]}
                    disabled={playbackSettingsDisabled}
                    onValueChange={(value) =>
                      handleVideoTypeChange(value as KaraokeVideoType)
                    }
                    aria-label="재생 영상 종류"
                  />
                  {!activeSession?.id && (
                    <p className="text-xs text-muted-foreground">
                      신청곡 모드 시작 후에 변경할 수 있습니다
                    </p>
                  )}
                </div>
              </SettingsRow>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 콘솔 토큰 재생성 확인 다이얼로그 */}
      <AlertDialog
        open={isRegenerateDialogOpen}
        onOpenChange={setIsRegenerateDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 paperlogy">
              <AlertTriangle className="size-5 text-amber-500" />
              콘솔 토큰을 재생성할까요?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>기존 토큰이 즉시 무효화됩니다.</p>
              <p className="text-destructive">
                OBS 독에 등록한 콘솔 URL을 새로 설정해야 합니다.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await regenerateConsoleTokenMutation.mutateAsync();
                  toast.success("콘솔 토큰이 재생성되었습니다");
                  setIsRegenerateDialogOpen(false);
                } catch {
                  toast.error("토큰 재생성에 실패했습니다");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              재생성
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
