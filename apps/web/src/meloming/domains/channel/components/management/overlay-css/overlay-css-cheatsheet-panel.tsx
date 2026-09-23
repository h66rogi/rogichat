'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { OverlayWidgetType } from '@/meloming/domains/channel/types/overlay-customization';

const EXAMPLES: Record<OverlayWidgetType, { label: string; code: string }[]> = {
  queue: [
    {
      label: '배경색 변경',
      code: `[data-overlay-widget="queue"] {\n  background: rgba(0,0,0,0.6);\n  border-radius: 16px;\n}`,
    },
    {
      label: '글씨 크기 키우기',
      code: `[data-overlay-widget="queue"] {\n  font-size: 1.2em;\n}`,
    },
  ],
  'now-playing': [
    {
      label: '그림자 추가',
      code: `[data-overlay-widget="now-playing"] {\n  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5));\n}`,
    },
  ],
  setlist: [
    {
      label: '투명 배경',
      code: `[data-overlay-widget="setlist"] {\n  background: transparent;\n}`,
    },
  ],
  'songbook-qr': [
    {
      label: '카드 배경 조정',
      code: `[data-overlay-widget="songbook-qr"] > div > div {\n  background: rgba(0,0,0,0.72);\n  border-color: rgba(255,255,255,0.35);\n}`,
    },
    {
      label: 'QR 테두리 강조',
      code: `[data-overlay-widget="songbook-qr"] img {\n  border: 4px solid #fff;\n}`,
    },
  ],
};

export function OverlayCssCheatsheetPanel({
  widget,
}: {
  widget: OverlayWidgetType;
}) {
  const [open, setOpen] = useState(true);
  const examples = EXAMPLES[widget];

  return (
    <div className="border rounded-lg p-4 text-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 font-semibold w-full text-left"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        선택자 치트시트 ({widget})
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="font-medium">루트 선택자</div>
            <code className="block bg-muted p-2 rounded mt-1">
              {`[data-overlay-widget="${widget}"]`}
            </code>
          </div>
          <div>
            <div className="font-medium mb-2">예시</div>
            {examples.map((ex) => (
              <div key={ex.label} className="mb-3">
                <div className="text-xs text-muted-foreground mb-1">
                  {ex.label}
                </div>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                  <code>{ex.code}</code>
                </pre>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            전체 문서: <code>docs/overlay-widget-css-selectors.md</code>
          </p>
        </div>
      )}
    </div>
  );
}
