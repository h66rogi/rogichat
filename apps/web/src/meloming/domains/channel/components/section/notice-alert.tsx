import { CircleAlert, Megaphone } from "lucide-react";
import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { SkeletonNoticeAlert } from "@/meloming/shared/components/skeleton";
import type { Channel as PublicUser } from "@/meloming/domains/channel/types/channel";
import { cn } from "@/meloming/shared/lib/utils";

type NoticeType = "channel" | "schedule";

interface NoticeAlertProps {
  userId: string;
  userData?: PublicUser; // userData가 전달되면 API 호출하지 않음
  type?: NoticeType; // 기본값: "channel"
  integrated?: boolean;
}

export default function NoticeAlert({
  userId,
  userData,
  type = "channel",
  integrated = false,
}: NoticeAlertProps) {
  const {
    data: user,
    isLoading,
    error,
  } = useChannel(userId, {
    enabled: !userData, // userData가 없을 때만 API 호출
  });

  // 전달받은 userData 우선 사용, 없으면 API 호출 결과 사용
  const userInfo = userData || user;

  if (!userData && isLoading) {
    return <SkeletonNoticeAlert />;
  }

  if (!userData && (error || !user)) {
    return null;
  }

  // type에 따라 표시할 내용 결정
  const content =
    type === "schedule"
      ? userInfo?.scheduleNotice
      : userInfo?.channelDescription;

  if (!userInfo || !content) {
    return null;
  }

  const Icon = type === "schedule" ? Megaphone : CircleAlert;

  return (
    <Alert
      variant="default"
      className={cn(integrated && "rounded-none border-0")}
      style={{
        backgroundColor: `${userInfo.themeColor}20`,
        color: `${userInfo.themeColor}90`,
        ...(integrated ? {} : { borderColor: `${userInfo.themeColor}90` }),
      }}
    >
      <Icon strokeWidth={2.5} size={24} className="mt-0.5" />
      <AlertDescription className="text-foreground text-base whitespace-pre-line">
        {content}
      </AlertDescription>
    </Alert>
  );
}
