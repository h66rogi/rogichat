import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import { Calendar } from "@/meloming/shared/components/ui/calendar";
import { Calendar as CalendarIcon } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/meloming/shared/components/ui/radio-group";
import { Toggle } from "@/meloming/shared/components/ui/toggle";
import { TimePicker } from "@/meloming/shared/components/ui/time-picker";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/meloming/shared/components/ui/accordion";
import type {
  CreateScheduleRequest,
  UpdateScheduleRequest,
  Schedule,
  ScheduleVisibility,
  ScheduleStatus,
} from "@/meloming/domains/schedule/types/schedule";
import {
  useCreateChannelSchedule,
  useUpdateSchedule,
} from "@/meloming/domains/schedule/hooks/use-schedules";
import { toast } from "sonner";

interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: number;
  schedule?: Schedule;
  initialDate?: Date;
  /**
   * 생성 모드에서 폼을 미리 채우기 위한 초기값 (예: 일정 복제).
   * schedule이 없을 때만 적용되며, startAt으로 날짜/시간 상태도 함께 시드한다.
   */
  initialValues?: Partial<CreateScheduleRequest>;
  onSuccess?: () => void;
}

interface ScheduleFormData {
  title: string;
  content: string;
  allDay: boolean;
  visibility: ScheduleVisibility;
  location: string;
  externalUrl: string;
  status: ScheduleStatus | "";
}

export function ScheduleFormDialog({
  open,
  onOpenChange,
  channelId,
  schedule,
  initialDate: initialDateProp,
  initialValues,
  onSuccess,
}: ScheduleFormDialogProps) {
  const isEditMode = !!schedule;
  // 생성 모드에서만 prefill 적용 (수정 모드는 schedule이 진실의 원천)
  const prefill = !isEditMode ? initialValues : undefined;
  // 날짜/시간 로컬 상태
  const initialDate = useMemo(
    () =>
      schedule?.startAt
        ? new Date(schedule.startAt)
        : prefill?.startAt
        ? new Date(prefill.startAt)
        : initialDateProp ?? new Date(),
    [schedule?.startAt, prefill?.startAt, initialDateProp]
  );
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [time, setTime] = useState<string>(() => {
    const startAt = schedule?.startAt ?? prefill?.startAt;
    if (startAt) {
      const d = new Date(startAt);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return "09:00";
  });

  const createMutation = useCreateChannelSchedule();
  const updateMutation = useUpdateSchedule();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch,
  } = useForm<ScheduleFormData>({
    defaultValues: {
      title: schedule?.title ?? prefill?.title ?? "",
      content: schedule?.content ?? prefill?.content ?? "",
      allDay: schedule?.allDay ?? prefill?.allDay ?? false,
      visibility: schedule?.visibility ?? prefill?.visibility ?? "PUBLIC",
      location: schedule?.location ?? prefill?.location ?? "",
      externalUrl: schedule?.externalUrl ?? prefill?.externalUrl ?? "",
      status: schedule?.status ?? prefill?.status ?? "",
    },
  });

  const visibility = watch("visibility");
  const status = watch("status");
  const allDay = watch("allDay");

  // schedule prop이 변경될 때마다 날짜/시간 state 업데이트
  useEffect(() => {
    if (schedule?.startAt) {
      const d = new Date(schedule.startAt);
      setSelectedDate(d);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      setTime(`${hh}:${mm}`);
    } else if (initialDateProp) {
      setSelectedDate(initialDateProp);
    }
  }, [schedule?.startAt, initialDateProp]);

  // schedule prop이 변경될 때마다 form 초기화
  useEffect(() => {
    if (schedule) {
      reset({
        title: schedule.title ?? "",
        content: schedule.content ?? "",
        allDay: schedule.allDay ?? false,
        visibility: schedule.visibility ?? "PUBLIC",
        location: schedule.location ?? "",
        externalUrl: schedule.externalUrl ?? "",
        status: schedule.status ?? "",
      });
    }
  }, [schedule, reset]);

  // 생성 모드 prefill(복제 등): 다이얼로그가 열릴 때 form/날짜/시간 시드
  useEffect(() => {
    if (isEditMode || !prefill || !open) return;
    reset({
      title: prefill.title ?? "",
      content: prefill.content ?? "",
      allDay: prefill.allDay ?? false,
      visibility: prefill.visibility ?? "PUBLIC",
      location: prefill.location ?? "",
      externalUrl: prefill.externalUrl ?? "",
      status: prefill.status ?? "",
    });
    if (prefill.startAt) {
      const d = new Date(prefill.startAt);
      setSelectedDate(d);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      setTime(`${hh}:${mm}`);
    }
    // prefill 객체는 매 렌더 새로 생성될 수 있으므로 startAt/open으로 의존성 안정화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditMode, prefill?.startAt, reset]);

  // 상태가 미정이면 하루종일 강제
  useEffect(() => {
    if (status === "TBD" && !allDay) {
      setValue("allDay", true, { shouldDirty: true });
    }
  }, [status, allDay, setValue]);

  const isAllDayDisabled = status === "TBD";

  const onSubmit = async (data: ScheduleFormData) => {
    try {
      let hour = 0;
      let minute = 0;

      if (!data.allDay) {
        const [h, m] = time.split(":");
        hour = Number(h ?? 0);
        minute = Number(m ?? 0);
      }

      // ISO 8601 형식으로 UTC 시간 전송
      // 로컬 시간을 UTC로 변환
      const localDate = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        hour,
        minute,
        0,
        0
      );
      const startAtIso = localDate.toISOString();
      if (isEditMode && schedule) {
        const updateData: UpdateScheduleRequest = {
          title: data.title,
          content: data.content || undefined,
          startAt: startAtIso,
          endAt: undefined,
          allDay: data.allDay,
          visibility: data.visibility,
          location: data.location || undefined,
          externalUrl: data.externalUrl || undefined,
          status: data.status || undefined,
        };

        await updateMutation.mutateAsync({
          id: schedule.id,
          body: updateData,
        });

        toast.success("일정이 수정되었습니다.");
      } else {
        const createData: CreateScheduleRequest = {
          title: data.title,
          content: data.content || undefined,
          startAt: startAtIso,
          endAt: undefined,
          allDay: data.allDay,
          visibility: data.visibility,
          location: data.location || undefined,
          externalUrl: data.externalUrl || undefined,
          status: data.status || undefined,
        };

        await createMutation.mutateAsync({
          channelId,
          body: createData,
        });

        toast.success("일정이 추가되었습니다.");
      }

      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Failed to save schedule:", error);
      toast.error(
        isEditMode ? "일정 수정에 실패했습니다." : "일정 추가에 실패했습니다."
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-3">
          <DialogTitle>
            {isEditMode ? "일정 수정" : "새 일정 만들기"}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "일정 정보를 수정합니다."
              : "팬들과 공유할 일정을 추가해보세요"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 pt-2">
          {/* 제목 */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-semibold">
              제목 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="title"
              {...register("title", { required: "제목은 필수입니다." })}
              placeholder="예: 정기 방송, 팬미팅 등"
              className="h-11"
            />
            {errors.title && (
              <p className="text-sm text-red-500">{errors.title.message}</p>
            )}
          </div>

          {/* 상태 선택 - 카드 형태 */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">일정 유형</Label>
            <RadioGroup
              value={status}
              onValueChange={(v) =>
                setValue("status", v as ScheduleStatus, { shouldDirty: true })
              }
              className="grid grid-cols-3 sm:grid-cols-5 gap-2"
            >
              <label
                className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-primary/50 ${
                  status === "LIVE"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                    : "border-border"
                }`}
              >
                <RadioGroupItem value="LIVE" className="sr-only" />
                <span className="text-sm font-medium">방송시작</span>
              </label>
              <label
                className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-primary/50 ${
                  status === "COLLAB"
                    ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20"
                    : "border-border"
                }`}
              >
                <RadioGroupItem value="COLLAB" className="sr-only" />
                <span className="text-sm font-medium">합방</span>
              </label>
              <label
                className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-primary/50 ${
                  status === "OFF"
                    ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border"
                }`}
              >
                <RadioGroupItem value="OFF" className="sr-only" />
                <span className="text-sm font-medium">휴방</span>
              </label>
              <label
                className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-primary/50 ${
                  status === "ETC"
                    ? "border-slate-500 bg-slate-50 dark:bg-slate-900/20"
                    : "border-border"
                }`}
              >
                <RadioGroupItem value="ETC" className="sr-only" />
                <span className="text-sm font-medium">기타</span>
              </label>
              <label
                className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-primary/50 ${
                  status === "TBD"
                    ? "border-gray-400 bg-gray-50 dark:bg-gray-800/20"
                    : "border-border"
                }`}
              >
                <RadioGroupItem value="TBD" className="sr-only" />
                <span className="text-sm font-medium">미정</span>
              </label>
            </RadioGroup>
          </div>

          {/* 날짜 & 시간 */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">날짜 및 시간</Label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    className="justify-start text-left font-normal h-11 flex-1"
                  >
                    <CalendarIcon className="mr-2 size-4" />
                    {selectedDate.toLocaleDateString("ko-KR", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => d && setSelectedDate(d)}
                    defaultMonth={selectedDate}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex items-center gap-2">
                {!allDay && (
                  <TimePicker
                    value={time}
                    onChange={setTime}
                    className="w-[130px]"
                    use12Hour
                  />
                )}
                <Toggle
                  pressed={allDay}
                  onPressedChange={(on) =>
                    setValue("allDay", on, { shouldDirty: true })
                  }
                  disabled={isAllDayDisabled}
                  variant="outline"
                  className="h-11 px-4"
                >
                  하루 종일
                </Toggle>
              </div>
            </div>
            {status === "TBD" && (
              <p className="text-xs text-muted-foreground">
                💡 미정 일정은 하루 종일로 설정됩니다
              </p>
            )}
          </div>

          {/* 공개 설정 */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30 gap-1">
            <div className="space-y-0.5">
              <Label className="text-sm font-semibold">공개 설정</Label>
              <p className="text-xs text-muted-foreground">
                {visibility === "PRIVATE"
                  ? "이 일정은 나만 볼 수 있습니다"
                  : "모든 팬들이 이 일정을 볼 수 있습니다"}
              </p>
            </div>
            <div className="flex items-center gap-2 min-w-18">
              <span className="text-sm text-muted-foreground">
                {visibility === "PUBLIC" ? "공개" : "비공개"}
              </span>
              <Switch
                id="visibilitySwitch"
                checked={visibility === "PRIVATE"}
                onCheckedChange={(checked) =>
                  setValue("visibility", checked ? "PRIVATE" : "PUBLIC", {
                    shouldDirty: true,
                  })
                }
              />
            </div>
          </div>

          {/* 추가 옵션 */}
          <Accordion
            type="single"
            collapsible
            className="border rounded-lg"
            defaultValue=""
          >
            <AccordionItem value="optional" className="border-0">
              <AccordionTrigger className="px-4 hover:no-underline hover:bg-muted/50">
                <span className="text-sm font-semibold">
                  추가 정보 (설명, 장소, 링크 등)
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="content" className="text-sm">
                      설명
                    </Label>
                    <Textarea
                      id="content"
                      {...register("content")}
                      placeholder="일정에 대한 자세한 설명을 입력하세요"
                      rows={3}
                      className="resize-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location" className="text-sm">
                      장소
                    </Label>
                    <Input
                      id="location"
                      {...register("location")}
                      placeholder="예: 온라인, 서울 등"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="externalUrl" className="text-sm">
                      외부 링크
                    </Label>
                    <Input
                      id="externalUrl"
                      type="url"
                      {...register("externalUrl")}
                      placeholder="https://..."
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              className="flex-1 sm:flex-none"
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 sm:flex-none ml-0 sm:ml-2"
            >
              {isSubmitting
                ? "저장 중..."
                : isEditMode
                ? "수정하기"
                : "추가하기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
