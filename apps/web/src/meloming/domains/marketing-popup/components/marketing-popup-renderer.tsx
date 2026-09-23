/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import type { MarketingPopup } from "../types/marketing-popup";
import {
  recordPopupClick,
  recordPopupClose,
  recordPopupDismiss,
} from "../apis/marketing-popups";

interface MarketingPopupRendererProps {
  popup: MarketingPopup;
  isVisible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onExitComplete?: () => void;
}

const animationVariants = {
  FADE: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  SLIDE: {
    initial: { opacity: 0, y: 50 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 50 },
  },
  SCALE: {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9 },
  },
  NONE: {
    initial: {},
    animate: {},
    exit: {},
  },
};

const dismissLabels: Record<string, string> = {
  TODAY: "오늘 하루 보지 않기",
  FOREVER: "다시 보지 않기",
  PERIOD: "일정 기간 보지 않기",
};

export function MarketingPopupRenderer({
  popup,
  isVisible,
  onClose,
  onDismiss,
  onExitComplete,
}: MarketingPopupRendererProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleLinkClick = useCallback(() => {
    recordPopupClick(popup.id).catch(() => {});
    if (popup.linkUrl) {
      if (popup.linkOpenInNew) {
        window.open(popup.linkUrl, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = popup.linkUrl;
      }
    }
  }, [popup]);

  const handleClose = useCallback(() => {
    recordPopupClose(popup.id).catch(() => {});
    onClose();
  }, [popup.id, onClose]);

  const handleDismiss = useCallback(() => {
    recordPopupDismiss(popup.id).catch(() => {});
    onDismiss();
  }, [popup.id, onDismiss]);

  if (!isMounted) return null;

  const imageUrl = isDark && popup.imageDarkUrl ? popup.imageDarkUrl : popup.imageUrl;
  const variants = animationVariants[popup.animationType] || animationVariants.FADE;
  const overlayBg = `rgba(0, 0, 0, ${popup.overlayOpacity / 100})`;
  const hasLinkButton = Boolean(popup.linkUrl);
  const linkButtonLabel = popup.linkButtonText?.trim() || "링크 이동";

  // Position classes based on popup type
  const getPositionClasses = () => {
    switch (popup.popupType) {
      case "CENTER_MODAL":
        return "items-center justify-center";
      case "BOTTOM_SHEET":
        return "items-end justify-center";
      case "FULLSCREEN":
        return "items-center justify-center";
      case "SLIDE_IN":
        return "items-end justify-end";
      default:
        return "items-center justify-center";
    }
  };

  const getContentClasses = () => {
    switch (popup.popupType) {
      case "CENTER_MODAL":
        return "w-full max-w-md mx-4 rounded-xl";
      case "BOTTOM_SHEET":
        return "w-full max-w-lg rounded-t-xl sm:mx-4 sm:rounded-xl sm:mb-4";
      case "FULLSCREEN":
        return "w-full h-full sm:w-full sm:max-w-2xl sm:h-auto sm:mx-4 sm:rounded-xl";
      case "SLIDE_IN":
        return "w-80 max-w-[90vw] rounded-xl m-4";
      default:
        return "w-full max-w-md mx-4 rounded-xl";
    }
  };

  const slideVariants = popup.popupType === "BOTTOM_SHEET"
    ? {
        initial: { opacity: 0, y: "100%" },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: "100%" },
      }
    : popup.popupType === "SLIDE_IN"
      ? {
          initial: { opacity: 0, x: "100%" },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: "100%" },
        }
      : variants;

  const finalVariants = popup.animationType === "SLIDE" ? slideVariants : variants;

  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {isVisible && (
        <motion.div
          key={popup.id}
          className={`fixed inset-0 z-[9999] flex ${getPositionClasses()}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
        {/* Overlay */}
        <motion.div
          className="absolute inset-0"
          style={{ backgroundColor: overlayBg }}
          onClick={handleClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        {/* Content */}
        <motion.div
          className={`relative bg-background shadow-2xl overflow-hidden ${getContentClasses()}`}
          {...finalVariants}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {/* Popup content */}
          <div className="relative">
            {/* Image content */}
            {(popup.contentType === "IMAGE" || popup.contentType === "MIXED") &&
              imageUrl && (
                <div
                  className={popup.linkUrl ? "cursor-pointer" : ""}
                  onClick={popup.linkUrl ? handleLinkClick : undefined}
                >
                  <img
                    src={imageUrl}
                    alt={popup.imageAlt || popup.title}
                    className="w-full h-auto block"
                  />
                </div>
              )}

            {/* Rich text content */}
            {(popup.contentType === "RICH_TEXT" ||
              popup.contentType === "MIXED") &&
              popup.richTextContent && (
                <div
                  className="p-5 prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: popup.richTextContent }}
                />
              )}

            {/* Action buttons */}
            <div className="px-5 pb-4">
              {hasLinkButton ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleClose}
                    className="rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    닫기
                  </button>
                  <button
                    onClick={handleLinkClick}
                    className="rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {linkButtonLabel}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleClose}
                  className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  닫기
                </button>
              )}
            </div>
          </div>

          {/* Dismiss button area */}
          {popup.dismissType !== "CLOSE_ONLY" && (
            <div className="border-t border-border px-5 py-3">
              <button
                onClick={handleDismiss}
                className="w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {dismissLabels[popup.dismissType] || "닫기"}
              </button>
            </div>
          )}
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
