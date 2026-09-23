"use client";

import { useCallback, useEffect, useState } from "react";
import { TOOL_BY_SHORTCUT, type ToolId } from "./tool-types";

/**
 * 활성 도구 + 단축키 핸들링.
 *
 * Photoshop 패리티:
 *  - 단일 키 (V/M/T/U 등) 로 도구 전환
 *  - input/textarea 포커스 시엔 단축키 비활성 (텍스트 입력 방해 방지)
 *  - Cmd/Ctrl 같은 modifier 가 있으면 무시 (다른 단축키와 충돌 회피)
 *  - 일부 도구는 hold-to-temporarily-activate (스페이스 → Hand) — viewport 가 이미 처리하므로 여기선 미구현
 */
export function useTool(initial: ToolId = "move") {
  const [activeTool, setActiveTool] = useState<ToolId>(initial);

  const handleSetActiveTool = useCallback((next: ToolId) => {
    setActiveTool(next);
  }, []);

  useEffect(() => {
    const isFormControl = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el as HTMLElement).isContentEditable === true
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isFormControl(document.activeElement)) return;
      const key = e.key.toLowerCase();
      const tool = TOOL_BY_SHORTCUT[key];
      if (!tool) return;
      e.preventDefault();
      setActiveTool(tool);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { activeTool, setActiveTool: handleSetActiveTool };
}
