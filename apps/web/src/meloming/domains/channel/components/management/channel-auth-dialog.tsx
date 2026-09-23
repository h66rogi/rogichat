"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Upload,
  X,
  ImageIcon,
  Loader2,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import {
  useChannelVerificationPreview,
  useCreateChannelVerification,
} from "@/meloming/domains/channel/hooks/use-channel-verification";
import { useVerifyPlatform } from "@/meloming/domains/platform/hooks/use-platform-verification";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";
import {
  openOAuthPopup,
  isOAuthCallbackMessage,
  type OAuthCallbackMessage,
} from "@/meloming/domains/platform/apis/platform-oauth";
import type { Platform, StreamPlatform } from "@/meloming/domains/platform/types/platform";
import type { ChannelVerificationDto } from "@/meloming/domains/channel/types/channel-verification";

type FunnelStep =
  | "ownership"
  | "platform-select"
  | "other-verification"
  | "not-owner"
  | "processing";

interface ChannelAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformUrl: string | null;
  existingVerifications?: ChannelVerificationDto[];
  targetPlatform?: StreamPlatform;
}

export function ChannelAuthDialog({
  open,
  onOpenChange,
  platformUrl,
  existingVerifications,
  targetPlatform,
}: ChannelAuthDialogProps) {
  const params = useParams();
  const identifier = (params?.user as string) || "";

  const [step, setStep] = useState<FunnelStep>("ownership");
  const [selectedPlatform, setSelectedPlatform] = useState<
    "chzzk" | "soop" | "cime" | "other" | null
  >(null);
  const [verificationImage, setVerificationImage] = useState<File | null>(null);
  const [verificationDescription, setVerificationDescription] = useState("");
  const [isOAuthInProgress, setIsOAuthInProgress] = useState(false);

  // OAuth 팝업 레퍼런스
  const oauthPopupRef = useRef<Window | null>(null);

  // targetPlatform이 있으면 ownership 스텝 건너뛰고 바로 platform-select로
  useEffect(() => {
    if (open && targetPlatform) {
      const mapped = targetPlatform.toLowerCase() as "chzzk" | "soop" | "cime" | "other";
      setSelectedPlatform(mapped);
      setStep("platform-select");
    }
  }, [open, targetPlatform]);

  // 이미 APPROVED된 플랫폼 목록
  const approvedPlatforms = (existingVerifications ?? [])
    .filter((v) => v.status === "APPROVED")
    .map((v) => v.platform);

  // Hooks
  const { data: preview, isLoading: isPreviewLoading } =
    useChannelVerificationPreview(identifier, {
      enabled: open,
      platform: selectedPlatform
        ? (selectedPlatform.toUpperCase() as StreamPlatform)
        : undefined,
    });

  const { uploadImage, isUploading } = useImageUpload();

  const verifyPlatformMutation = useVerifyPlatform();

  const createVerificationMutation = useCreateChannelVerification(identifier, {
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  // OAuth 메시지 핸들러
  const handleOAuthMessage = useCallback(
    async (event: MessageEvent) => {
      // 메시지 유효성 검사만 수행 (origin 체크 제거 - 개발 환경 호환)
      if (!isOAuthCallbackMessage(event.data)) {
        return;
      }

      const message = event.data as OAuthCallbackMessage;
      try {
        localStorage.removeItem("oauth_callback_result");
      } catch {
        // ignore cleanup failures
      }

      if (message.type === "OAUTH_SUCCESS" && message.accessToken) {
        setIsOAuthInProgress(false);
        setStep("processing");

        try {
          // 1. 플랫폼 인증 수행
          const platformVerification = await verifyPlatformMutation.mutateAsync({
            platform: message.platform,
            body: {
              accessToken: message.accessToken,
              refreshToken: message.refreshToken,
            },
          });

          // 2. 채널 인증 신청
          await createVerificationMutation.mutateAsync({
            userPlatformVerificationId: platformVerification.id,
          });
        } catch (error) {
          console.error("인증 처리 실패:", error);
          setStep("platform-select");
        }
      } else if (message.type === "OAUTH_ERROR") {
        setIsOAuthInProgress(false);
        toast.error(message.error || "OAuth 인증에 실패했습니다.");
      }
    },
    [verifyPlatformMutation, createVerificationMutation]
  );

  // OAuth 메시지 수신: postMessage + BroadcastChannel + localStorage 폴링
  // popup.closed 체크 제거: COOP 헤더로 인해 cross-origin 팝업 참조가 즉시 "closed"로 보여
  // 정상 진행 중인 OAuth를 "팝업 닫힘"으로 오판하는 문제 방지
  useEffect(() => {
    if (!isOAuthInProgress) return;

    let finished = false;

    function onMessage(event: MessageEvent) {
      if (finished) return;
      if (!isOAuthCallbackMessage(event.data)) return;
      finished = true;
      handleOAuthMessage(event);
    }

    window.addEventListener("message", onMessage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("meloming-oauth");
      bc.onmessage = (event: MessageEvent) => {
        if (finished) return;
        if (!isOAuthCallbackMessage(event.data)) return;
        finished = true;
        handleOAuthMessage(event);
      };
    } catch {
      // BroadcastChannel not supported
    }

    const startTime = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000; // 5분

    const pollInterval = window.setInterval(() => {
      if (finished) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const stored = localStorage.getItem("oauth_callback_result");
        if (stored) {
          localStorage.removeItem("oauth_callback_result");
          const parsed = JSON.parse(stored);
          if (isOAuthCallbackMessage(parsed)) {
            finished = true;
            clearInterval(pollInterval);
            handleOAuthMessage({ data: parsed, origin: window.location.origin } as MessageEvent);
            return;
          }
        }
      } catch {
        // ignore parse errors
      }
      // popup.closed 체크 제거: COOP 헤더로 팝업 참조가 즉시 "closed"로 보여
      // localStorage/BroadcastChannel 폴링 + 타임아웃으로만 완료 감지
      if (Date.now() - startTime > TIMEOUT_MS) {
        finished = true;
        clearInterval(pollInterval);
        setIsOAuthInProgress(false);
        toast.error("인증 시간이 초과되었습니다. 다시 시도해주세요.");
      }
    }, 500);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(pollInterval);
      try { bc?.close(); } catch { /* ignore */ }
    };
  }, [isOAuthInProgress, handleOAuthMessage]);

  // 모달이 닫힐 때 상태 초기화
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setStep("ownership");
      setSelectedPlatform(null);
      setVerificationImage(null);
      setVerificationDescription("");
      setIsOAuthInProgress(false);
      try { oauthPopupRef.current?.close(); } catch { /* ignore */ }
    }
    onOpenChange(isOpen);
  };

  // platformUrl에서 플랫폼 추론
  const normalizedPlatformUrl = (platformUrl || "").toLowerCase();
  const detectedPlatform = normalizedPlatformUrl.includes("chzzk.naver.com")
    ? "chzzk"
    : normalizedPlatformUrl.includes("sooplive.co.kr")
      ? "soop"
      : normalizedPlatformUrl.includes("ci.me")
        ? "cime"
      : "other";

  const handleOwnershipYes = () => {
    setStep("platform-select");
  };

  const handleOwnershipNo = () => {
    setStep("not-owner");
  };

  const handleBack = () => {
    if (step === "other-verification") {
      setStep("platform-select");
    } else {
      setStep("ownership");
      setSelectedPlatform(null);
    }
  };

  const handlePlatformSelect = (
    platform: "chzzk" | "soop" | "cime" | "other"
  ) => {
    setSelectedPlatform(platform);
  };

  const handleStartAuth = () => {
    if (selectedPlatform === "other") {
      setStep("other-verification");
    } else if (selectedPlatform) {
      // 이전 OAuth 결과 정리
      localStorage.removeItem("oauth_callback_result");

      // OAuth 팝업 열기
      const platform = selectedPlatform.toUpperCase() as Platform;
      const popup = openOAuthPopup(platform);

      if (popup) {
        oauthPopupRef.current = popup;
        setIsOAuthInProgress(true);
      } else {
        toast.error("팝업이 차단되었습니다. 팝업 차단을 해제해주세요.");
      }
    }
  };

  const handleOtherVerificationSubmit = async () => {
    if (!verificationImage) return;

    setStep("processing");

    try {
      const manualPlatform =
        selectedPlatform === "cime" ? "CIME" : "OTHER";

      // 1. 이미지 업로드
      const uploadResult = await uploadImage(verificationImage);

      // 2. 채널 인증 신청
      await createVerificationMutation.mutateAsync({
        platform: manualPlatform,
        evidenceImageUrl: uploadResult.imageUrl,
        evidenceDescription: verificationDescription || undefined,
      });
    } catch (error) {
      console.error("기타 플랫폼 인증 실패:", error);
      const errorMessage = extractApiErrorMessage(
        error,
        "인증 신청에 실패했습니다."
      );
      toast.error(errorMessage);
      setStep("other-verification");
    }
  };

  const isProcessing =
    step === "processing" ||
    isOAuthInProgress ||
    verifyPlatformMutation.isPending ||
    createVerificationMutation.isPending ||
    isUploading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {isPreviewLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-4">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          </div>
        ) : step === "processing" ? (
          <div className="py-12 flex flex-col items-center justify-center gap-4">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">인증 처리 중...</p>
          </div>
        ) : (
          <>
            {step === "ownership" && (
              <OwnershipStep
                platformUrl={platformUrl!}
                detectedPlatform={detectedPlatform}
                onYes={handleOwnershipYes}
                onNo={handleOwnershipNo}
              />
            )}

            {step === "platform-select" && (
              <PlatformSelectStep
                detectedPlatform={detectedPlatform}
                selectedPlatform={selectedPlatform}
                canAutoVerify={preview?.canAutoVerify}
                matchedVerification={preview?.matchedVerification}
                approvedPlatforms={approvedPlatforms}
                onSelect={handlePlatformSelect}
                onBack={handleBack}
                onStartAuth={handleStartAuth}
                isLoading={isProcessing}
              />
            )}

            {step === "other-verification" && (
              <OtherVerificationStep
                image={verificationImage}
                description={verificationDescription}
                onImageChange={setVerificationImage}
                onDescriptionChange={setVerificationDescription}
                onBack={handleBack}
                onSubmit={handleOtherVerificationSubmit}
                isLoading={isProcessing}
              />
            )}

            {step === "not-owner" && (
              <NotOwnerStep
                onBack={handleBack}
                onClose={() => handleOpenChange(false)}
                identifier={identifier}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Step 1: 본인 소유 확인
function OwnershipStep({
  platformUrl,
  detectedPlatform,
  onYes,
  onNo,
}: {
  platformUrl: string;
  detectedPlatform: "chzzk" | "soop" | "cime" | "other";
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>채널 인증</DialogTitle>
        <DialogDescription>
          방송 플랫폼 계정과 채널을 연결하여 인증합니다.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-4">
        <div className="space-y-3">
          <h3 className="font-medium">현재 채널이 본인 소유의 채널인가요?</h3>

          <div className="p-4 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Globe className="size-4" />
              <span>등록된 방송 플랫폼</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  detectedPlatform === "chzzk"
                    ? "chzzk"
                    : detectedPlatform === "soop"
                      ? "soop"
                      : detectedPlatform === "cime"
                        ? "cime"
                      : "secondary"
                }
              >
                {detectedPlatform === "chzzk"
                  ? "CHZZK"
                  : detectedPlatform === "soop"
                    ? "SOOP"
                    : detectedPlatform === "cime"
                      ? "CIME"
                    : "기타"}
              </Badge>
              <a
                href={platformUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1 truncate max-w-[300px]"
              >
                {platformUrl}
                <ExternalLink className="size-3 shrink-0" />
              </a>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button onClick={onYes} className="flex-1" size="lg">
            <CheckCircle2 className="size-4 mr-2" />
            예, 제 채널입니다
          </Button>
          <Button onClick={onNo} variant="outline" className="flex-1" size="lg">
            아니오
          </Button>
        </div>
      </div>
    </>
  );
}

// Step 2a: 플랫폼 선택
function PlatformSelectStep({
  detectedPlatform,
  selectedPlatform,
  canAutoVerify,
  matchedVerification,
  approvedPlatforms,
  onSelect,
  onBack,
  onStartAuth,
  isLoading,
}: {
  detectedPlatform: "chzzk" | "soop" | "cime" | "other";
  selectedPlatform: "chzzk" | "soop" | "cime" | "other" | null;
  canAutoVerify?: boolean;
  matchedVerification?: { platform: string; platformChannelId: string | null } | null;
  approvedPlatforms?: string[];
  onSelect: (platform: "chzzk" | "soop" | "cime" | "other") => void;
  onBack: () => void;
  onStartAuth: () => void;
  isLoading: boolean;
}) {
  const platforms = [
    {
      id: "chzzk" as const,
      name: "치지직",
      fullName: "CHZZK",
      description: "네이버 치지직 계정으로 인증",
      badgeVariant: "chzzk" as const,
    },
    {
      id: "soop" as const,
      name: "숲",
      fullName: "SOOP",
      description: "숲(구 아프리카TV) 계정으로 인증",
      badgeVariant: "soop" as const,
    },
    {
      id: "cime" as const,
      name: "씨미",
      fullName: "CIME",
      description: "씨미 계정으로 인증",
      badgeVariant: "cime" as const,
    },
    {
      id: "other" as const,
      name: "기타",
      fullName: "기타",
      description: "다른 방송 플랫폼 (수동 인증)",
      badgeVariant: "secondary" as const,
    },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} className="size-8">
            <ArrowLeft className="size-4" />
          </Button>
          인증 플랫폼 선택
        </DialogTitle>
        <DialogDescription>
          채널 인증에 사용할 방송 플랫폼을 선택해주세요. 인증한 계정으로 방송
          플랫폼 주소가 변경됩니다.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {canAutoVerify && matchedVerification && (
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <p className="text-xs text-green-700 dark:text-green-300">
                이미 연결된 {matchedVerification.platform} 계정이 있어 자동 인증이
                가능합니다.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {platforms.map((platform) => {
            const isApproved = approvedPlatforms?.includes(
              platform.fullName === "기타" ? "OTHER" : platform.fullName
            );
            return (
              <button
                key={platform.id}
                onClick={() => !isApproved && onSelect(platform.id)}
                disabled={isApproved}
                className={cn(
                  "w-full p-4 rounded-lg border-2 text-left transition-colors",
                  isApproved
                    ? "border-border bg-muted/50 opacity-60 cursor-not-allowed"
                    : selectedPlatform === platform.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant={platform.badgeVariant}>
                      {platform.fullName}
                    </Badge>
                    <span className="font-medium">{platform.name}</span>
                    {isApproved ? (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-400">
                        (인증됨)
                      </Badge>
                    ) : detectedPlatform === platform.id ? (
                      <Badge variant="outline" className="text-xs">
                        현재 등록된 플랫폼
                      </Badge>
                    ) : null}
                  </div>
                  {selectedPlatform === platform.id && !isApproved && (
                    <CheckCircle2 className="size-5 text-primary" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {platform.description}
                </p>
              </button>
            );
          })}
        </div>

        <Button
          onClick={onStartAuth}
          disabled={!selectedPlatform || isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              처리 중...
            </>
          ) : selectedPlatform === "other" ? (
            <>
              다음
              <ArrowRight className="size-4 ml-2" />
            </>
          ) : (
            <>
              인증 시작하기
              <ArrowRight className="size-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </>
  );
}

// Step 2a-2: 기타 플랫폼 수동 인증
function OtherVerificationStep({
  image,
  description,
  onImageChange,
  onDescriptionChange,
  onBack,
  onSubmit,
  isLoading,
}: {
  image: File | null;
  description: string;
  onImageChange: (file: File | null) => void;
  onDescriptionChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  isLoading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageChange(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleRemoveImage = () => {
    onImageChange(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isValid = image !== null && description.trim().length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="size-8"
            disabled={isLoading}
          >
            <ArrowLeft className="size-4" />
          </Button>
          소유권 인증
        </DialogTitle>
        <DialogDescription>
          채널이 본인 소유임을 증명할 수 있는 자료를 제출해주세요.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>인증 이미지</Label>
          <p className="text-xs text-muted-foreground">
            방송 플랫폼 대시보드, 채널 관리 페이지 등 소유권을 확인할 수 있는
            스크린샷을 업로드해주세요.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            disabled={isLoading}
          />

          {previewUrl ? (
            <div className="relative rounded-lg overflow-hidden border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="인증 이미지 미리보기"
                className="w-full h-48 object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 size-8"
                onClick={handleRemoveImage}
                disabled={isLoading}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              <Upload className="size-6" />
              <span className="text-sm">이미지 업로드</span>
            </button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>부가 설명</Label>
            <span
              className={cn(
                "text-xs",
                description.length > 200
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {description.length}/200
            </span>
          </div>
          <Textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value.slice(0, 200))}
            placeholder="채널 소유권을 증명할 수 있는 추가 설명을 입력해주세요."
            rows={3}
            maxLength={200}
            disabled={isLoading}
          />
        </div>

        <div className="p-3 rounded-lg bg-muted/50 flex items-start gap-2">
          <ImageIcon className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            제출된 자료는 운영팀의 검토 후 인증이 완료됩니다. 검토에는 영업일
            기준 1~3일이 소요될 수 있습니다.
          </p>
        </div>

        <Button
          onClick={onSubmit}
          disabled={!isValid || isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              처리 중...
            </>
          ) : (
            "인증 요청하기"
          )}
        </Button>
      </div>
    </>
  );
}

// Step 2b: 본인 소유 아닐 때 안내
function NotOwnerStep({
  onBack,
  onClose,
  identifier,
}: {
  onBack: () => void;
  onClose: () => void;
  identifier: string;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} className="size-8">
            <ArrowLeft className="size-4" />
          </Button>
          채널 소유권 안내
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6 py-4">
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h3 className="font-medium text-amber-800 dark:text-amber-200">
                멜로밍 채널은 본인 소유의 채널로만 운영이 가능합니다
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                스트리머 본인이 직접 채널을 관리하거나, 스트리머에게 채널 소유권을
                이전해주세요.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium">소유권 이전 방법</h4>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>스트리머에게 멜로밍 계정 생성을 요청합니다.</li>
            <li>
              채널 관리 → 설정에서 &apos;채널 소유권 이전&apos; 기능을 사용합니다.
            </li>
            <li>스트리머의 멜로밍 계정으로 소유권을 이전합니다.</li>
            <li>이전 후 스트리머가 직접 채널 인증을 진행합니다.</li>
          </ol>
        </div>

        <div className="flex gap-2">
          <Button onClick={onBack} variant="outline" className="flex-1">
            돌아가기
          </Button>
          <Button asChild className="flex-1">
            <Link
              href={`/channel/${identifier}/manage/channel-transfer`}
              onClick={onClose}
            >
              <ArrowRightLeft className="size-4 mr-2" />
              채널 이전하기
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}
