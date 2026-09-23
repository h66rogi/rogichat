"use client";

import { cn } from "@/shared/lib/cn";
import { sanitizeSyncPostHtml } from "./html-sanitizer";

type WardrobeRichDescriptionProps = {
  description?: string | null;
  className?: string;
};

export function WardrobeRichDescription({
  description,
  className,
}: WardrobeRichDescriptionProps) {
  const value = description?.trim();
  if (!value) return null;

  if (value.includes("<")) {
    return (
      <div
        className={cn(
          "content-view prose prose-neutral max-w-none dark:prose-invert",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: sanitizeSyncPostHtml(value) }}
      />
    );
  }

  return (
    <p
      className={cn(
        "whitespace-pre-wrap leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {value}
    </p>
  );
}
