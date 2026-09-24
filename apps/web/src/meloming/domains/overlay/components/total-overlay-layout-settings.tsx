'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  LayoutDashboard,
  GripVertical,
  Eye,
  Copy,
  Magnet,
} from 'lucide-react';
import { Button } from '@/meloming/shared/components/ui/button';
import { Input } from '@/meloming/shared/components/ui/input';
import { Card, CardContent } from '@/meloming/shared/components/ui/card';
import { Switch } from '@/meloming/shared/components/ui/switch';
import { useOverlayLayout, useUpdateOverlayLayout } from '@/meloming/domains/channel/hooks/use-overlay-layouts';
import { toast } from 'sonner';
import { ManagementHeader } from '@/meloming/domains/channel/components/management/management-header';
import { cn } from '@/meloming/shared/lib/utils';
import { Rnd } from 'react-rnd';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DEFAULT_TOTAL_OVERLAY_LAYOUT,
  type TotalOverlayLayout,
  type TotalOverlayWidgetId,
} from '@/meloming/domains/overlay/constants/total-layout';
import {
  isValidWidgetType,
  type WidgetType,
} from '@/meloming/domains/channel/apis/overlay-theme';
import { ContextualHint, OBSSetupGuide } from './onboarding';
import { WidgetSettingsDialog } from './overlay-unified-settings/WidgetSettingsDialog';
import { CanvasIframePreview } from './overlay-unified-settings/CanvasIframePreview';
import { OverlayCopyGuideDialog } from './overlay-copy-guide-dialog';
import {
  SettingsRow,
  SettingsSectionHeader,
} from '@/meloming/shared/components/common/settings-form';

// URL을 초기에 블러 처리하고 클릭 시 노출하는 컴포넌트
function BlurredUrlField({
  value,
  onCopy,
  copied,
}: {
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex gap-2">
      <div
        className="relative flex-1 cursor-pointer"
        onClick={() => !revealed && setRevealed(true)}
      >
        <Input
          readOnly
          value={value}
          className={cn(
            'font-mono text-xs transition-[filter] duration-200',
            !revealed && 'blur-[6px] select-none',
          )}
        />
        {!revealed && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 pointer-events-none">
            <Eye className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">
              클릭하여 URL 표시
            </span>
          </div>
        )}
      </div>
      <Button size="icon" variant="outline" onClick={onCopy}>
        {copied ? (
          <Check className="size-4 text-green-500" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </div>
  );
}

const TOTAL_WIDGETS: TotalOverlayWidgetId[] = [
  'queue',
  'now-playing',
  'setlist',
  'songbook-qr',
];

const EMPTY_HIDDEN_WIDGET_IDS: readonly TotalOverlayWidgetId[] = [];

function readLayoutRevision(source: unknown): number | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as {
    layoutVersion?: unknown;
    totalLayoutVersion?: unknown;
  };
  const raw = record.layoutVersion ?? record.totalLayoutVersion;
  if (raw === undefined || raw === null) return null;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

const TOTAL_WIDGET_LABELS: Record<TotalOverlayWidgetId, string> = {
  queue: '신청곡 대기열',
  'now-playing': '지금 부르는 곡',
  setlist: '셋리스트',
  'songbook-qr': '노래책 QR',
};

const TOTAL_WIDGET_MIN_SIZES: Record<TotalOverlayWidgetId, { w: number; h: number }> = {
  queue: { w: 0.12, h: 0.2 },
  'now-playing': { w: 0.2, h: 0.1 },
  setlist: { w: 0.18, h: 0.25 },
  'songbook-qr': { w: 0.12, h: 0.16 },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const cloneTotalLayout = (layout: TotalOverlayLayout): TotalOverlayLayout => ({
  ...layout,
  widgets: layout.widgets.map((widget) => ({ ...widget })),
});

const mergeTotalLayout = (
  layout?: Partial<TotalOverlayLayout> | null,
  defaultLayout: TotalOverlayLayout = DEFAULT_TOTAL_OVERLAY_LAYOUT,
): TotalOverlayLayout => {
  if (!layout || typeof layout !== 'object') {
    return cloneTotalLayout(defaultLayout);
  }
  const widgets = Array.isArray(layout.widgets) ? layout.widgets : [];
  const widgetMap = new Map(
    widgets
      .filter((widget) => widget && typeof widget.id === 'string')
      .map((widget) => [widget.id, widget]),
  );

  const mergedWidgets = defaultLayout.widgets.map((widget) => ({
    ...widget,
    ...(widgetMap.get(widget.id as TotalOverlayWidgetId) ?? {}),
  }));

  return {
    ...defaultLayout,
    ...layout,
    widgets: mergedWidgets,
  };
};

const normalizeTotalLayout = (layout: TotalOverlayLayout): TotalOverlayLayout => ({
  ...layout,
  widgets: layout.widgets.map((widget) => ({
    ...widget,
    x: clamp01(widget.x),
    y: clamp01(widget.y),
    w: clamp01(widget.w),
    h: clamp01(widget.h),
    z: widget.z ?? 0,
  })),
});

const SNAP_THRESHOLD_PX = 6;

type SnapBox = { x: number; y: number; w: number; h: number };

interface SnapResult {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
}

/**
 * 캔버스 엣지·센터 + 타 위젯의 엣지·센터에 스냅.
 * widget 좌표는 0~1 정규화된 값이고, threshold는 정규화 단위로 받는다.
 * 리턴의 guideX/guideY는 스냅이 적용된 정규화 x/y 좌표 (가이드 라인 렌더용).
 */
function computeSnap(
  widget: SnapBox,
  others: SnapBox[],
  thresholdX: number,
  thresholdY: number,
): SnapResult {
  const candidatesX: number[] = [0, 0.5, 1];
  const candidatesY: number[] = [0, 0.5, 1];
  for (const o of others) {
    candidatesX.push(o.x, o.x + o.w / 2, o.x + o.w);
    candidatesY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }

  const refX = [widget.x, widget.x + widget.w / 2, widget.x + widget.w];
  const refY = [widget.y, widget.y + widget.h / 2, widget.y + widget.h];

  let bestDeltaX = 0;
  let bestGuideX: number | null = null;
  let minDistX = thresholdX;
  for (const r of refX) {
    for (const c of candidatesX) {
      const d = c - r;
      if (Math.abs(d) < minDistX) {
        minDistX = Math.abs(d);
        bestDeltaX = d;
        bestGuideX = c;
      }
    }
  }

  let bestDeltaY = 0;
  let bestGuideY: number | null = null;
  let minDistY = thresholdY;
  for (const r of refY) {
    for (const c of candidatesY) {
      const d = c - r;
      if (Math.abs(d) < minDistY) {
        minDistY = Math.abs(d);
        bestDeltaY = d;
        bestGuideY = c;
      }
    }
  }

  return {
    x: widget.x + bestDeltaX,
    y: widget.y + bestDeltaY,
    guideX: bestGuideX,
    guideY: bestGuideY,
  };
}

type ResizeDirection =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft'
  | 'topLeft';

interface ResizeSnapResult {
  x: number;
  y: number;
  w: number;
  h: number;
  guideX: number | null;
  guideY: number | null;
}

/**
 * 리사이즈 중인 엣지만 스냅. 반대편 엣지는 고정.
 * ex) right 엣지 이동 시 x는 그대로, w만 조정.
 */
function computeResizeSnap(
  box: SnapBox,
  direction: ResizeDirection,
  others: SnapBox[],
  thresholdX: number,
  thresholdY: number,
  minW: number,
  minH: number,
): ResizeSnapResult {
  const candidatesX: number[] = [0, 0.5, 1];
  const candidatesY: number[] = [0, 0.5, 1];
  for (const o of others) {
    candidatesX.push(o.x, o.x + o.w / 2, o.x + o.w);
    candidatesY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }

  let { x, y, w, h } = box;
  let guideX: number | null = null;
  let guideY: number | null = null;

  const movesLeft =
    direction === 'left' ||
    direction === 'topLeft' ||
    direction === 'bottomLeft';
  const movesRight =
    direction === 'right' ||
    direction === 'topRight' ||
    direction === 'bottomRight';
  const movesTop =
    direction === 'top' ||
    direction === 'topLeft' ||
    direction === 'topRight';
  const movesBottom =
    direction === 'bottom' ||
    direction === 'bottomLeft' ||
    direction === 'bottomRight';

  const findNearest = (ref: number, candidates: number[], threshold: number) => {
    let bestDelta = 0;
    let best: number | null = null;
    let minDist = threshold;
    for (const c of candidates) {
      const d = c - ref;
      if (Math.abs(d) < minDist) {
        minDist = Math.abs(d);
        bestDelta = d;
        best = c;
      }
    }
    return { delta: bestDelta, candidate: best };
  };

  if (movesLeft) {
    const { delta, candidate } = findNearest(x, candidatesX, thresholdX);
    if (candidate !== null) {
      const rightEdge = x + w;
      const nextX = x + delta;
      const nextW = rightEdge - nextX;
      if (nextW >= minW) {
        x = nextX;
        w = nextW;
        guideX = candidate;
      }
    }
  } else if (movesRight) {
    const rightEdge = x + w;
    const { delta, candidate } = findNearest(rightEdge, candidatesX, thresholdX);
    if (candidate !== null) {
      const nextW = w + delta;
      if (nextW >= minW) {
        w = nextW;
        guideX = candidate;
      }
    }
  }

  if (movesTop) {
    const { delta, candidate } = findNearest(y, candidatesY, thresholdY);
    if (candidate !== null) {
      const bottomEdge = y + h;
      const nextY = y + delta;
      const nextH = bottomEdge - nextY;
      if (nextH >= minH) {
        y = nextY;
        h = nextH;
        guideY = candidate;
      }
    }
  } else if (movesBottom) {
    const bottomEdge = y + h;
    const { delta, candidate } = findNearest(bottomEdge, candidatesY, thresholdY);
    if (candidate !== null) {
      const nextH = h + delta;
      if (nextH >= minH) {
        h = nextH;
        guideY = candidate;
      }
    }
  }

  return { x, y, w, h, guideX, guideY };
}

interface SortableWidgetItemProps {
  widget: TotalOverlayLayout['widgets'][number];
  isSelected: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}

function SortableWidgetItem({
  widget,
  isSelected,
  onSelect,
  onToggle,
}: SortableWidgetItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2 bg-background',
        isDragging && 'opacity-60',
        isSelected && 'border-primary/60 shadow-sm'
      )}
      onClick={onSelect}
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="flex-1 text-sm font-medium">
        {TOTAL_WIDGET_LABELS[widget.id]}
      </div>
      <Switch
        checked={widget.enabled}
        onCheckedChange={onToggle}
      />
    </div>
  );
}

export function TotalOverlayLayoutSettings({
  user,
  overlayToken,
  isTokenLoading,
  embedded = false,
  overlayPath = 'overlay',
  layoutType = 'total',
  defaultLayout = DEFAULT_TOTAL_OVERLAY_LAYOUT,
  widgetPreviewEnabled = true,
  hiddenWidgetIds = EMPTY_HIDDEN_WIDGET_IDS,
}: {
  user: string;
  overlayToken: string | null;
  isTokenLoading: boolean;
  embedded?: boolean;
  overlayPath?: string;
  layoutType?: string;
  defaultLayout?: TotalOverlayLayout;
  widgetPreviewEnabled?: boolean;
  hiddenWidgetIds?: readonly TotalOverlayWidgetId[];
}) {
  const overlayBaseUrl = process.env.NEXT_PUBLIC_OVERLAY_BASE_URL;
  const widgetWidth = 1920;
  const widgetHeight = 1080;
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [obsGuideUrl, setObsGuideUrl] = useState<string | null>(null);
  const [selectedWidgetId, setSelectedWidgetId] = useState<TotalOverlayWidgetId | null>(null);
  const [layout, setLayout] = useState<TotalOverlayLayout>(() => cloneTotalLayout(defaultLayout));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [settingsOpenFor, setSettingsOpenFor] = useState<WidgetType | null>(null);
  const [activeGuides, setActiveGuides] = useState<{ x: number | null; y: number | null }>(
    { x: null, y: null },
  );
  const snapEnabledRef = useRef(snapEnabled);
  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);
  const hiddenWidgetIdSet = useMemo(
    () => new Set<TotalOverlayWidgetId>(hiddenWidgetIds),
    [hiddenWidgetIds],
  );
  const allowedWidgetIds = useMemo(
    () => TOTAL_WIDGETS.filter((widgetId) => !hiddenWidgetIdSet.has(widgetId)),
    [hiddenWidgetIdSet],
  );

  // 드래그/리사이즈 중 ref 기반 스로틀 저장용
  const layoutRef = useRef(layout);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef<TotalOverlayLayout | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 로컬 변경 중 서버 데이터 동기화 억제 플래그 */
  const suppressSyncRef = useRef(false);
  const suppressSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRevisionRef = useRef<number | null>(null);

  const canvasRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const layoutQuery = useOverlayLayout(user, layoutType, Boolean(user));
  const updateLayoutMutation = useUpdateOverlayLayout(user, layoutType);
  const layoutData = layoutQuery.data;
  const isLayoutLoading = layoutQuery.isLoading;

  const applyLayoutSnapshot = useCallback((source: {
    layout?: TotalOverlayLayout | null;
    layoutVersion?: number | null;
    totalLayoutVersion?: number | null;
  }) => {
    if (!source.layout) return;
    const revision = readLayoutRevision(source);
    if (
      layoutRevisionRef.current !== null &&
      (revision === null || revision < layoutRevisionRef.current)
    ) {
      return;
    }
    if (revision !== null) {
      layoutRevisionRef.current = revision;
    }
    const next = mergeTotalLayout(source.layout, defaultLayout);
    layoutRef.current = next;
    setLayout(next);
  }, [defaultLayout]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (layoutData?.layout && !suppressSyncRef.current) {
      applyLayoutSnapshot(layoutData);
    }
  }, [applyLayoutSnapshot, layoutData]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      if (suppressSyncTimerRef.current) clearTimeout(suppressSyncTimerRef.current);
    };
  }, []);

  /** 내부 flush — 진행 중이 아니면 즉시 API 호출 */
  const flushSave = useCallback((data: TotalOverlayLayout) => {
    const runSave = (nextData: TotalOverlayLayout) => {
      // 로컬 변경이 시작되면 서버 동기화 억제
      suppressSyncRef.current = true;
      if (suppressSyncTimerRef.current) clearTimeout(suppressSyncTimerRef.current);

      if (isSavingRef.current) {
        pendingSaveRef.current = nextData;
        return;
      }

      isSavingRef.current = true;
      pendingSaveRef.current = null;
      setSaveState('saving');
      if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);

      const normalized = normalizeTotalLayout({
        ...nextData,
        widgets: nextData.widgets.map((widget) =>
          hiddenWidgetIdSet.has(widget.id) ? { ...widget, enabled: false } : widget,
        ),
      });
      updateLayoutMutation.mutate(normalized, {
        onSuccess: (saved) => {
          const revision = readLayoutRevision(saved);
          if (revision !== null) {
            layoutRevisionRef.current = revision;
          }
        },
        onSettled: () => {
          isSavingRef.current = false;
          const queued = pendingSaveRef.current;
          if (queued) {
            pendingSaveRef.current = null;
            // 저장 중 큐잉된 최신 값을 바로 이어서 저장
            runSave(queued);
            return;
          }
          setSaveState('saved');
          saveStateTimerRef.current = setTimeout(() => setSaveState('idle'), 1500);
          // mutation 후 refetch가 돌아올 시간을 확보한 뒤 동기화 재개
          suppressSyncTimerRef.current = setTimeout(() => {
            suppressSyncRef.current = false;
          }, 500);
        },
        onError: () => {
          toast.error('레이아웃 저장에 실패했습니다');
        },
      });
    };

    runSave(data);
  }, [hiddenWidgetIdSet, updateLayoutMutation]);

  /** 즉시 저장 — 제스처 종료(stop), 토글, 리셋 등에서 호출 */
  const saveLayout = useCallback((next: TotalOverlayLayout) => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    flushSave(next);
  }, [flushSave]);

  /** 스로틀 저장 — 드래그/리사이즈 중 150ms 간격으로 호출 (state 안 건드림) */
  const throttledSave = useCallback((next: TotalOverlayLayout) => {
    pendingSaveRef.current = next;
    if (throttleTimerRef.current) return; // 이미 타이머 진행 중
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      const data = pendingSaveRef.current;
      if (data) flushSave(data);
    }, 150);
  }, [flushSave]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const sortedWidgets = useMemo(
    () =>
      layout.widgets
        .filter((w) => allowedWidgetIds.includes(w.id))
        .sort((a, b) => (b.z ?? 0) - (a.z ?? 0)),
    [layout.widgets, allowedWidgetIds]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedWidgets.findIndex((w) => w.id === active.id);
    const newIndex = sortedWidgets.findIndex((w) => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedWidgets, oldIndex, newIndex);
    const reorderedIds = reordered.map((w) => w.id);

    setLayout((prev) => {
      const next = {
        ...prev,
        widgets: prev.widgets.map((w) => {
          const idx = reorderedIds.indexOf(w.id);
          if (idx === -1) return w;
          return { ...w, z: reorderedIds.length - idx };
        }),
      };
      saveLayout(next);
      return next;
    });
  };

  /** ref 기반으로 위젯을 패치한 새 레이아웃을 반환 (state 안 건드림) */
  const patchWidget = useCallback(
    (widgetId: TotalOverlayWidgetId, patch: Partial<TotalOverlayLayout['widgets'][number]>) => {
      const prev = layoutRef.current;
      const next = {
        ...prev,
        widgets: prev.widgets.map((w) =>
          w.id === widgetId ? { ...w, ...patch } : w
        ),
      };
      layoutRef.current = next;
      return next;
    },
    [],
  );

  /** state를 확정하면서 즉시 저장 — 토글, 제스처 종료 등에서 사용 */
  const updateWidget = (
    widgetId: TotalOverlayWidgetId,
    patch: Partial<TotalOverlayLayout['widgets'][number]>
  ) => {
    const next = patchWidget(widgetId, patch);
    setLayout(next);
    saveLayout(next);
  };

  const handleCopyUrl = () => {
    if (!overlayToken) return;
    const baseUrl =
      overlayBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${normalizedBaseUrl}/${overlayPath}/${overlayToken}/widgets/total`;
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setObsGuideUrl(url);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleReset = () => {
    const next = cloneTotalLayout(defaultLayout);
    setLayout(next);
    saveLayout(next);
  };

  const getUrl = () => {
    if (!overlayToken) return '';
    const baseUrl =
      overlayBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    return `${normalizedBaseUrl}/${overlayPath}/${overlayToken}/widgets/total`;
  };

  const getOtherBoxesForSnap = useCallback(
    (excludeId: TotalOverlayWidgetId): SnapBox[] => {
      return layoutRef.current.widgets
        .filter(
          (w) =>
            w.id !== excludeId &&
            w.enabled &&
            allowedWidgetIds.includes(w.id),
        )
        .map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
    },
    [allowedWidgetIds],
  );

  /** 방향키로 선택된 위젯 1% / Shift+방향키 5% 이동 */
  useEffect(() => {
    if (!selectedWidgetId) return;
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return;
        if (active.closest('[role="dialog"]')) return;
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.05 : 0.01;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      const prev = layoutRef.current;
      const next = {
        ...prev,
        widgets: prev.widgets.map((w) =>
          w.id === selectedWidgetId
            ? { ...w, x: clamp01(w.x + dx), y: clamp01(w.y + dy) }
            : w,
        ),
      };
      layoutRef.current = next;
      setLayout(next);
      saveLayout(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedWidgetId, saveLayout]);

  const renderWidget = (widgetId: TotalOverlayWidgetId, widgetW: number, widgetH: number) => {
    const label = TOTAL_WIDGET_LABELS[widgetId];
    const settingsAvailable = isValidWidgetType(widgetId);
    const previewAvailable = settingsAvailable;
    return (
      <CanvasIframePreview
        overlayToken={overlayToken}
        widgetId={widgetId}
        overlayPath={overlayPath}
        canvasWidth={canvasSize.width}
        widgetW={widgetW}
        widgetH={widgetH}
        selected={selectedWidgetId === widgetId}
        settingsAvailable={previewAvailable}
        previewEnabled={widgetPreviewEnabled}
        onSettingsClick={
          settingsAvailable
            ? () => setSettingsOpenFor(widgetId as WidgetType)
            : undefined
        }
        label={label}
      />
    );
  };

  const isLoading = isLayoutLoading || isTokenLoading;
  const canRenderCanvas = canvasSize.width > 0 && canvasSize.height > 0;
  const canvasEditorContent = (
    <div className="space-y-4">
      <div
        ref={canvasRef}
        className={cn(
          'relative w-full aspect-video rounded-lg border bg-muted/30 shadow-inner overflow-hidden',
          !embedded && 'max-w-4xl',
        )}
      >
        {!canRenderCanvas && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            캔버스 로딩 중...
          </div>
        )}
        {canRenderCanvas &&
          layout.widgets
            .filter((item) => TOTAL_WIDGETS.includes(item.id) && item.enabled)
            .filter((item) => allowedWidgetIds.includes(item.id))
            .map((item) => {
              const minSize = TOTAL_WIDGET_MIN_SIZES[item.id];
              const width = canvasSize.width * clamp01(item.w);
              const height = canvasSize.height * clamp01(item.h);
              const x = canvasSize.width * clamp01(item.x);
              const y = canvasSize.height * clamp01(item.y);
              const thresholdX = SNAP_THRESHOLD_PX / canvasSize.width;
              const thresholdY = SNAP_THRESHOLD_PX / canvasSize.height;
              return (
                <Rnd
                  key={item.id}
                  bounds="parent"
                  size={{ width, height }}
                  position={{ x, y }}
                  minWidth={canvasSize.width * minSize.w}
                  minHeight={canvasSize.height * minSize.h}
                  onDragStart={() => setSelectedWidgetId(item.id)}
                  onDrag={(e, data) => {
                    const shiftHeld =
                      (e as MouseEvent | KeyboardEvent).shiftKey === true;
                    const rawX = clamp01(data.x / canvasSize.width);
                    const rawY = clamp01(data.y / canvasSize.height);
                    const snapActive = snapEnabledRef.current && !shiftHeld;
                    const snapped = snapActive
                      ? computeSnap(
                          { x: rawX, y: rawY, w: item.w, h: item.h },
                          getOtherBoxesForSnap(item.id),
                          thresholdX,
                          thresholdY,
                        )
                      : { x: rawX, y: rawY, guideX: null, guideY: null };
                    setActiveGuides({ x: snapped.guideX, y: snapped.guideY });
                    const next = patchWidget(item.id, {
                      x: snapped.x,
                      y: snapped.y,
                    });
                    throttledSave(next);
                  }}
                  onDragStop={(e, data) => {
                    const shiftHeld =
                      (e as MouseEvent | KeyboardEvent).shiftKey === true;
                    const rawX = clamp01(data.x / canvasSize.width);
                    const rawY = clamp01(data.y / canvasSize.height);
                    const snapActive = snapEnabledRef.current && !shiftHeld;
                    const snapped = snapActive
                      ? computeSnap(
                          { x: rawX, y: rawY, w: item.w, h: item.h },
                          getOtherBoxesForSnap(item.id),
                          thresholdX,
                          thresholdY,
                        )
                      : { x: rawX, y: rawY, guideX: null, guideY: null };
                    setActiveGuides({ x: null, y: null });
                    updateWidget(item.id, {
                      x: snapped.x,
                      y: snapped.y,
                    });
                  }}
                  onResizeStart={() => setSelectedWidgetId(item.id)}
                  onResize={(e, direction, ref, _delta, position) => {
                    const shiftHeld =
                      (e as MouseEvent | KeyboardEvent).shiftKey === true;
                    const rawX = clamp01(position.x / canvasSize.width);
                    const rawY = clamp01(position.y / canvasSize.height);
                    const rawW = clamp01(ref.offsetWidth / canvasSize.width);
                    const rawH = clamp01(ref.offsetHeight / canvasSize.height);
                    const snapActive = snapEnabledRef.current && !shiftHeld;
                    const snapped = snapActive
                      ? computeResizeSnap(
                          { x: rawX, y: rawY, w: rawW, h: rawH },
                          direction as ResizeDirection,
                          getOtherBoxesForSnap(item.id),
                          thresholdX,
                          thresholdY,
                          minSize.w,
                          minSize.h,
                        )
                      : {
                          x: rawX,
                          y: rawY,
                          w: rawW,
                          h: rawH,
                          guideX: null,
                          guideY: null,
                        };
                    setActiveGuides({ x: snapped.guideX, y: snapped.guideY });
                    const next = patchWidget(item.id, {
                      x: snapped.x,
                      y: snapped.y,
                      w: snapped.w,
                      h: snapped.h,
                    });
                    throttledSave(next);
                  }}
                  onResizeStop={(e, direction, ref, _delta, position) => {
                    const shiftHeld =
                      (e as MouseEvent | KeyboardEvent).shiftKey === true;
                    const rawX = clamp01(position.x / canvasSize.width);
                    const rawY = clamp01(position.y / canvasSize.height);
                    const rawW = clamp01(ref.offsetWidth / canvasSize.width);
                    const rawH = clamp01(ref.offsetHeight / canvasSize.height);
                    const snapActive = snapEnabledRef.current && !shiftHeld;
                    const snapped = snapActive
                      ? computeResizeSnap(
                          { x: rawX, y: rawY, w: rawW, h: rawH },
                          direction as ResizeDirection,
                          getOtherBoxesForSnap(item.id),
                          thresholdX,
                          thresholdY,
                          minSize.w,
                          minSize.h,
                        )
                      : {
                          x: rawX,
                          y: rawY,
                          w: rawW,
                          h: rawH,
                          guideX: null,
                          guideY: null,
                        };
                    setActiveGuides({ x: null, y: null });
                    updateWidget(item.id, {
                      x: snapped.x,
                      y: snapped.y,
                      w: snapped.w,
                      h: snapped.h,
                    });
                  }}
                  style={{ zIndex: item.z }}
                >
                  {renderWidget(item.id, item.w, item.h)}
                </Rnd>
              );
            })}
        {canRenderCanvas && activeGuides.x !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-rose-500/80 shadow-[0_0_4px_rgba(244,63,94,0.6)]"
            style={{ left: `${activeGuides.x * canvasSize.width}px` }}
          />
        )}
        {canRenderCanvas && activeGuides.y !== null && (
          <div
            className="pointer-events-none absolute left-0 right-0 h-px bg-rose-500/80 shadow-[0_0_4px_rgba(244,63,94,0.6)]"
            style={{ top: `${activeGuides.y * canvasSize.height}px` }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={handleReset}>
          기본 레이아웃 복원
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <Magnet
            className={cn(
              'size-3.5 transition-colors',
              snapEnabled ? 'text-rose-500' : 'text-muted-foreground',
            )}
          />
          <span>자석</span>
          <Switch
            checked={snapEnabled}
            onCheckedChange={setSnapEnabled}
          />
        </label>
        {selectedWidgetId && (
          <span className="text-xs text-muted-foreground">
            방향키 1% · Shift+방향키 5% · 드래그 중 Shift로 자석 해제
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {saveState === 'saving' && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              저장 중...
            </span>
          )}
          {saveState === 'saved' && (
            <span className="inline-flex items-center gap-1 text-green-500">
              <Check className="size-3" />
              저장됨
            </span>
          )}
          {saveState === 'idle' && '변경사항은 자동으로 저장됩니다'}
        </span>
      </div>
    </div>
  );

  return (
    <div className={embedded ? 'space-y-4' : 'p-6'}>
      {settingsOpenFor && (
        <WidgetSettingsDialog
          open={settingsOpenFor !== null}
          onOpenChange={(next) => {
            if (!next) setSettingsOpenFor(null);
          }}
          channelIdentifier={user}
          widgetType={settingsOpenFor}
        />
      )}
      <OverlayCopyGuideDialog
        open={obsGuideUrl !== null}
        onOpenChange={(next) => {
          if (!next) setObsGuideUrl(null);
        }}
        url={obsGuideUrl ?? ''}
        width={widgetWidth}
        height={widgetHeight}
      />
      {!embedded && (
        <ManagementHeader
          title="통합 오버레이 설정"
          description="모든 위젯을 한 화면에 배치하여 표시합니다."
          icon={LayoutDashboard}
        />
      )}

      {isLoading ? (
        <Card className="py-0">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 컨텍스트 힌트 */}
          {!embedded && (
            <ContextualHint hintKey="overlay_hint_total">
              통합 오버레이는 대기열과 지금 부르는 곡을 하나의 화면에 모아 보여줍니다.
              OBS에 이 URL 하나만 추가하면 여러 위젯을 한번에 사용할 수 있어요.
            </ContextualHint>
          )}

          {/* 오버레이 URL */}
          {!embedded && overlayToken && (
            <Card className="py-0">
              <CardContent className="px-4">
                <SettingsSectionHeader title="오버레이 URL" />
                <SettingsRow title="URL" description="OBS 브라우저 소스에 입력하세요">
                  <BlurredUrlField
                    value={getUrl()}
                    onCopy={handleCopyUrl}
                    copied={copiedUrl}
                  />
                </SettingsRow>
                <SettingsRow title="권장 크기" description="OBS 브라우저 소스 설정">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono bg-muted px-2 py-1 rounded">{widgetWidth}</span>
                    <span className="text-muted-foreground">×</span>
                    <span className="font-mono bg-muted px-2 py-1 rounded">{widgetHeight}</span>
                    <span className="text-muted-foreground">px</span>
                  </div>
                </SettingsRow>
              </CardContent>
            </Card>
          )}

          {/* OBS 연결 가이드 */}
          {!embedded && (
            <OBSSetupGuide
              width={widgetWidth}
              height={widgetHeight}
              widgetName="통합 오버레이"
            />
          )}

          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="레이아웃 편집" />
              {embedded ? (
                <div className="py-4">{canvasEditorContent}</div>
              ) : (
                <SettingsRow title="캔버스" description="16:9 기준으로 배치됩니다">
                  {canvasEditorContent}
                </SettingsRow>
              )}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardContent className="px-4">
              <SettingsSectionHeader title="위젯 우선순위" />
              <SettingsRow title="정렬" description="위에 있을수록 앞에 표시됩니다">
                <div className="space-y-2">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={sortedWidgets.map((item) => item.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {sortedWidgets.map((item) => (
                          <SortableWidgetItem
                            key={item.id}
                            widget={item}
                            isSelected={selectedWidgetId === item.id}
                            onSelect={() => setSelectedWidgetId(item.id)}
                            onToggle={(enabled) => updateWidget(item.id, { enabled })}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              </SettingsRow>
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
