"use client";

interface ZoomOptionsProps {
  // 줌 컨트롤은 viewport 가 직접 처리하므로 옵션바는 안내만.
}

export function ZoomOptions(_props: ZoomOptionsProps) {
  return (
    <span className="text-[11px] text-[var(--ps-text-muted)]">
      ⌘+휠 / ⌘0 맞춤 / ⌘1 100% / 스페이스+드래그 이동 — 마우스로 캔버스 조작
    </span>
  );
}
