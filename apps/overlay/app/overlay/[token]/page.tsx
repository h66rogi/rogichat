'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

interface WidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WidgetConfig {
  id: string;
  name: string;
  enabled: boolean;
  position: WidgetPosition;
}

export default function OverlayPage() {
  const params = useParams();
  const token = params.token as string;

  const [widgets, setWidgets] = useState<WidgetConfig[]>([
    {
      id: 'queue',
      name: '신청곡 목록',
      enabled: true,
      position: { x: window.innerWidth - 420, y: 20, width: 400, height: 600 },
    },
    {
      id: 'now-playing',
      name: '현재 재생중',
      enabled: true,
      position: { x: 20, y: window.innerHeight - 220, width: 600, height: 200 },
    },
  ]);

  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (widgetId: string, e: React.MouseEvent) => {
    const widget = widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    setDragging(widgetId);
    setDragOffset({
      x: e.clientX - widget.position.x,
      y: e.clientY - widget.position.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;

    setWidgets((prev) =>
      prev.map((widget) =>
        widget.id === dragging
          ? {
              ...widget,
              position: {
                ...widget.position,
                x: e.clientX - dragOffset.x,
                y: e.clientY - dragOffset.y,
              },
            }
          : widget
      )
    );
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  return (
    <div
      className="fixed inset-0 w-screen h-screen"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 위젯 캔버스 */}
      {widgets
        .filter((widget) => widget.enabled)
        .map((widget) => (
          <div
            key={widget.id}
            className="absolute border-2 border-dashed border-white/20 bg-black/50 backdrop-blur-sm rounded-lg cursor-move"
            style={{
              left: widget.position.x,
              top: widget.position.y,
              width: widget.position.width,
              height: widget.position.height,
            }}
            onMouseDown={(e) => handleMouseDown(widget.id, e)}
          >
            <div className="p-4 h-full flex flex-col">
              <div className="text-white font-bold mb-2">{widget.name}</div>
              <div className="flex-1 flex items-center justify-center text-white/50">
                {widget.id === 'queue' && (
                  <div className="text-center">
                    <div className="text-sm">신청곡 목록 위젯</div>
                    <div className="text-xs mt-2">
                      실제 구현 시 신청곡 목록이 표시됩니다
                    </div>
                  </div>
                )}
                {widget.id === 'now-playing' && (
                  <div className="text-center">
                    <div className="text-sm">현재 재생중 위젯</div>
                    <div className="text-xs mt-2">
                      실제 구현 시 현재 곡 정보가 표시됩니다
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

      {/* 설정 버튼 */}
      <a
        href={`/overlay/${token}/settings`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-4 right-4 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg backdrop-blur-sm transition-colors"
      >
        설정
      </a>

      {/* Token 정보 (디버그용) */}
      <div className="fixed top-4 left-4 text-white/30 text-xs">
        Token: {token}
      </div>
    </div>
  );
}
