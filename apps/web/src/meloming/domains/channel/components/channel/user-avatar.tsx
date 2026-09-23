"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/meloming/shared/components/ui/avatar";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

interface UserAvatarProps {
  userName: string;
  profileImageUrl?: string | null;
  className?: string;
  fallbackStyle?: React.CSSProperties;
}

export default function UserAvatar({
  userName,
  profileImageUrl,
  className = "",
  fallbackStyle,
}: UserAvatarProps) {
  const [isEasterEggActive, setIsEasterEggActive] = useState(false);

  const clickCountRef = useRef(0);
  const lastClickTimeRef = useRef<number | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deactivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Constants for easter egg behavior
  const TARGET_CLICKS = 10;
  const MAX_INTERVAL_BETWEEN_CLICKS_MS = 800; // 연속 클릭 인정 간격
  const ACTIVE_DURATION_MS = 5000; // 5초 유지

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (deactivateTimerRef.current) clearTimeout(deactivateTimerRef.current);
    };
  }, []);

  const handleClick = () => {
    const now = Date.now();
    const last = lastClickTimeRef.current;

    if (last === null || now - last <= MAX_INTERVAL_BETWEEN_CLICKS_MS) {
      clickCountRef.current += 1;
    } else {
      clickCountRef.current = 1;
    }
    lastClickTimeRef.current = now;

    // Reset sequence after inactivity
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0;
      lastClickTimeRef.current = null;
    }, MAX_INTERVAL_BETWEEN_CLICKS_MS);

    if (clickCountRef.current >= TARGET_CLICKS) {
      clickCountRef.current = 0;
      lastClickTimeRef.current = null;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }

      setIsEasterEggActive(true);

      if (deactivateTimerRef.current) clearTimeout(deactivateTimerRef.current);
      deactivateTimerRef.current = setTimeout(() => {
        setIsEasterEggActive(false);
      }, ACTIVE_DURATION_MS);
    }
  };

  return (
    <Avatar
      id="channel-avatar-image"
      className={clsx(
        "w-30 h-30 rounded-full border-4 sm:border-6 border-background flex-shrink-0 object-cover select-none transition-all bg-background origin-center z-0",
        isEasterEggActive
          ? "scale-[10] duration-[5000ms] z-[999]"
          : "hover:scale-105 duration-300 z-0",
        className
      )}
      onClick={handleClick}
    >
      <AvatarImage src={profileImageUrl ?? undefined} />
      <AvatarFallback style={fallbackStyle}>
        {userName ? userName.slice(0, 1) : "?"}
      </AvatarFallback>
    </Avatar>
  );
}
