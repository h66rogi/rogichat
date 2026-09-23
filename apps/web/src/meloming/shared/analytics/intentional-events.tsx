"use client";

import { useEffect, useRef } from "react";

type IntentEventPropertyValue = string | number | boolean | null | undefined;
type IntentEventProperties = Record<
  string,
  IntentEventPropertyValue | IntentEventPropertyValue[]
>;

export function captureIntentEvent(
  eventName: string,
  properties: IntentEventProperties = {},
): void {
  // Original event call sites remain in copied UI. Rogichat does not use
  // Meloming's analytics project or event identifiers.
  void eventName;
  void properties;
}

export function useIntentPageView(
  eventName: string,
  properties: IntentEventProperties = {},
): void {
  const capturedRef = useRef(false);

  useEffect(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    captureIntentEvent(eventName, properties);
  }, [eventName, properties]);
}
