"use client";

import { useState, useEffect } from "react";
import { Button } from "@/meloming/shared/components/ui/button";
import { ChevronUp } from "lucide-react";

const SCROLL_THRESHOLD = 300; // 300px 스크롤 시 버튼 표시

export default function ScrollToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      const shouldShow = window.scrollY > SCROLL_THRESHOLD;
      setIsVisible(shouldShow);
    };

    // 초기 상태 설정
    toggleVisibility();

    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  if (!isVisible) return null;

  return (
    <Button
      onClick={scrollToTop}
      size="icon"
      variant="outline"
      className="fixed bottom-[var(--floating-side-button-bottom)] right-6 z-50 h-12 w-12 rounded-full shadow-lg transition-all duration-300 hover:scale-110 hover:shadow-xl"
      aria-label="맨 위로 가기"
    >
      <ChevronUp className="h-5 w-5" />
    </Button>
  );
}
