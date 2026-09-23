import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/meloming/shared/components/ui/button";
import { Plus, Settings } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import { ScheduleFormDialog } from "@/meloming/domains/schedule/components/schedule-form-dialog";
import { ScheduleDetailDialog } from "@/meloming/domains/schedule/components/schedule-detail-dialog";
import {
  useChannel,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import { useChannelProfile } from "@/meloming/domains/channel-profile";
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import type {
  CalendarClipRecord,
  CalendarSetlistSummary,
} from "@/meloming/domains/calendar/types/channel-calendar";
import { WeeklyScheduleViewer } from "@/meloming/domains/schedule/components/weekly-schedule-viewer";
import NoticeAlert from "@/meloming/domains/channel/components/section/notice-alert";

export default function ScheduleSection({
  hideHeading = false,
  fitCalendarToViewport = false,
}: {
  hideHeading?: boolean;
  fitCalendarToViewport?: boolean;
}) {
  const { user } = useParams();
  const router = useRouter();

  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [formInitialDate, setFormInitialDate] = useState<Date | undefined>(undefined);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(
    null
  );
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);

  const { data: userData } = useChannel(user as string);
  const { data: userPermission } = useChannelPermission(user as string);
  const { data: profile } = useChannelProfile(userData?.id ?? 0, {
    enabled: !!userData?.id,
  });

  const canEdit =
    userPermission?.isOwner || userPermission?.manageContent || false;
  const showSectionHeader = !hideHeading || (canEdit && !fitCalendarToViewport);

  // 기념일을 CalendarAnniversary 형태로 변환
  const anniversaries = useMemo((): CalendarAnniversary[] => {
    if (!profile?.anniversaries || !userData) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result: CalendarAnniversary[] = [];
    const anniversariesData = profile.anniversaries;

    // 생일 기념일
    if (anniversariesData.birthday) {
      const birthdayDate = new Date(today);
      birthdayDate.setDate(
        birthdayDate.getDate() + anniversariesData.birthday.daysUntilBirthday
      );

      result.push({
        id: `birthday-${userData.id}`,
        channelId: userData.id,
        channelName: userData.name,
        webPath: userData.webPath,
        profileImageUrl: userData.profileImageUrl,
        themeColor: userData.themeColor,
        type: "birthday",
        label: `생일 (${anniversariesData.birthday.birthdayDate})`,
        date: birthdayDate.toISOString(),
        daysUntil: anniversariesData.birthday.daysUntilBirthday,
      });
    }

    // 방송 마일스톤 기념일
    if (anniversariesData.milestones) {
      const milestoneDate = new Date(today);
      milestoneDate.setDate(
        milestoneDate.getDate() + anniversariesData.milestones.daysToMilestone
      );

      result.push({
        id: `milestone-${userData.id}`,
        channelId: userData.id,
        channelName: userData.name,
        webPath: userData.webPath,
        profileImageUrl: userData.profileImageUrl,
        themeColor: userData.themeColor,
        type: "broadcast",
        label: anniversariesData.milestones.nextMilestone,
        date: milestoneDate.toISOString(),
        daysUntil: anniversariesData.milestones.daysToMilestone,
      });
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.anniversaries,
    userData?.id,
    userData?.name,
    userData?.webPath,
    userData?.profileImageUrl,
    userData?.themeColor,
  ]);

  const handleScheduleClick = (schedule: Schedule) => {
    setSelectedSchedule(schedule);
    setIsDetailDialogOpen(true);
  };

  const handleEmptyClick = (date: Date) => {
    setFormInitialDate(date);
    setIsFormDialogOpen(true);
  };

  const handleSetlistClick = (setlist: CalendarSetlistSummary) => {
    if (!user) return;
    router.push(`/channel/${user as string}/setlist/${setlist.sessionId}`);
  };

  /**
   * Task 1.11 — DayDetailSheet 의 노래 클립 카드 클릭 시 클립 상세 페이지로 이동.
   * 클립 라우트: `/clip/[clipId]` (전역). 채널 컨텍스트 없이 단일 페이지로 이동.
   */
  const handleClipClick = (clip: CalendarClipRecord) => {
    router.push(`/clip/${clip.id}`);
  };

  const handleSuccess = () => {
    // React Query mutation hooks invalidate relevant queries globally.
    // The weekly viewer will refetch automatically.
  };

  return (
    <div
      id="channel-schedule"
      className={cn(
        "channel-box",
        fitCalendarToViewport && "flex min-h-0 flex-col"
      )}
    >
      {showSectionHeader && (
        <div
          id="channel-schedule-header"
          className={cn(
            "mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between",
            fitCalendarToViewport && "px-4 pt-3 md:px-5"
          )}
        >
          <div>
            {!hideHeading && (
              <>
                <h2 className="text-2xl font-bold paperlogy channel-section-title">
                  캘린더
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  방송 일정 · 방송 기록 · 노래 방송 · 기념일을 한눈에
                </p>
              </>
            )}
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Link href={`/channel/${user}/manage/schedule-settings`}>
                <Button variant="outline" className="md:w-auto md:px-4">
                  <Settings className="size-4 md:mr-2" />
                  <span className="hidden md:inline">일정 관리</span>
                </Button>
              </Link>
              <Button
                onClick={() => setIsFormDialogOpen(true)}
                className="md:w-auto md:px-4 flex-1 md:flex-initial"
              >
                <Plus className="size-4 mr-2" />
                일정 추가
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 일정 공지 */}
      {userData?.scheduleNotice && !fitCalendarToViewport && (
        <div className={cn("mb-4", fitCalendarToViewport && "px-4 md:px-5")}>
          <NoticeAlert
            userId={user as string}
            userData={userData}
            type="schedule"
          />
        </div>
      )}

      {userData?.id && (
        <div
          id="channel-schedule-calendar"
          className={cn(fitCalendarToViewport && "min-h-0 flex-1")}
        >
          <WeeklyScheduleViewer
            channelId={userData.id}
            channelIdentifier={userData.webPath ?? String(userData.id)}
            onScheduleClick={handleScheduleClick}
            onEmptyClick={canEdit ? handleEmptyClick : undefined}
            anniversaries={anniversaries}
            onSetlistClick={handleSetlistClick}
            onClipClick={handleClipClick}
            fitCalendarToViewport={fitCalendarToViewport}
            manageHref={
              canEdit && fitCalendarToViewport
                ? `/channel/${user}/manage/schedule-settings`
                : undefined
            }
            notice={
              userData.scheduleNotice && fitCalendarToViewport ? (
                <NoticeAlert
                  userId={user as string}
                  userData={userData}
                  type="schedule"
                  integrated
                />
              ) : undefined
            }
          />
        </div>
      )}

      {/* 일정 추가 다이얼로그 */}
      {userData?.id && (
        <ScheduleFormDialog
          open={isFormDialogOpen}
          onOpenChange={(open) => {
            setIsFormDialogOpen(open);
            if (!open) setFormInitialDate(undefined);
          }}
          channelId={userData.id}
          initialDate={formInitialDate}
          onSuccess={handleSuccess}
        />
      )}

      {/* 일정 상세 다이얼로그 */}
      {selectedSchedule && userData?.id && (
        <ScheduleDetailDialog
          open={isDetailDialogOpen}
          onOpenChange={setIsDetailDialogOpen}
          schedule={selectedSchedule}
          channelId={userData.id}
          canEdit={canEdit}
          onSuccess={handleSuccess}
        />
      )}

    </div>
  );
}
