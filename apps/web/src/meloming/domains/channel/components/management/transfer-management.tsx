"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRightLeft,
  Search,
  Send,
  AlertTriangle,
  Clock,
  X,
  Bell,
  Loader2,
} from "lucide-react";
import { ManagementHeader } from "./management-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/meloming/shared/components/ui/card";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/meloming/shared/components/ui/avatar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/meloming/shared/components/ui/alert";
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
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import {
  useChannel,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import {
  useCheckTransferTarget,
  useChannelTransferOutgoing,
  useChannelTransferMutations,
} from "@/meloming/domains/channel/hooks/use-channel-transfer";
import type { TransferTargetInfo } from "@/meloming/domains/channel/types/channel-transfer";

const REMIND_INTERVAL_HOURS = 24;

interface TransferManagementProps {
  showHeader?: boolean;
}

export function TransferManagement({ showHeader = true }: TransferManagementProps) {
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";
  const { data: channel } = useChannel(username);
  const { data: userPermission } = useChannelPermission(username);

  // State
  const [step, setStep] = useState<"search" | "confirm">("search");
  const [searchEmail, setSearchEmail] = useState("");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<TransferTargetInfo | null>(null);
  const [noteFromRequester, setNoteFromRequester] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Fetch pending outgoing transfer request from API
  const {
    data: pendingRequest,
    isLoading: isPendingLoading,
    refetch: refetchPending,
  } = useChannelTransferOutgoing(username, {
    enabled: !!username,
  });

  // Check if can remind (24 hours since last notification)
  const canRemind = useMemo(() => {
    if (!pendingRequest) return false;
    const lastNotified = new Date(pendingRequest.lastNotifiedAt);
    const now = new Date();
    const hoursSinceLastNotification =
      (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastNotification >= REMIND_INTERVAL_HOURS;
  }, [pendingRequest]);

  // Hooks
  const {
    data: targetInfo,
    isLoading: isSearching,
    error: searchError,
  } = useCheckTransferTarget(debouncedEmail, {
    enabled: debouncedEmail.length > 0 && debouncedEmail.includes("@"),
  });

  const { requestTransfer, remindTransfer, cancelTransfer } =
    useChannelTransferMutations();

  // Handlers
  const handleEmailSearch = () => {
    if (!searchEmail.includes("@")) {
      toast.error("유효한 이메일 주소를 입력해주세요.");
      return;
    }
    setDebouncedEmail(searchEmail.trim().toLowerCase());
  };

  const handleSelectTarget = () => {
    if (!targetInfo) return;
    setSelectedTarget(targetInfo);
    setStep("confirm");
  };

  const handleSubmitTransfer = async () => {
    if (!channel?.id || !selectedTarget) return;

    try {
      await requestTransfer.mutateAsync({
        identifier: String(channel.id),
        dto: {
          targetUserId: selectedTarget.userId,
          noteFromRequester: noteFromRequester || undefined,
        },
      });

      toast.success("채널 이전 요청이 전송되었습니다!", {
        description: "대상자에게 이메일이 발송되었습니다.",
      });

      // Reset form and refetch pending request
      setStep("search");
      setSearchEmail("");
      setDebouncedEmail("");
      setSelectedTarget(null);
      setNoteFromRequester("");
      refetchPending();
    } catch (error) {
      const description = extractApiErrorMessage(
        error,
        "잠시 후 다시 시도해주세요."
      );
      toast.error("이전 요청 실패", { description });
    }
  };

  const handleRemind = async () => {
    if (!pendingRequest) return;

    try {
      await remindTransfer.mutateAsync(pendingRequest.requestId);
      toast.success("재알림이 전송되었습니다!");
      refetchPending();
    } catch (error) {
      const description = extractApiErrorMessage(
        error,
        "잠시 후 다시 시도해주세요."
      );
      toast.error("재알림 전송 실패", { description });
    }
  };

  const handleCancel = async () => {
    if (!pendingRequest) return;

    try {
      await cancelTransfer.mutateAsync(pendingRequest.requestId);
      toast.success("이전 요청이 취소되었습니다.");
      refetchPending();
      setSearchEmail("");
      setDebouncedEmail("");
      setSelectedTarget(null);
      setNoteFromRequester("");
    } catch (error) {
      const description = extractApiErrorMessage(
        error,
        "잠시 후 다시 시도해주세요."
      );
      toast.error("취소 실패", { description });
    } finally {
      setShowCancelDialog(false);
    }
  };

  const handleBack = () => {
    setStep("search");
    setSelectedTarget(null);
    setNoteFromRequester("");
  };

  // Permission check
  if (userPermission && !userPermission.isOwner) {
    return (
      <div className={showHeader ? "p-6" : ""}>
        {showHeader && (
          <ManagementHeader
            title="채널 이전하기"
            description="다른 사용자에게 채널 소유권을 이전할 수 있습니다."
            icon={ArrowRightLeft}
          />
        )}
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed text-muted-foreground text-center">
          접근 권한이 없습니다.
          <br />
          (채널 소유자만 채널을 이전할 수 있습니다)
        </div>
      </div>
    );
  }

  // Loading state
  if (isPendingLoading) {
    return (
      <div className={showHeader ? "p-6" : ""}>
        {showHeader && (
          <ManagementHeader
            title="채널 이전하기"
            description="다른 사용자에게 채널 소유권을 이전할 수 있습니다."
            icon={ArrowRightLeft}
          />
        )}
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className={showHeader ? "p-6" : ""}>
      {showHeader && (
        <ManagementHeader
          title="채널 이전하기"
          description="다른 사용자에게 채널 소유권을 이전할 수 있습니다."
          icon={ArrowRightLeft}
        />
      )}

      <Alert variant="destructive" className="mb-6">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>주의</AlertTitle>
        <AlertDescription className="space-y-1">
          <p>
            채널 이전 시 모든 소유권과 관리 권한이 대상자에게 넘어갑니다. 이
            작업은 되돌릴 수 없으니 신중하게 진행해주세요.
          </p>
          <p className="font-medium">
            채널 인증 정보가 해제되며, 새 소유자가 다시 인증해야 합니다.
          </p>
        </AlertDescription>
      </Alert>

      {/* Pending Request (from API) */}
      {pendingRequest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              이전 요청 대기 중
            </CardTitle>
            <CardDescription>
              대상자가 요청을 수락하면 채널 소유권이 이전됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 mb-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={pendingRequest.target.profileImageUrl || undefined} />
                    <AvatarFallback>
                      {(pendingRequest.target.nickname || pendingRequest.target.email)
                        .charAt(0)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {pendingRequest.target.nickname || "닉네임 없음"}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {pendingRequest.target.email}
                    </p>
                  </div>
                  <Badge variant="secondary">대기 중</Badge>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">요청일</span>
                    <span>
                      {new Date(pendingRequest.requestedAt).toLocaleDateString(
                        "ko-KR"
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">마지막 알림</span>
                    <span>
                      {new Date(pendingRequest.lastNotifiedAt).toLocaleString(
                        "ko-KR"
                      )}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleRemind}
                disabled={!canRemind || remindTransfer.isPending}
                className="flex-1"
              >
                <Bell className="h-4 w-4 mr-2" />
                {!canRemind
                  ? `${REMIND_INTERVAL_HOURS}시간 후 재알림 가능`
                  : remindTransfer.isPending
                  ? "전송 중..."
                  : "재알림 보내기"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowCancelDialog(true)}
              >
                <X className="h-4 w-4 mr-2" />
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Search Target (only when no pending request) */}
      {!pendingRequest && step === "search" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Step 1: 대상자 검색</CardTitle>
            <CardDescription>
              채널을 이전받을 사용자의 이메일 주소를 입력해주세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="target-email" className="sr-only">
                  대상자 이메일
                </Label>
                <Input
                  id="target-email"
                  type="email"
                  placeholder="example@email.com"
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleEmailSearch()}
                />
              </div>
              <Button
                onClick={handleEmailSearch}
                disabled={!searchEmail.includes("@") || isSearching}
              >
                <Search className="h-4 w-4 mr-2" />
                {isSearching ? "검색 중..." : "검색"}
              </Button>
            </div>

            {searchError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {extractApiErrorMessage(
                    searchError,
                    "사용자를 찾을 수 없습니다."
                  )}
                </AlertDescription>
              </Alert>
            )}

            {targetInfo && (
              <Card className="bg-muted/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={targetInfo.profileImageUrl || undefined} />
                      <AvatarFallback>
                        {(targetInfo.nickname || targetInfo.email)
                          .charAt(0)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {targetInfo.nickname || "닉네임 없음"}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {targetInfo.email}
                      </p>
                    </div>
                    <Button onClick={handleSelectTarget}>
                      선택
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Confirm Transfer (only when no pending request) */}
      {!pendingRequest && step === "confirm" && selectedTarget && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Step 2: 이전 신청</CardTitle>
            <CardDescription>
              아래 사용자에게 채널 소유권을 이전합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={selectedTarget.profileImageUrl || undefined} />
                    <AvatarFallback>
                      {(selectedTarget.nickname || selectedTarget.email)
                        .charAt(0)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {selectedTarget.nickname || "닉네임 없음"}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedTarget.email}
                    </p>
                  </div>
                  <Badge>이전 대상</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="note">메모 (선택사항)</Label>
              <Textarea
                id="note"
                placeholder="대상자에게 전달할 메모를 입력하세요..."
                value={noteFromRequester}
                onChange={(e) => setNoteFromRequester(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleBack}>
                뒤로
              </Button>
              <Button
                className="flex-1"
                onClick={handleSubmitTransfer}
                disabled={requestTransfer.isPending}
              >
                <Send className="h-4 w-4 mr-2" />
                {requestTransfer.isPending ? "처리 중..." : "이전 요청 보내기"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이전 요청 취소</AlertDialogTitle>
            <AlertDialogDescription>
              채널 이전 요청을 취소하시겠습니까? 대상자에게 취소 알림이
              전송됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelTransfer.isPending}
            >
              {cancelTransfer.isPending ? "취소 중..." : "요청 취소"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
