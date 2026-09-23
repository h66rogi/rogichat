'use client';

import { useState, useEffect, useMemo } from 'react';
import { CalendarCog, Loader2, Check, AlertCircle, Repeat, Megaphone, Download, Upload } from 'lucide-react';
import { useChannel, useUpdateChannelScheduleNotice } from '@/meloming/domains/channel/hooks/use-channel';
import {
  useRecurringSchedules,
  useSaveRecurringSchedules,
} from '@/meloming/domains/schedule/hooks/use-recurring-schedules';
import type {
  RecurringScheduleItem,
  RecurringScheduleStatus,
} from '@/meloming/domains/schedule/types/recurring-schedule';
import { Button } from '@/meloming/shared/components/ui/button';
import { Input } from '@/meloming/shared/components/ui/input';
import { Label } from '@/meloming/shared/components/ui/label';
import { Switch } from '@/meloming/shared/components/ui/switch';
import { Textarea } from '@/meloming/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/meloming/shared/components/ui/select';
import { Alert, AlertDescription } from '@/meloming/shared/components/ui/alert';
import { ManagementHeader } from '@/meloming/domains/channel/components/management/management-header';
import { ChannelInfoEditModal } from '@/meloming/domains/channel/components/section/channel-info-edit-modal';
import { useChannelProfile } from '@/meloming/domains/channel-profile';
import { PillTabs, type PillTabItem } from '@/meloming/shared/components/ui/pill-tabs';
import {
  SettingsPanel,
  SettingsRow,
} from '@/meloming/shared/components/common/settings-form';
import {
  ScheduleImportDialog,
  ScheduleExportDialog,
} from '@/meloming/domains/schedule/components/schedule-import-export-dialog';
import { toast } from 'sonner';

type ScheduleSettingsTab = 'recurring' | 'notice' | 'import-export';

const SCHEDULE_SETTINGS_TABS: PillTabItem<ScheduleSettingsTab>[] = [
  { id: 'recurring', label: '반복 일정', icon: Repeat },
  { id: 'notice', label: '일정 공지', icon: Megaphone },
  { id: 'import-export', label: '가져오기/내보내기', icon: Download },
];

const DAYS_OF_WEEK = [
  { value: 0, label: '일요일', short: '일' },
  { value: 1, label: '월요일', short: '월' },
  { value: 2, label: '화요일', short: '화' },
  { value: 3, label: '수요일', short: '수' },
  { value: 4, label: '목요일', short: '목' },
  { value: 5, label: '금요일', short: '금' },
  { value: 6, label: '토요일', short: '토' },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = (i % 2) * 30;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
});

interface DayScheduleState {
  isActive: boolean;
  title: string;
  status: RecurringScheduleStatus;
  startTime: string;
}

interface ScheduleSettingsContentProps {
  user: string;
}

export function ScheduleSettingsContent({ user }: ScheduleSettingsContentProps) {
  const [activeTab, setActiveTab] = useState<ScheduleSettingsTab>('recurring');
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

  const { data: channelData } = useChannel(user);
  const channelId = channelData?.id;
  const { data: profile } = useChannelProfile(channelId ?? 0, { enabled: !!channelId });

  const { data: recurringData, isLoading: isRecurringLoading } = useRecurringSchedules(
    channelId ?? 0,
    { enabled: !!channelId }
  );

  const saveRecurringMutation = useSaveRecurringSchedules();
  const updateNoticeMutation = useUpdateChannelScheduleNotice(user);

  // 반복 일정 상태
  const [daySchedules, setDaySchedules] = useState<Record<number, DayScheduleState>>(() => {
    const initial: Record<number, DayScheduleState> = {};
    DAYS_OF_WEEK.forEach((day) => {
      initial[day.value] = {
        isActive: false,
        title: '정기 방송',
        status: 'LIVE',
        startTime: '20:00',
      };
    });
    return initial;
  });

  // 일정 공지 상태
  const [noticeContent, setNoticeContent] = useState('');

  // 서버 데이터 로드
  useEffect(() => {
    if (recurringData?.items) {
      setDaySchedules((prev) => {
        const updated = { ...prev };
        DAYS_OF_WEEK.forEach((day) => {
          updated[day.value] = {
            isActive: false,
            title: '정기 방송',
            status: 'LIVE',
            startTime: '20:00',
          };
        });
        recurringData.items.forEach((item) => {
          updated[item.dayOfWeek] = {
            isActive: item.isActive,
            title: item.title,
            status: item.status,
            startTime: item.startTime ?? '20:00',
          };
        });
        return updated;
      });
    }
  }, [recurringData]);

  useEffect(() => {
    if (channelData) {
      setNoticeContent(channelData.scheduleNotice ?? '');
    }
  }, [channelData]);

  // 변경 여부 확인
  const hasRecurringChanges = useMemo(() => {
    const serverItems = recurringData?.items ?? [];
    const serverMap = new Map(
      serverItems.map((item) => [item.dayOfWeek, item])
    );

    for (const day of DAYS_OF_WEEK) {
      const local = daySchedules[day.value];
      const server = serverMap.get(day.value);

      // 활성화 상태 변경 체크
      if (local.isActive !== (server?.isActive ?? false)) return true;

      // 활성화된 경우 세부 설정 변경 체크
      if (local.isActive) {
        if (!server) return true; // 서버에 없는데 로컬에서 활성화
        if (local.title !== server.title) return true;
        if (local.status !== server.status) return true;
        if (local.status === 'LIVE' && local.startTime !== (server.startTime ?? '20:00')) return true;
      }
    }

    return false;
  }, [daySchedules, recurringData]);

  const hasNoticeChanges = useMemo(() => {
    const currentNotice = channelData?.scheduleNotice ?? '';
    return currentNotice !== noticeContent;
  }, [noticeContent, channelData?.scheduleNotice]);

  const handleDayToggle = (dayOfWeek: number, isActive: boolean) => {
    setDaySchedules((prev) => ({
      ...prev,
      [dayOfWeek]: { ...prev[dayOfWeek], isActive },
    }));
  };

  const handleStatusChange = (dayOfWeek: number, status: RecurringScheduleStatus) => {
    setDaySchedules((prev) => {
      const current = prev[dayOfWeek];
      // 휴방으로 변경 시 이름을 "정기 휴방"으로, 방송으로 변경 시 "정기 방송"으로
      const newTitle = status === 'OFF'
        ? (current.title === '정기 방송' ? '정기 휴방' : current.title)
        : (current.title === '정기 휴방' ? '정기 방송' : current.title);
      return {
        ...prev,
        [dayOfWeek]: { ...current, status, title: newTitle },
      };
    });
  };

  const handleDayChange = (
    dayOfWeek: number,
    field: 'title' | 'startTime',
    value: string
  ) => {
    setDaySchedules((prev) => ({
      ...prev,
      [dayOfWeek]: { ...prev[dayOfWeek], [field]: value },
    }));
  };

  const handleSaveRecurring = async () => {
    if (!channelId) return;

    const schedules: RecurringScheduleItem[] = DAYS_OF_WEEK.map((day) => {
      const state = daySchedules[day.value];
      return {
        dayOfWeek: day.value,
        title: state.title,
        status: state.status,
        startTime: state.status === 'OFF' ? null : state.startTime,
        isActive: state.isActive,
      };
    }).filter((s) => s.isActive);

    try {
      await saveRecurringMutation.mutateAsync({
        channelId,
        body: { schedules },
      });
      toast.success('반복 일정이 저장되었습니다');
    } catch {
      toast.error('반복 일정 저장에 실패했습니다');
    }
  };

  const handleSaveNotice = async () => {
    try {
      const noticeValue = noticeContent.trim() || null;
      await updateNoticeMutation.mutateAsync(noticeValue);
      toast.success('일정 공지가 저장되었습니다');
    } catch {
      toast.error('일정 공지 저장에 실패했습니다');
    }
  };

  return (
    <div className="p-6">
      <ManagementHeader
        title="일정 설정"
        description="반복 일정과 일정 공지를 설정합니다."
        icon={CalendarCog}
      />

      {channelId && (
        <div className="mb-6">
          <Button variant="outline" onClick={() => setIsProfileDialogOpen(true)}>
            생일·데뷔일 설정
          </Button>
          <ChannelInfoEditModal
            open={isProfileDialogOpen}
            onOpenChange={setIsProfileDialogOpen}
            channelId={channelId}
            profile={profile}
          />
        </div>
      )}

      <PillTabs
        tabs={SCHEDULE_SETTINGS_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="mb-6"
      />

      {activeTab === 'recurring' && (
        <SettingsPanel contentClassName="p-4">
          <Alert className="mb-4">
            <AlertCircle className="size-4" />
            <AlertDescription>
              설정한 요일에 자동으로 일정이 생성됩니다. 저장 시 기존에 자동 생성된
              미래 일정은 삭제되고 새로 생성됩니다.
            </AlertDescription>
          </Alert>

          {isRecurringLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="py-2">
              {DAYS_OF_WEEK.map((day) => {
                const state = daySchedules[day.value];
                return (
                  <SettingsRow
                    key={day.value}
                    title={day.label}
                    description={
                      state.isActive
                        ? '반복 일정 생성 대상입니다'
                        : '자동 생성하지 않습니다'
                    }
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      <Switch
                        checked={state.isActive}
                        onCheckedChange={(checked) =>
                          handleDayToggle(day.value, checked)
                        }
                      />

                      {state.isActive && (
                        <>
                          <div className="flex items-center gap-2">
                            <Label className="text-sm text-muted-foreground whitespace-nowrap">
                              이름
                            </Label>
                            <Input
                              value={state.title}
                              onChange={(e) =>
                                handleDayChange(day.value, 'title', e.target.value)
                              }
                              placeholder="정기 방송"
                              className="h-9 w-32"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <Label className="text-sm text-muted-foreground whitespace-nowrap">
                              종류
                            </Label>
                            <Select
                              value={state.status}
                              onValueChange={(value) =>
                                handleStatusChange(day.value, value as RecurringScheduleStatus)
                              }
                            >
                              <SelectTrigger className="h-9 w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="LIVE">방송</SelectItem>
                                <SelectItem value="OFF">휴방</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {state.status === 'LIVE' && (
                            <div className="flex items-center gap-2">
                              <Label className="text-sm text-muted-foreground whitespace-nowrap">
                                시작 시간
                              </Label>
                              <Select
                                value={state.startTime}
                                onValueChange={(value) =>
                                  handleDayChange(day.value, 'startTime', value)
                                }
                              >
                                <SelectTrigger className="h-9 w-24">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIME_OPTIONS.map((time) => (
                                    <SelectItem key={time} value={time}>
                                      {time}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </SettingsRow>
                );
              })}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              onClick={handleSaveRecurring}
              disabled={saveRecurringMutation.isPending || !hasRecurringChanges}
            >
              {saveRecurringMutation.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Check className="size-4 mr-2" />
              )}
              저장
            </Button>
          </div>
        </SettingsPanel>
      )}

      {activeTab === 'notice' && (
        <SettingsPanel contentClassName="p-4">
          <div className="space-y-4">
            <SettingsRow
              title="공지 내용"
              description="채널 일정 페이지 상단에 표시됩니다. 비워두면 표시되지 않습니다."
            >
                <Textarea
                  value={noticeContent}
                  onChange={(e) => setNoticeContent(e.target.value)}
                  placeholder="예: 이번 주는 개인 사정으로 휴방합니다."
                  rows={4}
                  className="resize-none"
                />
            </SettingsRow>

              <div className="flex gap-3">
                <Button
                  onClick={handleSaveNotice}
                  disabled={updateNoticeMutation.isPending || !hasNoticeChanges}
                >
                  {updateNoticeMutation.isPending ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="size-4 mr-2" />
                  )}
                  저장
                </Button>
              </div>
            </div>
        </SettingsPanel>
      )}

      {activeTab === 'import-export' && (
        <SettingsPanel contentClassName="p-4">
          <div>
            <SettingsRow
              title="일정 가져오기"
              description="외부 캘린더에서 일정을 가져옵니다. (ICS 파일)"
            >
                <Button
                  variant="outline"
                  onClick={() => setIsImportDialogOpen(true)}
                >
                  <Download className="size-4 mr-2" />
                  가져오기
                </Button>
            </SettingsRow>

            <SettingsRow
              title="일정 내보내기"
              description="일정을 외부 캘린더로 내보냅니다. (ICS 파일)"
            >
                <Button
                  variant="outline"
                  onClick={() => setIsExportDialogOpen(true)}
                >
                  <Upload className="size-4 mr-2" />
                  내보내기
                </Button>
            </SettingsRow>
          </div>
        </SettingsPanel>
      )}

      {/* 가져오기 다이얼로그 */}
      <ScheduleImportDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
      />

      {/* 내보내기 다이얼로그 */}
      <ScheduleExportDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
      />
    </div>
  );
}
