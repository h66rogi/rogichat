import {
  startOfWeek,
  endOfWeek,
  format,
  addWeeks,
  parseISO,
  eachDayOfInterval,
  getWeekOfMonth,
  addDays,
} from "date-fns";
import { ko } from "date-fns/locale";

export function getWeekStart(date: Date): string {
  const weekStartDate = startOfWeek(date, { weekStartsOn: 0 });
  // 해당 주 일요일 00:00:00 로컬 시간을 UTC ISO 8601로 변환
  const startDateTime = new Date(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth(),
    weekStartDate.getDate(),
    0,
    0,
    0,
    0
  );
  return startDateTime.toISOString();
}

export function getWeekEnd(date: Date): string {
  const weekEndDate = endOfWeek(date, { weekStartsOn: 0 });
  // 해당 주 토요일 23:59:59 로컬 시간을 UTC ISO 8601로 변환
  const endDateTime = new Date(
    weekEndDate.getFullYear(),
    weekEndDate.getMonth(),
    weekEndDate.getDate(),
    23,
    59,
    59,
    999
  );
  return endDateTime.toISOString();
}

export function getWeekNumber(weekStartDate: Date): string {
  const midWeekDate = addDays(
    startOfWeek(weekStartDate, { weekStartsOn: 0 }),
    3
  );
  const month = format(midWeekDate, "M", { locale: ko });
  const weekOfMonth = getWeekOfMonth(midWeekDate, { weekStartsOn: 0 });
  return `${month}월 ${weekOfMonth}주차`;
}

export function getPreviousWeek(start: string): string {
  const date = parseISO(start);
  const previousWeek = addWeeks(date, -1);
  return getWeekStart(previousWeek);
}

export function getNextWeek(start: string): string {
  const date = parseISO(start);
  const nextWeek = addWeeks(date, 1);
  return getWeekStart(nextWeek);
}

export function getWeekDays(weekStart: string): Date[] {
  const startDate = parseISO(weekStart);
  const endDate = endOfWeek(startDate, { weekStartsOn: 0 });

  return eachDayOfInterval({
    start: startDate,
    end: endDate,
  });
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}
