"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Download,
  Eye,
  Gamepad2,
  Play,
  SkipForward,
  Pause,
  ListOrdered,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/meloming/shared/components/ui/alert";
import { Info } from "lucide-react";
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
import { toast } from "sonner";
import { ManagementHeader } from "./management-header";
import { cn } from "@/meloming/shared/lib/utils";
import {
  SettingsRow,
  SettingsSectionHeader,
} from "@/meloming/shared/components/common/settings-form";

const PLUGIN_DOWNLOAD_URL =
  "https://cdn.meloming.com/stream-deck/meloming.streamDeckPlugin";
const PLUGIN_RELEASES = [
  {
    version: "v0.1.1",
    downloadUrl:
      "https://cdn.meloming.com/stream-deck/meloming-v0.1.1.streamDeckPlugin",
    isLatest: true,
  },
  {
    version: "v0.1.0",
    downloadUrl:
      "https://cdn.meloming.com/stream-deck/meloming-v0.1.0.streamDeckPlugin",
    isLatest: false,
  },
] as const;
const PLUGIN_VERSION = PLUGIN_RELEASES[0].version;

function BlurredValueField({
  value,
  onCopy,
  copied,
  placeholder = "클릭하여 표시",
}: {
  value: string;
  onCopy: () => void;
  copied: boolean;
  placeholder?: string;
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
              {placeholder}
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

function CopyableField({
  value,
  onCopy,
  copied,
}: {
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" />
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

const ACTIONS: Array<{
  icon: typeof Play;
  name: string;
  description: string;
  color: string;
}> = [
  {
    icon: Play,
    name: "신청곡모드 토글",
    description: "세션 시작/종료를 한 번에",
    color: "text-emerald-500",
  },
  {
    icon: SkipForward,
    name: "다음곡",
    description: "현재 곡 완료 + 대기열 다음 곡",
    color: "text-blue-500",
  },
  {
    icon: Pause,
    name: "신청 일시정지",
    description: "신청 접수 ON/OFF",
    color: "text-amber-500",
  },
  {
    icon: ListOrdered,
    name: "대기열 카운터",
    description: "대기/완료 수 실시간 + 신규 신청 알림",
    color: "text-violet-500",
  },
  {
    icon: ExternalLink,
    name: "리모컨 열기",
    description: "신청곡 콘솔 페이지 브라우저 오픈",
    color: "text-indigo-500",
  },
];

export function StreamDeckSettingsContent({ user }: { user: string }) {
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [copiedChannel, setCopiedChannel] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const { data: consoleTokenData, isLoading: tokenLoading } =
    useConsoleToken(user);
  const regenerateConsoleTokenMutation = useRegenerateConsoleToken(user);

  const consoleToken = consoleTokenData?.consoleToken ?? null;

  const handleCopyChannel = () => {
    navigator.clipboard.writeText(user);
    setCopiedChannel(true);
    toast.success("채널 식별자가 복사되었습니다");
    setTimeout(() => setCopiedChannel(false), 2000);
  };

  const handleCopyToken = () => {
    if (!consoleToken) return;
    navigator.clipboard.writeText(consoleToken);
    setCopiedToken(true);
    toast.success("토큰이 복사되었습니다");
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="p-6">
      <ManagementHeader
        title="스트림덱 연동"
        description="Elgato Stream Deck에서 신청곡 세션과 대기열을 원터치로 제어하세요."
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
          <Alert>
            <Info className="size-4" />
            <AlertTitle>곧 Stream Deck 마켓플레이스에서 바로 설치할 수 있어요</AlertTitle>
            <AlertDescription>
              현재는 베타 기간으로 아래 파일을 내려받아 수동 설치해야 합니다.
              Elgato Marketplace 심사가 완료되면 Stream Deck 앱에서 “Meloming
              (멜로밍)” 검색 → 1클릭 설치로 업데이트될 예정입니다.
            </AlertDescription>
          </Alert>

          {/* 플러그인 다운로드 */}
          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="플러그인 다운로드" />
              <div className="py-4 flex flex-col sm:flex-row gap-4 sm:items-center">
                <Image
                  src="/logo/meloming-logo-512.png"
                  alt="Meloming"
                  width={72}
                  height={72}
                  className="rounded-xl shadow-sm shrink-0"
                  unoptimized
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-base">
                      Meloming Stream Deck 플러그인
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {PLUGIN_VERSION}
                    </span>
                    <span className="text-[10px] font-semibold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      BETA
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    macOS 12+ / Windows 10+ 지원. 신청곡모드 토글·다음곡·일시정지·대기열
                    카운터·리모컨 열기 5개 액션을 Stream Deck 키에서 바로 제어할 수
                    있습니다.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <Button asChild size="sm">
                      <a href={PLUGIN_DOWNLOAD_URL} download>
                        <Download className="size-4 mr-2" />
                        플러그인 다운로드
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
              <div className="border-t py-4">
                <div className="mb-3">
                  <div className="text-sm font-medium">버전별 다운로드</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    최신 버전에서 문제가 생기면 이전 버전을 다시 설치할 수 있습니다.
                  </p>
                </div>
                <div className="divide-y rounded-md border">
                  {PLUGIN_RELEASES.map((release) => (
                    <div
                      key={release.version}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {release.version}
                        </span>
                        {release.isLatest ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            최신
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            이전 버전
                          </span>
                        )}
                      </div>
                      <Button asChild size="sm" variant="ghost">
                        <a href={release.downloadUrl} download>
                          <Download className="mr-2 size-3.5" />
                          다운로드
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 설치 방법 */}
          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="설치 방법" />
              <div className="py-4 space-y-3">
                <InstallStep
                  step={1}
                  title="플러그인 다운로드"
                  description="위 버튼을 눌러 meloming.streamDeckPlugin 파일을 받습니다."
                />
                <InstallStep
                  step={2}
                  title="파일 더블클릭"
                  description="Elgato Stream Deck 앱이 설치 프롬프트를 띄웁니다. “Install”을 누르면 Meloming (멜로밍) 카테고리에 5개 액션이 추가됩니다."
                />
                <InstallStep
                  step={3}
                  title="설정 입력"
                  description="액션을 키에 드래그한 뒤 오른쪽 Property Inspector에 아래 채널 식별자와 콘솔 토큰을 붙여넣으세요. 한 번만 입력하면 모든 액션에 공유됩니다."
                />
              </div>
            </CardContent>
          </Card>

          {/* 연동 정보 */}
          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="연동 정보" />

              <SettingsRow
                title="채널 식별자"
                description="Stream Deck Property Inspector의 “채널 식별자” 필드에 입력"
              >
                <CopyableField
                  value={user}
                  onCopy={handleCopyChannel}
                  copied={copiedChannel}
                />
              </SettingsRow>

              <SettingsRow
                title="콘솔 토큰"
                description="Property Inspector의 “콘솔 토큰” 필드에 입력. 유출 시 즉시 재생성하세요."
              >
                {consoleToken ? (
                  <BlurredValueField
                    value={consoleToken}
                    onCopy={handleCopyToken}
                    copied={copiedToken}
                    placeholder="클릭하여 토큰 표시"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    토큰이 아직 생성되지 않았습니다. 아래에서 토큰을 생성하세요.
                  </p>
                )}
              </SettingsRow>

              <SettingsRow
                title="토큰 재생성"
                description="기존 Stream Deck 플러그인과 OBS 독에 등록된 URL이 무효화됩니다"
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

          {/* 제공하는 액션 */}
          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="제공하는 액션" />
              <div className="py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {ACTIONS.map(({ icon: Icon, name, description, color }) => (
                  <div
                    key={name}
                    className="flex flex-col gap-2 rounded-md border p-3"
                  >
                    <Icon className={cn("size-5 shrink-0", color)} />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                        {description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
              <span className="block">기존 토큰이 즉시 무효화됩니다.</span>
              <span className="block text-destructive">
                Stream Deck 플러그인과 OBS 독에 등록된 URL을 새로 설정해야
                합니다.
              </span>
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

function InstallStep({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="shrink-0 size-7 rounded-full bg-primary/10 text-primary font-semibold text-sm flex items-center justify-center">
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{title}</div>
        <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
          {description}
        </p>
      </div>
    </div>
  );
}
