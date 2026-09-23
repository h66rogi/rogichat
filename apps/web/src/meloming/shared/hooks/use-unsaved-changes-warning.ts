"use client";

import { useEffect } from "react";

/**
 * Registers a window 'beforeunload' handler while `enabled` is true.
 *
 * Browsers ignore the custom message — only the presence of the listener
 * (with `event.preventDefault()` + `event.returnValue = ''`) triggers the
 * native confirm dialog. We don't pass a message string.
 *
 * Out of scope: in-app router navigation (Next.js App Router has no stable
 * hook to intercept). The native dialog only fires on tab close, reload,
 * back/forward to a different origin, and address-bar URL changes.
 */
export function useUnsavedChangesWarning(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Modern browsers require setting returnValue for the prompt to show
      // (some legacy code uses 'return string' too — we don't need that).
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [enabled]);
}
