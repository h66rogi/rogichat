"use client";

import { Clock, Undo, Redo } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import { useEditorContext } from "../state/editor-context";

/**
 * Photoshop 히스토리 패널.
 *
 * past + present + future 를 하나의 시간순 목록으로 표시. 현재 present 는 highlight.
 * past 의 위 entry 클릭 = undo 까지 점프. future 의 아래 entry 클릭 = redo 까지 점프.
 *
 * 라벨은 useEditorHistory 가 setState 호출 시 받은 옵션 label 사용.
 */
export function HistoryPanel() {
  const ctx = useEditorContext();
  const { historyEntries, historyCurrentIndex, jumpToHistory, undo, redo, canUndo, canRedo } = ctx;

  return (
    <div className="flex flex-col h-full">
      <div className="ps-panel-header flex items-center justify-between">
        <span>히스토리</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="ps-tool-button"
            style={{ width: 22, height: 22 }}
            title="실행 취소 (⌘Z)"
            aria-label="실행 취소"
          >
            <Undo className="size-3" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="ps-tool-button"
            style={{ width: 22, height: 22 }}
            title="다시 실행 (⌘⇧Z)"
            aria-label="다시 실행"
          >
            <Redo className="size-3" />
          </button>
        </div>
      </div>
      <div className="ps-panel-body">
        {historyEntries.length <= 1 ? (
          <p className="text-[11px] p-3 text-[var(--ps-text-muted)]">
            편집을 시작하면 히스토리가 쌓입니다.
          </p>
        ) : (
          <ul>
            {historyEntries.map((entry, idx) => {
              const isCurrent = idx === historyCurrentIndex;
              const isFuture = idx > historyCurrentIndex;
              return (
                <li key={`${idx}:${entry.at}`}>
                  <button
                    type="button"
                    onClick={() => jumpToHistory(idx)}
                    className={cn(
                      "ps-row w-full text-left",
                      isCurrent && "is-selected",
                      isFuture && "opacity-50",
                    )}
                  >
                    <Clock
                      className="size-3 mr-1.5 shrink-0"
                      style={{ color: "var(--ps-text-muted)" }}
                    />
                    <span className="flex-1 truncate">{entry.label}</span>
                    <span className="text-[10px]" style={{ color: "var(--ps-text-muted)" }}>
                      {formatTime(entry.at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
