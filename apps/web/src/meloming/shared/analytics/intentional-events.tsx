"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";

type IntentEventPropertyValue = string | number | boolean | null | undefined;
type IntentEventProperties = Record<
  string,
  IntentEventPropertyValue | IntentEventPropertyValue[]
>;

export function captureIntentEvent(
  eventName: string,
  properties: IntentEventProperties = {},
): void {
  if (typeof window === "undefined") return;

  try {
    posthog.capture(eventName, {
      ...properties,
      product: "meloming_front",
      intent_schema_version: 1,
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? "qa",
    });
  } catch {
    // Analytics must never affect the product path.
  }
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
