import { useCallback, useEffect, useRef, useState } from "react";

interface UseClipboardReturn {
  copy: (text: string) => Promise<boolean>;
  isCopying: boolean;
  copiedText: string | null;
  error: string | null;
}

function isNavigatorClipboardAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
}

function copyTextWithFallback(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

export function useClipboard(): UseClipboardReturn {
  const [isCopying, setIsCopying] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // Track mount to avoid setting state on unmounted component
  // Helpful in cases where copy is awaited and component unmounts quickly
  // (e.g., route changes)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    setIsCopying(true);
    setError(null);
    try {
      if (isNavigatorClipboardAvailable()) {
        await navigator.clipboard.writeText(text);
        if (isMountedRef.current) setCopiedText(text);
        return true;
      }

      const ok = copyTextWithFallback(text);
      if (!ok) throw new Error("Clipboard copy failed");
      if (isMountedRef.current) setCopiedText(text);
      return true;
    } catch (e) {
      if (isMountedRef.current) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
      return false;
    } finally {
      if (isMountedRef.current) setIsCopying(false);
    }
  }, []);

  return { copy, isCopying, copiedText, error };
}
