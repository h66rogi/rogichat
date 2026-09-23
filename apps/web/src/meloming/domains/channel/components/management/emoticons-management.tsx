"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Clock,
  Loader2,
  Plus,
  ShieldCheck,
  ShieldX,
  Smile,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Progress } from "@/meloming/shared/components/ui/progress";
import { ManagementHeader } from "./management-header";
import { UploadEmoticonModal } from "./upload-emoticon-modal";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { useMyEmoticons } from "@/meloming/domains/emoticon/hooks/use-my-emoticons";
import { useDeleteEmoticon } from "@/meloming/domains/emoticon/hooks/use-emoticon-mutations";
import type {
  ChannelEmoticon,
  EmoticonStatus,
} from "@/meloming/domains/emoticon/types";

const MAX_ACTIVE_EMOTICONS = 10;

// UPLOADING / PENDING / APPROVED 는 "슬롯을 차지"하는 상태로 간주.
// REJECTED 는 활성 슬롯에서 제외 (사용자가 삭제 후 재업로드해야 함)
const ACTIVE_STATUSES: ReadonlySet<EmoticonStatus> = new Set([
  "UPLOADING",
  "PENDING",
  "APPROVED",
]);

interface StatusBadgeProps {
  status: EmoticonStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case "UPLOADING":
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          업로드 중…
        </Badge>
      );
    case "PENDING":
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="size-3" />
          검수 대기
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge
          variant="outline"
          className="gap-1 text-emerald-600 border-emerald-500/40 bg-emerald-500/10"
        >
          <ShieldCheck className="size-3" />
          사용 가능
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge variant="destructive" className="gap-1">
          <ShieldX className="size-3" />
          반려됨
        </Badge>
      );
    default:
      return null;
  }
}

interface EmoticonCardProps {
  emoticon: ChannelEmoticon;
  onDelete: (id: number) => void;
  isDeleting: boolean;
}

function EmoticonCard({ emoticon, onDelete, isDeleting }: EmoticonCardProps) {
  return (
    <Card className="py-4">
      <CardContent className="px-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-16 h-16 rounded-md border bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={emoticon.imageUrl}
              alt={`:${emoticon.shortcode}:`}
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-sm break-all">
              :{emoticon.shortcode}:
            </p>
            <div className="mt-1">
              <StatusBadge status={emoticon.status} />
            </div>
          </div>
        </div>

        {emoticon.status === "REJECTED" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-1">
            {emoticon.rejectionReason ? (
              <p>
                <span className="font-medium">반려 사유: </span>
                {emoticon.rejectionReason}
              </p>
            ) : (
              <p className="font-medium">반려된 이모티콘입니다.</p>
            )}
            <p className="text-muted-foreground">
              삭제 후 재업로드해주세요.
            </p>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onDelete(emoticon.id)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          삭제
        </Button>
      </CardContent>
    </Card>
  );
}

interface EmoticonsManagementProps {
  /**
   * 명시적으로 channelId를 전달할 수 있다. 현재는 URL 파라미터(`identifier`)를
   * 통해 `useChannel`로 해석하지만, 상위에서 주입하는 형태로 바꿀 여지를 둔다.
   */
  channelId?: number;
}

export function EmoticonsManagement({ channelId: propChannelId }: EmoticonsManagementProps = {}) {
  const params = useParams();
  const identifier = (params?.user as string) || "";

  // channel-manage-content는 `user` 식별자만 넘겨주므로 이 컴포넌트에서 id를 해석한다
  const { data: channel, isLoading: isChannelLoading } = useChannel(identifier, {
    enabled: !!identifier && propChannelId === undefined,
  });

  const channelId = propChannelId ?? channel?.id;

  const {
    data: emoticons,
    isLoading: isListLoading,
    error: listError,
  } = useMyEmoticons(channelId);

  const deleteMutation = useDeleteEmoticon(channelId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const activeCount = useMemo(() => {
    return (emoticons ?? []).filter((e) => ACTIVE_STATUSES.has(e.status)).length;
  }, [emoticons]);

  const isAtLimit = activeCount >= MAX_ACTIVE_EMOTICONS;
  const isLoading = isChannelLoading || isListLoading;

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("이모티콘을 삭제했습니다.");
    } catch (error: unknown) {
      const message = extractApiErrorMessage(
        error,
        "이모티콘 삭제에 실패했습니다."
      );
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  // 목록 조회 실패
  if (listError && !isLoading) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="이모티콘"
          description="채널 전용 커스텀 이모티콘을 관리합니다."
          icon={Smile}
        />
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            이모티콘 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="이모티콘"
        description="채널 전용 커스텀 이모티콘을 관리합니다."
        icon={Smile}
      >
        <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 text-[10px] font-bold">
          PRO
        </Badge>
      </ManagementHeader>

      <div className="space-y-4">
        {/* 카운터 + 업로드 버튼 */}
        <Card>
          <CardContent className="px-6 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-col sm:flex-row sm:items-center">
              <div className="space-y-1">
                <p
                  className="text-sm font-medium"
                  data-testid="emoticon-counter"
                >
                  {activeCount} / {MAX_ACTIVE_EMOTICONS}
                </p>
                <p className="text-xs text-muted-foreground">
                  활성 이모티콘 개수입니다. 검수 대기/사용 가능 상태가 슬롯을
                  차지합니다.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setUploadOpen(true)}
                disabled={isAtLimit || !channelId}
                data-testid="emoticon-upload-button"
              >
                <Plus className="size-4" />
                이모티콘 추가
              </Button>
            </div>
            <Progress
              value={Math.min(100, (activeCount / MAX_ACTIVE_EMOTICONS) * 100)}
            />
            {isAtLimit && (
              <p className="text-xs text-muted-foreground">
                최대 {MAX_ACTIVE_EMOTICONS}개까지 등록할 수 있습니다. 기존
                이모티콘을 삭제한 후 추가해주세요.
              </p>
            )}
          </CardContent>
        </Card>

        {/* 그리드 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (emoticons ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-10 px-6 text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
                <Smile className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">
                등록된 이모티콘이 없어요.
              </p>
              <p className="text-xs text-muted-foreground">
                첫 이모티콘을 올려보세요.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div
            className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="emoticon-grid"
          >
            {(emoticons ?? []).map((emoticon) => (
              <EmoticonCard
                key={emoticon.id}
                emoticon={emoticon}
                onDelete={handleDelete}
                isDeleting={deletingId === emoticon.id}
              />
            ))}
          </div>
        )}
      </div>

      <UploadEmoticonModal
        channelId={channelId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
    </div>
  );
}
