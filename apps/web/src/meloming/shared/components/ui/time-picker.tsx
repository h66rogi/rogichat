import { useState, useEffect } from "react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import { Clock, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

interface TimePickerProps {
  value: string; // "HH:mm" 형식
  onChange: (value: string) => void;
  className?: string;
  use12Hour?: boolean; // 12시간 형식 사용 여부
}

const STORAGE_KEY = "timepicker_recent_times";
const DEFAULT_TIMES = ["08:00", "18:00", "20:00"];
const MAX_RECENT = 6;

// 로컬스토리지에서 최근 시간 가져오기
function getRecentTimes(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : DEFAULT_TIMES;
    }
  } catch {
    // 파싱 실패 시 기본값
  }
  return DEFAULT_TIMES;
}

// 로컬스토리지에 최근 시간 저장 (큐 방식, 중복 제거)
function saveRecentTime(time: string) {
  try {
    const recent = getRecentTimes();
    // 중복 제거
    const filtered = recent.filter((t) => t !== time);
    // 맨 앞에 추가
    const updated = [time, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // 저장 실패 시 무시
  }
}

export function TimePicker({
  value,
  onChange,
  className,
  use12Hour = false,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("12");
  const [minutes, setMinutes] = useState("00");
  const [period, setPeriod] = useState<"AM" | "PM">("AM");
  const [recentTimes, setRecentTimes] = useState<string[]>(DEFAULT_TIMES);
  const [isEditingHours, setIsEditingHours] = useState(false);
  const [isEditingMinutes, setIsEditingMinutes] = useState(false);

  // value 파싱
  useEffect(() => {
    const [h, m] = value.split(":");
    if (h && m) {
      const hourNum = parseInt(h);
      if (use12Hour) {
        // 24시간 → 12시간 + AM/PM 변환
        if (hourNum === 0) {
          setHours("12");
          setPeriod("AM");
        } else if (hourNum < 12) {
          setHours(String(hourNum).padStart(2, "0"));
          setPeriod("AM");
        } else if (hourNum === 12) {
          setHours("12");
          setPeriod("PM");
        } else {
          setHours(String(hourNum - 12).padStart(2, "0"));
          setPeriod("PM");
        }
      } else {
        setHours(h.padStart(2, "0"));
      }
      setMinutes(m.padStart(2, "0"));
    }
  }, [value, use12Hour]);

  // 최근 시간 로드
  useEffect(() => {
    setRecentTimes(getRecentTimes());
  }, []);

  const handleApply = () => {
    let finalHour = parseInt(hours);

    if (use12Hour) {
      // 12시간 → 24시간 변환
      if (period === "PM" && finalHour < 12) {
        finalHour += 12;
      } else if (period === "AM" && finalHour === 12) {
        finalHour = 0;
      }
    }

    const selectedTime = `${String(finalHour).padStart(2, "0")}:${minutes}`;
    onChange(selectedTime);
    saveRecentTime(selectedTime);
    setRecentTimes(getRecentTimes());
    setOpen(false);
  };

  const incrementHours = () => {
    const maxHour = use12Hour ? 12 : 23;
    const minHour = use12Hour ? 1 : 0;
    let h = parseInt(hours) + 1;
    if (h > maxHour) h = minHour;
    setHours(String(h).padStart(2, "0"));
  };

  const decrementHours = () => {
    const maxHour = use12Hour ? 12 : 23;
    const minHour = use12Hour ? 1 : 0;
    let h = parseInt(hours) - 1;
    if (h < minHour) h = maxHour;
    setHours(String(h).padStart(2, "0"));
  };

  const incrementMinutes = () => {
    const m = (parseInt(minutes) + 5) % 60;
    setMinutes(String(m).padStart(2, "0"));
  };

  const decrementMinutes = () => {
    const m = (parseInt(minutes) - 5 + 60) % 60;
    setMinutes(String(m).padStart(2, "0"));
  };

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "");
    if (val === "") {
      setHours("");
      return;
    }
    const num = parseInt(val);
    const maxHour = use12Hour ? 12 : 23;
    if (num >= 0 && num <= maxHour) {
      setHours(val);
    }
  };

  const handleHoursBlur = () => {
    setIsEditingHours(false);
    if (hours === "" || hours === "0") {
      setHours(use12Hour ? "12" : "00");
    } else if (hours.length === 1) {
      setHours(hours.padStart(2, "0"));
    }
  };

  const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "");
    if (val === "") {
      setMinutes("");
      return;
    }
    const num = parseInt(val);
    if (num >= 0 && num <= 59) {
      setMinutes(val);
    }
  };

  const handleMinutesBlur = () => {
    setIsEditingMinutes(false);
    if (minutes === "" || minutes === "0") {
      setMinutes("00");
    } else if (minutes.length === 1) {
      setMinutes(minutes.padStart(2, "0"));
    }
  };

  const handleQuickSelect = (time: string) => {
    const [h, m] = time.split(":");
    if (h && m) {
      setHours(h);
      setMinutes(m);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("justify-start text-left font-normal h-11", className)}
        >
          <Clock className="mr-2 size-4" />
          {value}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-3" align="start">
        <div className="space-y-3">
          <div className="text-sm font-semibold text-center">시간 선택</div>

          {/* AM/PM 선택 (12시간 모드일 때만) */}
          {use12Hour && (
            <div className="flex items-center justify-center gap-1">
              <Button
                type="button"
                variant={period === "AM" ? "default" : "outline"}
                size="sm"
                className="h-8 flex-1"
                onClick={() => setPeriod("AM")}
              >
                오전
              </Button>
              <Button
                type="button"
                variant={period === "PM" ? "default" : "outline"}
                size="sm"
                className="h-8 flex-1"
                onClick={() => setPeriod("PM")}
              >
                오후
              </Button>
            </div>
          )}

          <div className="flex items-center justify-center gap-2">
            {/* 시 */}
            <div className="flex flex-col items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-10 p-0"
                onClick={incrementHours}
              >
                <ChevronUp className="size-4" />
              </Button>
              {isEditingHours ? (
                <Input
                  type="text"
                  value={hours}
                  onChange={handleHoursChange}
                  onBlur={handleHoursBlur}
                  className="w-14 h-10 text-center !text-2xl font-bold p-0 border-0 focus-visible:ring-1"
                  style={{ fontSize: "1.5rem" }}
                  autoFocus
                  maxLength={2}
                />
              ) : (
                <div
                  className="text-2xl font-bold w-14 h-10 flex items-center justify-center cursor-pointer hover:bg-muted rounded"
                  onClick={() => setIsEditingHours(true)}
                >
                  {hours}
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-10 p-0"
                onClick={decrementHours}
              >
                <ChevronDown className="size-4" />
              </Button>
              <div className="text-xs text-muted-foreground mt-1">시</div>
            </div>

            <div className="text-2xl font-bold pb-6">:</div>

            {/* 분 */}
            <div className="flex flex-col items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-10 p-0"
                onClick={incrementMinutes}
              >
                <ChevronUp className="size-4" />
              </Button>
              {isEditingMinutes ? (
                <Input
                  type="text"
                  value={minutes}
                  onChange={handleMinutesChange}
                  onBlur={handleMinutesBlur}
                  className="w-14 h-10 text-center !text-2xl font-bold p-0 border-0 focus-visible:ring-1"
                  style={{ fontSize: "1.5rem" }}
                  autoFocus
                  maxLength={2}
                />
              ) : (
                <div
                  className="text-2xl font-bold w-14 h-10 flex items-center justify-center cursor-pointer hover:bg-muted rounded"
                  onClick={() => setIsEditingMinutes(true)}
                >
                  {minutes}
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-10 p-0"
                onClick={decrementMinutes}
              >
                <ChevronDown className="size-4" />
              </Button>
              <div className="text-xs text-muted-foreground mt-1">분</div>
            </div>
          </div>

          {/* 빠른 선택 */}
          {(() => {
            const nonDefaultTimes = recentTimes.filter(
              (t) => !DEFAULT_TIMES.includes(t)
            );

            // 최근 선택이 있으면 최근 선택만, 없으면 기본 프리셋만
            if (nonDefaultTimes.length > 0) {
              return (
                <div className="pt-2 border-t space-y-2">
                  <div className="text-xs text-muted-foreground">최근 선택</div>
                  <div className="grid grid-cols-3 gap-1">
                    {nonDefaultTimes.map((time) => (
                      <Button
                        key={time}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleQuickSelect(time)}
                      >
                        {time}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            } else {
              return (
                <div className="pt-2 border-t">
                  <div className="grid grid-cols-3 gap-1">
                    {DEFAULT_TIMES.map((time) => (
                      <Button
                        key={time}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleQuickSelect(time)}
                      >
                        {time}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            }
          })()}

          <Button
            type="button"
            className="w-full"
            size="sm"
            onClick={handleApply}
          >
            확인
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
