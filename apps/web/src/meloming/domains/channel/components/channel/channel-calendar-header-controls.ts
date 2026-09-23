"use client";

import { useSyncExternalStore } from "react";

export type ChannelCalendarViewMode = "week" | "month";

export type ChannelCalendarHeaderControls = {
  title: string;
  viewMode: ChannelCalendarViewMode;
  isFetching: boolean;
  selectedDate: Date;
  defaultMonth: Date;
  manageHref?: string;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDateSelect: (date: Date | undefined) => void;
  onViewModeChange: (mode: ChannelCalendarViewMode) => void;
};

let currentControls: ChannelCalendarHeaderControls | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setChannelCalendarHeaderControls(
  controls: ChannelCalendarHeaderControls | null
) {
  currentControls = controls;
  emit();

  return () => {
    if (currentControls === controls) {
      currentControls = null;
      emit();
    }
  };
}

export function useChannelCalendarHeaderControls() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentControls,
    () => null
  );
}
