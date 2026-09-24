'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import type {
  ThemeDefinition,
  ThemeWidgetProps,
  OptionField,
} from '@/domains/overlay/themes/types';
import { THEME_IDS, type ThemeId } from '@/domains/overlay/themes/types';
import { loadTheme } from '@/domains/overlay/themes/registry';
import type { OverlayData, SongRequest } from '@/domains/overlay/types/overlay';
import type { OverlayChatEvent } from '@/domains/overlay/types/chat';

// =====================================================================
// Showcase config
// =====================================================================

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const SIDEBAR_W = 340;

type WidgetId = 'now-playing' | 'queue' | 'chatbox' | 'setlist';

const WIDGET_IDS: WidgetId[] = ['now-playing', 'queue', 'chatbox', 'setlist'];

const SLOT_LABELS: Record<WidgetId, string> = {
  'now-playing': 'NOW PLAYING',
  queue: 'QUEUE',
  chatbox: 'CHATBOX',
  setlist: 'SETLIST',
};

const WIDGET_MIN_SIZES: Record<WidgetId, { w: number; h: number }> = {
  queue: { w: 0.12, h: 0.2 },
  'now-playing': { w: 0.2, h: 0.1 },
  chatbox: { w: 0.2, h: 0.2 },
  setlist: { w: 0.12, h: 0.2 },
};

const THEME_LABELS: Record<ThemeId, string> = {
  apple: 'Apple',
  spotify: 'Spotify',
  billboard: 'Billboard',
  'retro-pixel': 'Retro Pixel',
  glassmorphism: 'Glassmorphism',
  brutalist: 'Brutalist',
  kawaii: 'Kawaii',
  'vinyl-analog': 'Vinyl Analog',
  'neon-cyberpunk': 'Neon Cyberpunk',
  'hand-drawn': 'Hand Drawn',
  'korean-traditional': 'Korean Traditional',
  '3d-depth': '3D Depth',
  'sports-ticker': 'Sports Ticker',
  'concert-poster': 'Concert Poster',
};

interface ShowcaseSlot {
  id: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  enabled: boolean;
}

const INITIAL_LAYOUT: ShowcaseSlot[] = [
  { id: 'chatbox', x: 0.02, y: 0.04, w: 0.27, h: 0.42, z: 1, enabled: true },
  { id: 'queue', x: 0.79, y: 0.04, w: 0.2, h: 0.42, z: 2, enabled: true },
  { id: 'setlist', x: 0.79, y: 0.49, w: 0.2, h: 0.49, z: 2, enabled: true },
  {
    id: 'now-playing',
    x: 0.02,
    y: 0.68,
    w: 0.62,
    h: 0.3,
    z: 1,
    enabled: true,
  },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// =====================================================================
// Mock data — full session timeline so the Setlist widget renders the
// expected mix of COMPLETED / PLAYING / ACCEPTED entries.
// =====================================================================

const MOCK_NOW_PLAYING: SongRequest = {
  id: 100,
  rawTitle: 'Lemon',
  rawArtist: 'Yonezu Kenshi',
  requesterNickname: 'Unnatural',
  status: 'PLAYING',
  queueOrder: 4,
  song: { id: 100, title: 'Lemon', artist: { name: 'Yonezu Kenshi' } },
};

const MOCK_QUEUE: SongRequest[] = [
  {
    id: 101,
    rawTitle: 'LADY',
    rawArtist: 'Yonezu Kenshi',
    requesterNickname: 'Sakura',
    status: 'ACCEPTED',
    queueOrder: 5,
    song: { id: 101, title: 'LADY', artist: { name: 'Yonezu Kenshi' } },
  },
  {
    id: 102,
    rawTitle: 'KICK BACK',
    rawArtist: 'Yonezu Kenshi',
    requesterNickname: 'NorthStar',
    status: 'ACCEPTED',
    queueOrder: 6,
    donationAmount: 5000,
    song: { id: 102, title: 'KICK BACK', artist: { name: 'Yonezu Kenshi' } },
  },
  {
    id: 103,
    rawTitle: 'Pale Blue',
    rawArtist: 'Yonezu Kenshi',
    requesterNickname: 'lunaring',
    status: 'ACCEPTED',
    queueOrder: 7,
    song: { id: 103, title: 'Pale Blue', artist: { name: 'Yonezu Kenshi' } },
  },
  {
    id: 104,
    rawTitle: '밤양갱',
    rawArtist: 'BIBI',
    requesterNickname: '별빛수호자',
    status: 'ACCEPTED',
    queueOrder: 8,
    isHomework: true,
    song: { id: 104, title: '밤양갱', artist: { name: 'BIBI' } },
  },
  {
    id: 105,
    rawTitle: '夜に駆ける',
    rawArtist: 'YOASOBI',
    requesterNickname: '음악요정',
    status: 'ACCEPTED',
    queueOrder: 9,
    song: { id: 105, title: '夜に駆ける', artist: { name: 'YOASOBI' } },
  },
];

const MOCK_SETLIST: SongRequest[] = [
  {
    id: 90,
    rawTitle: 'KICK BACK',
    rawArtist: 'Yonezu Kenshi',
    requesterNickname: 'NorthStar',
    status: 'COMPLETED',
    queueOrder: 1,
    song: { id: 90, title: 'KICK BACK', artist: { name: 'Yonezu Kenshi' } },
  },
  {
    id: 91,
    rawTitle: '봄날',
    rawArtist: 'BTS',
    requesterNickname: '아미사랑',
    status: 'COMPLETED',
    queueOrder: 2,
    song: { id: 91, title: '봄날', artist: { name: 'BTS' } },
  },
  {
    id: 92,
    rawTitle: 'Cruel Angel',
    rawArtist: 'Yoko Takahashi',
    requesterNickname: 'eva-fan',
    status: 'COMPLETED',
    queueOrder: 3,
    song: { id: 92, title: 'Cruel Angel', artist: { name: 'Yoko Takahashi' } },
  },
  MOCK_NOW_PLAYING,
  ...MOCK_QUEUE,
];

function buildMockChat(): OverlayChatEvent[] {
  const now = new Date();
  return [
    {
      id: 'chat-1',
      type: 'chat',
      sessionId: 1,
      platform: 'chzzk',
      channelId: 'mock',
      userId: 'u1',
      nickname: 'Unnatural',
      message: 'Lemon 신청합니다!',
      timestamp: new Date(now.getTime() - 30000).toISOString(),
    },
    {
      id: 'chat-2',
      type: 'chat',
      sessionId: 1,
      platform: 'soop',
      channelId: 'mock',
      userId: 'u2',
      nickname: 'Sakura',
      message: '오늘도 좋은 방송 감사합니다 ✿',
      timestamp: new Date(now.getTime() - 22000).toISOString(),
    },
    {
      id: 'chat-3',
      type: 'donation',
      sessionId: 1,
      platform: 'chzzk',
      channelId: 'mock',
      userId: 'u3',
      nickname: 'NorthStar',
      message: 'KICK BACK 신청해도 될까요?',
      timestamp: new Date(now.getTime() - 14000).toISOString(),
      amount: 5000,
      amountKrw: 5000,
    },
    {
      id: 'chat-4',
      type: 'chat',
      sessionId: 1,
      platform: 'cime',
      channelId: 'mock',
      userId: 'u4',
      nickname: 'lunaring',
      message: '목소리 너무 좋으세요 진짜로요',
      timestamp: new Date(now.getTime() - 9000).toISOString(),
    },
    {
      id: 'chat-5',
      type: 'donation',
      sessionId: 1,
      platform: 'chzzk',
      channelId: 'mock',
      userId: 'u5',
      nickname: '별빛수호자',
      message: '오늘 셋리 너무 좋아요!! 항상 응원합니다',
      timestamp: new Date(now.getTime() - 2000).toISOString(),
      amount: 30000,
      amountKrw: 30000,
    },
  ];
}

const MOCK_OVERLAY_DATA: OverlayData = {
  sessionId: 1,
  channel: {
    id: 1,
    name: '멜로밍 통합 미리보기',
    webPath: 'meloming-test',
    themeColor: '#7B5BFF',
  },
  settings: {
    requestEnabled: true,
    paused: false,
    requestCommand: '!신청',
    maxQueueSize: 50,
    donationPriorityEnabled: true,
  },
  queue: MOCK_QUEUE,
  nowPlaying: MOCK_NOW_PLAYING,
  setlist: MOCK_SETLIST,
  isLive: true,
  startedAt: new Date().toISOString(),
};

// =====================================================================
// Sidebar primitives — minimal inline form for option editing.
// =====================================================================

const FIELD_LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#9CA3AF',
  marginBottom: 6,
};

const FIELD_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: '#1a1a26',
  color: '#fff',
  border: '1px solid #2c2c3d',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

interface FieldEditorProps {
  field: OptionField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

function FieldEditor({ field, value, onChange }: FieldEditorProps) {
  switch (field.type) {
    case 'color': {
      const v = (typeof value === 'string' ? value : field.default) || '#000';
      return (
        <div>
          <label style={FIELD_LABEL_STYLE}>{field.label}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={v}
              onChange={(e) => onChange(field.key, e.target.value)}
              style={{
                width: 36,
                height: 28,
                border: '1px solid #2c2c3d',
                borderRadius: 4,
                background: 'transparent',
                cursor: 'pointer',
              }}
            />
            <input
              type="text"
              value={v}
              onChange={(e) => onChange(field.key, e.target.value)}
              style={{ ...FIELD_INPUT_STYLE, flex: 1, fontFamily: 'monospace' }}
            />
          </div>
        </div>
      );
    }
    case 'range': {
      const num = typeof value === 'number' ? value : field.default;
      return (
        <div>
          <label style={FIELD_LABEL_STYLE}>
            {field.label}
            <span
              style={{
                marginLeft: 8,
                color: '#A78BFA',
                fontFamily: 'monospace',
                fontSize: 10,
              }}
            >
              {num}
            </span>
          </label>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={num}
            onChange={(e) => onChange(field.key, Number(e.target.value))}
            style={{ width: '100%', accentColor: '#8B5CF6' }}
          />
        </div>
      );
    }
    case 'select': {
      const v = value === undefined ? field.default : value;
      return (
        <div>
          <label style={FIELD_LABEL_STYLE}>{field.label}</label>
          <select
            value={String(v)}
            onChange={(e) => {
              const match = field.choices.find(
                (c) => String(c.value) === e.target.value,
              );
              onChange(field.key, match ? match.value : e.target.value);
            }}
            style={FIELD_INPUT_STYLE}
          >
            {field.choices.map((c) => (
              <option key={String(c.value)} value={String(c.value)}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case 'toggle': {
      const v = typeof value === 'boolean' ? value : field.default;
      return (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: '#cdd1de',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={v}
            onChange={(e) => onChange(field.key, e.target.checked)}
            style={{ accentColor: '#8B5CF6' }}
          />
          {field.label}
        </label>
      );
    }
    case 'number': {
      const num = typeof value === 'number' ? value : field.default;
      return (
        <div>
          <label style={FIELD_LABEL_STYLE}>{field.label}</label>
          <input
            type="number"
            min={field.min}
            max={field.max}
            value={num}
            onChange={(e) => onChange(field.key, Number(e.target.value))}
            style={FIELD_INPUT_STYLE}
          />
        </div>
      );
    }
    case 'text':
    case 'font': {
      const v = (typeof value === 'string' ? value : field.default) || '';
      return (
        <div>
          <label style={FIELD_LABEL_STYLE}>{field.label}</label>
          <input
            type="text"
            value={v}
            onChange={(e) => onChange(field.key, e.target.value)}
            style={FIELD_INPUT_STYLE}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '1px solid #1f1f2c' }}>
      <div
        style={{
          padding: '10px 16px',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: '#A78BFA',
          background: '#0f0f17',
        }}
      >
        {title}
      </div>
      <div
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// =====================================================================
// Slot renderer
// =====================================================================

interface WidgetRenderProps {
  widgetId: WidgetId;
  theme: ThemeDefinition | null;
  options: Record<string, unknown>;
  chatMessages: OverlayChatEvent[];
}

function WidgetRender({
  widgetId,
  theme,
  options,
  chatMessages,
}: WidgetRenderProps) {
  if (!theme) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.4)',
          fontSize: 14,
          letterSpacing: 4,
          textTransform: 'uppercase',
        }}
      >
        Loading...
      </div>
    );
  }

  const Component = theme.widgets[widgetId];
  if (!Component) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.5)',
          fontSize: 12,
          letterSpacing: 2,
          textTransform: 'uppercase',
          padding: 12,
          textAlign: 'center',
        }}
      >
        {widgetId}
        <br />
        <span style={{ color: 'rgba(251,191,36,0.7)' }}>not implemented</span>
      </div>
    );
  }

  const props: ThemeWidgetProps = {
    data: MOCK_OVERLAY_DATA,
    options,
    animations: theme.animations,
    fonts: theme.fonts,
    reducedMotion: false,
    chatMessages,
    connectionStatus: 'connected',
  };

  return <Component {...props} />;
}

// =====================================================================
// Page
// =====================================================================

export default function UnifiedShowcasePage() {
  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>('concert-poster');
  const [theme, setTheme] = useState<ThemeDefinition | null>(null);
  const [customOptions, setCustomOptions] = useState<Record<string, unknown>>({});

  const [layout, setLayout] = useState<ShowcaseSlot[]>(INITIAL_LAYOUT);
  const [selectedWidget, setSelectedWidget] = useState<WidgetId | null>(null);

  const [showSlotBounds, setShowSlotBounds] = useState(true);
  const [autoLoopAlerts, setAutoLoopAlerts] = useState(true);
  const [showStreamPlaceholder, setShowStreamPlaceholder] = useState(true);
  const [canvasBackdrop, setCanvasBackdrop] = useState('#040409');
  const [chatMessages, setChatMessages] = useState<OverlayChatEvent[]>(() =>
    buildMockChat(),
  );

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);

  // Load theme + reset options to defaults on switch
  useEffect(() => {
    let cancelled = false;
    setTheme(null);
    setCustomOptions({});
    loadTheme(selectedThemeId).then((t) => {
      if (cancelled) return;
      setTheme(t ?? null);
      setCustomOptions({ ...(t?.defaultOptions ?? {}) });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedThemeId]);

  // Viewport scaling
  useEffect(() => {
    const update = () => {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = Math.max(
        0.05,
        Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H),
      );
      setScale((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Reset chat on theme change
  useEffect(() => {
    setChatMessages(buildMockChat());
  }, [selectedThemeId]);

  // Auto-fire donations periodically so chat/setlist feel "alive" in mock
  useEffect(() => {
    if (!autoLoopAlerts) return;
    const SAMPLE_DONORS = [
      { nickname: 'Unnatural', amount: 10000, msg: 'Lemon 신청합니다!' },
      { nickname: 'Sakura', amount: 5000, msg: '오늘도 좋은 방송 감사해요' },
      { nickname: 'NorthStar', amount: 30000, msg: 'KICK BACK 부탁드려요' },
      { nickname: '별빛수호자', amount: 50000, msg: '항상 응원해요!' },
    ];
    let i = 0;
    const tick = () => {
      const sample = SAMPLE_DONORS[i % SAMPLE_DONORS.length];
      i += 1;
      const event: OverlayChatEvent = {
        id: `auto-${Date.now()}-${i}`,
        type: 'donation',
        sessionId: 1,
        platform: 'chzzk',
        channelId: 'mock',
        userId: `u-${i}`,
        nickname: sample.nickname,
        message: sample.msg,
        timestamp: new Date().toISOString(),
        amount: sample.amount,
        amountKrw: sample.amount,
      };
      setChatMessages((prev) => [...prev.slice(-10), event]);
    };
    const handle = setInterval(tick, 4000);
    return () => clearInterval(handle);
  }, [autoLoopAlerts, selectedThemeId]);

  const updateOption = useCallback((key: string, value: unknown) => {
    setCustomOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const fireFakeDonation = () => {
    const donation: OverlayChatEvent = {
      id: `manual-${Date.now()}`,
      type: 'donation',
      sessionId: 1,
      platform: 'chzzk',
      channelId: 'mock',
      userId: 'live-u',
      nickname: 'TestDonor',
      message: '테스트 후원!',
      timestamp: new Date().toISOString(),
      amount: 10000,
      amountKrw: 10000,
    };
    setChatMessages((prev) => [...prev, donation]);
  };

  const applyPreset = (presetOptions: Record<string, unknown>) => {
    setCustomOptions({ ...presetOptions });
  };

  const updateSlot = (id: WidgetId, patch: Partial<ShowcaseSlot>) => {
    setLayout((prev) =>
      prev.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    );
  };

  const toggleSlotEnabled = (id: WidgetId) => {
    setLayout((prev) =>
      prev.map((slot) =>
        slot.id === id ? { ...slot, enabled: !slot.enabled } : slot,
      ),
    );
  };

  const resetLayout = () => {
    setLayout(INITIAL_LAYOUT.map((s) => ({ ...s })));
  };

  const visualW = CANVAS_W * scale;
  const visualH = CANVAS_H * scale;

  const themeIds = useMemo(() => Array.from(THEME_IDS), []);

  const missingFromBase = useMemo(() => {
    if (!theme) return [] as WidgetId[];
    return WIDGET_IDS.filter((id) => !theme.widgets[id]);
  }, [theme]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0b0b14',
        display: 'flex',
        flexDirection: 'column',
        color: '#fff',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Pretendard", sans-serif',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          flexShrink: 0,
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          borderBottom: '1px solid #1f1f2c',
          background: '#0f0f17',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#A78BFA',
          }}
        >
          UNIFIED OVERLAY MOCK
        </div>
        <div style={{ fontSize: 11, color: '#666' }}>1920×1080 · 16:9</div>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <label style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showSlotBounds}
              onChange={(e) => setShowSlotBounds(e.target.checked)}
              style={{ marginRight: 4, accentColor: '#8B5CF6' }}
            />
            슬롯 경계
          </label>
          <label style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showStreamPlaceholder}
              onChange={(e) => setShowStreamPlaceholder(e.target.checked)}
              style={{ marginRight: 4, accentColor: '#8B5CF6' }}
            />
            중앙 가이드
          </label>
          <label style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoLoopAlerts}
              onChange={(e) => setAutoLoopAlerts(e.target.checked)}
              style={{ marginRight: 4, accentColor: '#8B5CF6' }}
            />
            도네 자동반복(4s)
          </label>
          <button
            type="button"
            onClick={fireFakeDonation}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #8B5CF6',
              background: '#1a1126',
              color: '#C4B5FD',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >
            🎁 후원 트리거
          </button>
          <button
            type="button"
            onClick={resetLayout}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #444',
              background: '#1a1a26',
              color: '#cdd1de',
              fontSize: 12,
              cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            ⟳ 레이아웃 리셋
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Canvas wrapper */}
        <div
          ref={wrapperRef}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflow: 'hidden',
            minWidth: 0,
            position: 'relative',
          }}
        >
          {/* Frame: visual size, holds the scaled canvas. */}
          <div
            style={{
              width: visualW,
              height: visualH,
              position: 'relative',
              backgroundColor: canvasBackdrop,
              boxShadow: '0 0 0 1px #222, 0 24px 80px rgba(0,0,0,0.7)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {/* True 1920×1080 stage — scaled with transformOrigin: 0 0
                so the rendered footprint matches the frame exactly. */}
            <div
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
                position: 'absolute',
                top: 0,
                left: 0,
                backgroundImage:
                  'linear-gradient(135deg, rgba(123,91,255,0.18) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.85) 100%), repeating-linear-gradient(0deg, transparent 0 39px, rgba(255,255,255,0.025) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(255,255,255,0.025) 39px 40px)',
                backgroundColor: canvasBackdrop,
              }}
            >
              {showStreamPlaceholder && (
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    padding: '14px 28px',
                    border: '1px dashed rgba(255,255,255,0.18)',
                    color: 'rgba(255,255,255,0.35)',
                    fontSize: 14,
                    letterSpacing: '0.4em',
                    textTransform: 'uppercase',
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                >
                  STREAM CONTENT AREA
                </div>
              )}

              {layout
                .filter((s) => s.enabled)
                .map((slot) => {
                  const isSelected = selectedWidget === slot.id;
                  return (
                    <Rnd
                      key={slot.id}
                      bounds="parent"
                      scale={scale}
                      size={{
                        width: slot.w * CANVAS_W,
                        height: slot.h * CANVAS_H,
                      }}
                      position={{
                        x: slot.x * CANVAS_W,
                        y: slot.y * CANVAS_H,
                      }}
                      minWidth={WIDGET_MIN_SIZES[slot.id].w * CANVAS_W}
                      minHeight={WIDGET_MIN_SIZES[slot.id].h * CANVAS_H}
                      onDragStart={() => setSelectedWidget(slot.id)}
                      onDragStop={(_, d) =>
                        updateSlot(slot.id, {
                          x: clamp01(d.x / CANVAS_W),
                          y: clamp01(d.y / CANVAS_H),
                        })
                      }
                      onResizeStart={() => setSelectedWidget(slot.id)}
                      onResizeStop={(_e, _dir, ref, _delta, position) => {
                        updateSlot(slot.id, {
                          x: clamp01(position.x / CANVAS_W),
                          y: clamp01(position.y / CANVAS_H),
                          w: clamp01(ref.offsetWidth / CANVAS_W),
                          h: clamp01(ref.offsetHeight / CANVAS_H),
                        });
                      }}
                      style={{ zIndex: slot.z }}
                    >
                      <div
                        onMouseDown={() => setSelectedWidget(slot.id)}
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: '100%',
                          overflow: 'hidden',
                          outline: showSlotBounds
                            ? `2px ${
                                isSelected ? 'solid' : 'dashed'
                              } rgba(139, 92, 246, ${
                                isSelected ? 0.95 : 0.55
                              })`
                            : 'none',
                          outlineOffset: -2,
                          cursor: 'grab',
                          boxSizing: 'border-box',
                        }}
                      >
                        {showSlotBounds && (
                          <div
                            style={{
                              position: 'absolute',
                              top: -22,
                              left: 0,
                              fontSize: 10,
                              letterSpacing: '0.3em',
                              color: isSelected ? '#fff' : '#A78BFA',
                              fontWeight: 700,
                              textShadow: '1px 1px 0 #000',
                              pointerEvents: 'none',
                              zIndex: 10,
                              whiteSpace: 'nowrap',
                              background: isSelected
                                ? '#8B5CF6'
                                : 'transparent',
                              padding: isSelected ? '2px 8px' : 0,
                              borderRadius: 4,
                            }}
                          >
                            {SLOT_LABELS[slot.id]}
                          </div>
                        )}
                        <WidgetRender
                          widgetId={slot.id}
                          theme={theme}
                          options={customOptions}
                          chatMessages={chatMessages}
                        />
                      </div>
                    </Rnd>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div
          style={{
            width: SIDEBAR_W,
            flexShrink: 0,
            background: '#0b0b14',
            borderLeft: '1px solid #1f1f2c',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SidebarSection title="THEME">
            <select
              value={selectedThemeId}
              onChange={(e) => setSelectedThemeId(e.target.value as ThemeId)}
              style={FIELD_INPUT_STYLE}
            >
              {themeIds.map((id) => (
                <option key={id} value={id}>
                  {THEME_LABELS[id]}
                </option>
              ))}
            </select>
            {theme && (
              <div style={{ fontSize: 10, color: '#5b6175' }}>
                {theme.description}
              </div>
            )}
          </SidebarSection>

          {theme && theme.presets.length > 0 && (
            <SidebarSection title="PRESETS">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {theme.presets.map((preset) => {
                  const matches = Object.entries(preset.options).every(
                    ([k, v]) => customOptions[k] === v,
                  );
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.options)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 999,
                        border: matches
                          ? '1px solid #8B5CF6'
                          : '1px solid #2c2c3d',
                        background: matches ? '#1a1126' : '#1a1a26',
                        color: matches ? '#C4B5FD' : '#cdd1de',
                        fontSize: 11,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                      title={preset.description}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </SidebarSection>
          )}

          {theme && theme.optionSchema.length > 0 && (
            <SidebarSection title="OPTIONS">
              {theme.optionSchema.map((field) => (
                <FieldEditor
                  key={field.key}
                  field={field}
                  value={customOptions[field.key]}
                  onChange={updateOption}
                />
              ))}
            </SidebarSection>
          )}

          <SidebarSection title="WIDGETS">
            {WIDGET_IDS.map((widgetId) => {
              const slot = layout.find((s) => s.id === widgetId);
              const enabled = slot?.enabled ?? false;
              return (
                <div
                  key={widgetId}
                  style={{
                    background: '#11111c',
                    border: '1px solid #1f1f2c',
                    borderRadius: 6,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleSlotEnabled(widgetId)}
                      style={{ accentColor: '#8B5CF6' }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: enabled ? '#cdd1de' : '#5b6175',
                        flex: 1,
                      }}
                    >
                      {SLOT_LABELS[widgetId]}
                    </span>
                  </div>
                  {slot && (
                    <div
                      style={{
                        fontSize: 9,
                        color: '#5b6175',
                        fontFamily: 'monospace',
                        letterSpacing: '0.05em',
                      }}
                    >
                      x{slot.x.toFixed(3)} y{slot.y.toFixed(3)} · w
                      {slot.w.toFixed(3)} h{slot.h.toFixed(3)}
                    </div>
                  )}
                </div>
              );
            })}
          </SidebarSection>

          <SidebarSection title="CANVAS">
            <div>
              <label style={FIELD_LABEL_STYLE}>배경 컬러</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={canvasBackdrop}
                  onChange={(e) => setCanvasBackdrop(e.target.value)}
                  style={{
                    width: 36,
                    height: 28,
                    border: '1px solid #2c2c3d',
                    borderRadius: 4,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                />
                <input
                  type="text"
                  value={canvasBackdrop}
                  onChange={(e) => setCanvasBackdrop(e.target.value)}
                  style={{
                    ...FIELD_INPUT_STYLE,
                    flex: 1,
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: '#5b6175', marginTop: 4 }}>
                실제 OBS에서는 투명 — 여기서는 가독성 확인용
              </div>
            </div>
          </SidebarSection>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 20px',
          fontSize: 11,
          color: '#555',
          borderTop: '1px solid #1f1f2c',
          background: '#0f0f17',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span>
          현재 테마:{' '}
          <code style={{ color: '#A78BFA' }}>{selectedThemeId}</code>
        </span>
        <span>·</span>
        <span>위젯 드래그 + 모서리 끌면 리사이즈</span>
        {missingFromBase.length > 0 && (
          <>
            <span>·</span>
            <span style={{ color: '#FBBF24' }}>
              ※ {missingFromBase.join(' / ')} 미구현
            </span>
          </>
        )}
      </div>
    </div>
  );
}
