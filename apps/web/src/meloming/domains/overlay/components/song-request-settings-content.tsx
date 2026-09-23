'use client';

import { useEffect, useState } from 'react';
import {
  ListOrdered,
  Loader2,
  Star,
  Radio,
  Pause,
  Play,
  Square,
} from 'lucide-react';
import {
  usePricingSettings,
  useUpdatePricingSettings,
} from '@/meloming/domains/channel/hooks/use-pricing-settings';
import { useMyChannel } from '@/meloming/domains/channel/hooks/use-my-channel';
import { useCategoriesManagement } from '@/meloming/domains/channel/hooks/use-categories-management';
import {
  useActiveSession,
  useEndSession,
  useStartSession,
  useUpdateSessionSettings,
} from '@/meloming/domains/overlay/hooks/use-session';
import { useChannelSongRequestSettings } from '@/meloming/domains/overlay/hooks/use-channel-song-request-settings';
import { LEGACY_DISABLED_REQUEST_SETTINGS } from '@/meloming/domains/overlay/apis/session';
import type {
  CurrencyConfig,
  CurrencyPriceMap,
  DifficultyPrices,
  DifficultyPricesByCurrency,
} from '@/meloming/domains/channel/types/pricing';
import { Button } from '@/meloming/shared/components/ui/button';
import { Input } from '@/meloming/shared/components/ui/input';
import { Switch } from '@/meloming/shared/components/ui/switch';
import { Badge } from '@/meloming/shared/components/ui/badge';
import { Card, CardContent } from '@/meloming/shared/components/ui/card';
import { ManagementHeader } from '@/meloming/domains/channel/components/management/management-header';
import { toast } from 'sonner';
import { ContextualHint } from './onboarding';
import { cn } from '@/meloming/shared/lib/utils';
import { extractApiErrorMessage } from '@/meloming/shared/lib/api-error';
import {
  SectionHeader,
  SessionSettingsFields,
  SettingRow,
  type RequestSettingsState,
} from './session-settings-fields';
import { FloatingSaveBar } from './theme-management/FloatingSaveBar';
import { EndSessionConfirmDialog } from './end-session-confirm-dialog';
import {
  useOmakaseSettings,
  useUpdateOmakaseSettings,
} from '@/meloming/domains/overlay/hooks/use-omakase';

function OmakaseSettingsSection({
  channelId,
}: {
  channelId: number | null | undefined;
}) {
  const { data, isLoading } = useOmakaseSettings(channelId);
  const updateMutation = useUpdateOmakaseSettings(channelId);
  const [enabled, setEnabled] = useState(false);
  const [displayName, setDisplayName] = useState('오마카세');
  const [price, setPrice] = useState('0');

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setDisplayName(data.displayName);
    setPrice(String(data.price ?? 0));
  }, [data]);

  const handleSave = async () => {
    if (!channelId) {
      toast.error('채널 정보를 불러오지 못했습니다');
      return;
    }
    const parsedPrice = Math.max(0, Number.parseInt(price || '0', 10) || 0);
    try {
      await updateMutation.mutateAsync({
        enabled,
        displayName: displayName.trim() || null,
        price: parsedPrice,
      });
      toast.success('오마카세 설정이 저장되었습니다');
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '오마카세 설정 저장에 실패했습니다'));
    }
  };

  return (
    <div id="omakase" className="scroll-mt-20 py-3">
      <SectionHeader title="오마카세" />
      <div className="divide-y rounded border">
        <div className="flex items-start gap-3 px-3 py-3">
          <div className="flex-1">
            <div className="text-sm font-medium">오마카세 사용</div>
            <p className="text-xs text-muted-foreground">
              스트리머가 콘솔에서 횟수를 직접 관리하고 선곡합니다.
            </p>
          </div>
          <Switch
            aria-label="오마카세 사용"
            checked={enabled}
            disabled={isLoading}
            onCheckedChange={setEnabled}
          />
        </div>
        <div className="grid gap-3 px-3 py-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-sm font-medium">표시 이름</span>
            <Input
              value={displayName}
              maxLength={50}
              disabled={isLoading}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="오마카세"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">참고 가격</span>
            <Input
              value={price}
              inputMode="numeric"
              disabled={isLoading}
              onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="0"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 px-3 py-3">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isLoading || updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}

type SessionModeCardProps = {
  user: string;
  sessionId: number | null;
  isPaused: boolean;
  isLoading: boolean;
};

/**
 * 페이지 상단의 신청곡 모드 제어 카드.
 * 상태(비활성 / 활성 / 일시정지)에 따라 서로 다른 액션 버튼을 보여준다.
 */
function SessionModeCard({
  user,
  sessionId,
  isPaused,
  isLoading,
}: SessionModeCardProps) {
  const startSessionMutation = useStartSession(user);
  const endSessionMutation = useEndSession(user);
  const updateSessionSettingsMutation = useUpdateSessionSettings(user);

  const isActive = !!sessionId;
  const busy =
    startSessionMutation.isPending ||
    endSessionMutation.isPending ||
    updateSessionSettingsMutation.isPending;

  const handleStart = async () => {
    try {
      await startSessionMutation.mutateAsync({});
      toast.success('신청곡 모드를 시작했습니다');
    } catch {
      toast.error('신청곡 모드 시작에 실패했습니다');
    }
  };

  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  const handleRequestEnd = () => {
    if (!sessionId) return;
    setEndConfirmOpen(true);
  };

  const handleConfirmEnd = async () => {
    if (!sessionId) return;
    try {
      await endSessionMutation.mutateAsync(sessionId);
      toast.success('신청곡 모드를 종료했습니다');
      setEndConfirmOpen(false);
    } catch {
      toast.error('신청곡 모드 종료에 실패했습니다');
    }
  };

  const handleTogglePause = async (nextPaused: boolean) => {
    if (!sessionId) return;
    try {
      await updateSessionSettingsMutation.mutateAsync({
        sessionId,
        settings: { paused: nextPaused },
      });
      toast.success(
        nextPaused ? '신청을 일시정지했습니다' : '신청을 재개했습니다',
      );
    } catch {
      toast.error(
        nextPaused ? '일시정지에 실패했습니다' : '재개에 실패했습니다',
      );
    }
  };

  const status: 'inactive' | 'active' | 'paused' = !isActive
    ? 'inactive'
    : isPaused
      ? 'paused'
      : 'active';

  const statusMeta = {
    inactive: {
      label: '비활성',
      description: '신청곡 모드를 시작하면 시청자가 곡을 신청할 수 있어요.',
      badgeClass: 'bg-white/20 text-white border-white/30',
    },
    active: {
      label: '활성 중',
      description: '시청자가 신청곡을 보낼 수 있는 상태입니다.',
      badgeClass: 'bg-white/20 text-white border-white/30',
    },
    paused: {
      label: '일시정지',
      description: '세션은 유지되지만 새로운 신청은 접수되지 않습니다.',
      badgeClass: 'bg-white/20 text-white border-white/30',
    },
  }[status];

  const gradientClass =
    status === 'paused'
      ? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/25'
      : 'bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-600 shadow-indigo-500/25';

  return (
    <>
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl px-5 py-5 shadow-xl text-white',
        gradientClass,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Radio className="size-5 text-white" />
            <span className="text-base font-bold paperlogy">신청곡 모드</span>
            <Badge
              variant="outline"
              className={cn(
                'h-5 px-2 text-[10px] border',
                statusMeta.badgeClass,
              )}
            >
              {status === 'active' && (
                <span className="relative mr-1 flex size-1.5">
                  <span className="absolute inline-flex size-full rounded-full bg-white opacity-75 animate-ping" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                </span>
              )}
              {statusMeta.label}
            </Badge>
          </div>
          <p className="text-xs text-white/85 leading-relaxed">
            {statusMeta.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isLoading ? (
            <Loader2 className="size-4 animate-spin text-white/80" />
          ) : status === 'inactive' ? (
            <Button
              onClick={handleStart}
              disabled={busy}
              size="default"
              className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold shadow-lg"
            >
              {startSessionMutation.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Radio className="size-4 mr-2" />
              )}
              신청곡 모드 시작
            </Button>
          ) : status === 'paused' ? (
            <>
              <Button
                onClick={() => handleTogglePause(false)}
                disabled={busy}
                size="default"
                className="bg-white text-amber-700 hover:bg-amber-50 font-bold"
              >
                {updateSessionSettingsMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Play className="size-4 mr-2" />
                )}
                재개
              </Button>
              <Button
                variant="outline"
                onClick={handleRequestEnd}
                disabled={busy}
                size="default"
                className="bg-transparent border-white/40 text-white hover:bg-white/15 hover:text-white"
              >
                {endSessionMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Square className="size-4 mr-2" />
                )}
                종료
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleTogglePause(true)}
                disabled={busy}
                size="default"
                className="bg-transparent border-white/40 text-white hover:bg-white/15 hover:text-white"
              >
                {updateSessionSettingsMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Pause className="size-4 mr-2" />
                )}
                일시정지
              </Button>
              <Button
                variant="outline"
                onClick={handleRequestEnd}
                disabled={busy}
                size="default"
                className="bg-transparent border-white/40 text-white hover:bg-white/15 hover:text-white"
              >
                {endSessionMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="size-4 mr-2" />
                  )}
                  종료
                </Button>
              </>
            )}
        </div>
      </div>
    </div>
    <EndSessionConfirmDialog
      open={endConfirmOpen}
      onOpenChange={(next) => {
        if (!next && !endSessionMutation.isPending) setEndConfirmOpen(false);
      }}
      onConfirm={() => void handleConfirmEnd()}
      isPending={endSessionMutation.isPending}
    />
    </>
  );
}

interface SongRequestSettingsContentProps {
  user: string;
}

type PriceSettingsState = {
  pricingEnabled: boolean;
  currencyConfigs: CurrencyConfig[];
  defaultPrices: CurrencyPriceMap | null;
  difficultyPricesByCurrency: DifficultyPricesByCurrency | null;
};

const DEFAULT_DIFFICULTY_PRICES: DifficultyPrices = {
  '1': null,
  '2': null,
  '3': null,
  '4': null,
  '5': null,
};

const AVAILABLE_CURRENCY_OPTIONS = [
  { key: 'SOOP_BALLOON', unit: '별풍선', label: 'SOOP 별풍선' },
  { key: 'CHZZK_CHEESE', unit: '치즈', label: '치지직 치즈' },
  { key: 'CIME_BEAM', unit: '빔', label: '씨미 빔' },
  { key: 'KRW', unit: '원', label: '원(기타)' },
] as const;

const SECTION_ANCHORS = [
  { id: 'basic-settings', label: '기본 설정' },
  { id: 'request-conditions', label: '신청 조건' },
  { id: 'request-rules', label: '신청 규칙' },
  { id: 'omakase', label: '오마카세' },
  { id: 'pricing', label: '참고 가격' },
] as const;

const SECTION_ANCHOR_IDS = new Set<string>(SECTION_ANCHORS.map((a) => a.id));

function SectionAnchorBar() {
  const handleClick = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', `#${id}`);
    }
  };

  return (
    <nav
      aria-label="신청곡 설정 섹션 바로가기"
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      {SECTION_ANCHORS.map((anchor) => (
        <button
          key={anchor.id}
          type="button"
          onClick={() => handleClick(anchor.id)}
          className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-muted text-muted-foreground hover:bg-muted/80"
        >
          {anchor.label}
        </button>
      ))}
    </nav>
  );
}

function normalizeCurrencyConfigs(
  currencyConfigs: CurrencyConfig[] | null | undefined,
): CurrencyConfig[] {
  if (!Array.isArray(currencyConfigs)) {
    return [];
  }

  const deduped = new Map<string, CurrencyConfig>();
  for (const config of currencyConfigs) {
    const key = config?.key?.trim();
    const unit = config?.unit?.trim();
    if (!key || !unit) {
      continue;
    }
    deduped.set(key, {
      key,
      unit,
      amount: null,
    });
  }

  return Array.from(deduped.values());
}

function sanitizeCurrencyPriceMap(value: unknown): CurrencyPriceMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const out: CurrencyPriceMap = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (rawValue == null || rawValue === '') {
      out[key] = null;
      continue;
    }
    const amount = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    out[key] = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : null;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeDifficultyPrices(value: unknown): DifficultyPrices | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const out: DifficultyPrices = { ...DEFAULT_DIFFICULTY_PRICES };
  for (const level of ['1', '2', '3', '4', '5'] as const) {
    const rawValue = (value as Record<string, unknown>)[level];
    if (rawValue == null || rawValue === '') {
      out[level] = null;
      continue;
    }
    const amount = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    out[level] = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : null;
  }

  return out;
}

function sanitizeDifficultyPricesByCurrency(
  value: unknown,
): DifficultyPricesByCurrency | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const out: DifficultyPricesByCurrency = {};
  for (const [rawCurrencyKey, rawDifficulty] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const currencyKey = rawCurrencyKey.trim();
    if (!currencyKey) {
      continue;
    }
    out[currencyKey] = sanitizeDifficultyPrices(rawDifficulty);
  }

  return Object.keys(out).length > 0 ? out : null;
}

function hasAnyDifficultyPrice(difficulty: DifficultyPrices | null | undefined): boolean {
  if (!difficulty) {
    return false;
  }
  return Object.values(difficulty).some((value) => value != null);
}

function buildDefaultPrices(
  currencyConfigs: CurrencyConfig[],
  source: unknown,
  legacyDefaultPrice: number | null | undefined,
): CurrencyPriceMap | null {
  const sanitized = sanitizeCurrencyPriceMap(source) ?? {};
  const out: CurrencyPriceMap = { ...sanitized };

  if (currencyConfigs.length > 0) {
    for (const config of currencyConfigs) {
      if (!Object.prototype.hasOwnProperty.call(out, config.key)) {
        out[config.key] = null;
      }
    }
    if (legacyDefaultPrice != null) {
      const primaryKey = currencyConfigs[0]?.key;
      if (primaryKey && out[primaryKey] == null) {
        out[primaryKey] = legacyDefaultPrice;
      }
    }
  } else if (legacyDefaultPrice != null && Object.keys(out).length === 0) {
    out.KRW = legacyDefaultPrice;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function buildDifficultyPricesByCurrency(
  currencyConfigs: CurrencyConfig[],
  source: unknown,
  legacyDifficultyPrices: DifficultyPrices | null | undefined,
): DifficultyPricesByCurrency | null {
  const sanitized = sanitizeDifficultyPricesByCurrency(source) ?? {};

  if (currencyConfigs.length === 0) {
    if (Object.keys(sanitized).length > 0) {
      return sanitized;
    }
    if (legacyDifficultyPrices) {
      return { KRW: sanitizeDifficultyPrices(legacyDifficultyPrices) };
    }
    return null;
  }

  const out: DifficultyPricesByCurrency = {};
  for (const config of currencyConfigs) {
    out[config.key] =
      sanitized[config.key] ?? sanitizeDifficultyPrices(legacyDifficultyPrices) ?? { ...DEFAULT_DIFFICULTY_PRICES };
  }

  if (legacyDifficultyPrices) {
    const primaryKey = currencyConfigs[0]?.key;
    const current = primaryKey ? out[primaryKey] : null;
    if (primaryKey && !hasAnyDifficultyPrice(current)) {
      out[primaryKey] = sanitizeDifficultyPrices(legacyDifficultyPrices);
    }
  }

  return out;
}

function getErrorMessage(error: unknown): string | null {
  const message = extractApiErrorMessage(error, '').trim();
  return message.length > 0 ? message : null;
}

export function SongRequestSettingsContent({ user: _user }: SongRequestSettingsContentProps) {
  const { data: myChannels } = useMyChannel();
  const normalizedUser = _user.trim().toLowerCase();
  const myChannel =
    myChannels?.find((channel) => channel.webPath.toLowerCase() === normalizedUser) ??
    myChannels?.find((channel) => channel.isOwner) ??
    myChannels?.[0];
  const channelId = myChannel?.id;
  const { data: activeSession, isLoading: isSessionLoading } = useActiveSession(_user);
  const { data: channelSettings } = useChannelSongRequestSettings(channelId);
  const updateSessionSettingsMutation = useUpdateSessionSettings(_user, channelId);
  const endSessionMutation = useEndSession(_user);

  const { data: pricingSettings, isLoading: isPricingLoading } = usePricingSettings(channelId);
  const updatePricingMutation = useUpdatePricingSettings(channelId ?? 0);
  const { listQuery: categoriesQuery } = useCategoriesManagement(channelId ?? 0);
  const categories = categoriesQuery.data;

  const [settingsDraft, setSettingsDraft] = useState<Partial<RequestSettingsState>>({});
  const [priceSettingsDraft, setPriceSettingsDraft] = useState<Partial<PriceSettingsState>>({});
  const [saveAllEndConfirmOpen, setSaveAllEndConfirmOpen] = useState(false);

  // 페이지 진입 시 URL hash가 앵커 대상이면 해당 섹션으로 스크롤
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hashId = window.location.hash.replace(/^#/, '');
    if (!hashId) return;
    if (!SECTION_ANCHOR_IDS.has(hashId)) return;
    const target = document.getElementById(hashId);
    if (!target) return;
    // 섹션 DOM이 client component 마운트 직후 바로 렌더되지 않을 수 있어 다음 프레임에 스크롤
    const raf = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const settings: RequestSettingsState = {
    requestEnabled:
      settingsDraft.requestEnabled ?? activeSession?.settings?.requestEnabled ?? true,
    allowAnonymous:
      settingsDraft.allowAnonymous ??
      activeSession?.settings?.allowAnonymous ??
      channelSettings?.allowAnonymous ??
      false,
    randomRequestEnabled:
      settingsDraft.randomRequestEnabled ??
      activeSession?.settings?.randomRequestEnabled ??
      channelSettings?.randomRequestEnabled ??
      true,
    maxQueueSize:
      settingsDraft.maxQueueSize ??
      activeSession?.settings?.maxQueueSize ??
      channelSettings?.maxQueueSize ??
      50,
    requireSongMatch:
      settingsDraft.requireSongMatch ??
      activeSession?.settings?.requireSongMatch ??
      channelSettings?.requireSongMatch ??
      true,
    preventDuplicateSongs:
      settingsDraft.preventDuplicateSongs ??
      activeSession?.settings?.preventDuplicateSongs ??
      channelSettings?.preventDuplicateSongs ??
      false,
    maxRequestsPerUser:
      settingsDraft.maxRequestsPerUser ??
      activeSession?.settings?.maxRequestsPerUser ??
      channelSettings?.maxRequestsPerUser ??
      0,
    maxTotalRequests:
      settingsDraft.maxTotalRequests ??
      activeSession?.settings?.maxTotalRequests ??
      channelSettings?.maxTotalRequests ??
      50,
    blockedCategoryIds:
      settingsDraft.blockedCategoryIds ??
      activeSession?.settings?.blockedCategoryIds ??
      channelSettings?.blockedCategoryIds ??
      [],
    showRequesterName:
      settingsDraft.showRequesterName ??
      activeSession?.settings?.showRequesterName ??
      channelSettings?.showRequesterName ??
      true,
  };

  const priceSettings: PriceSettingsState = {
    pricingEnabled:
      priceSettingsDraft.pricingEnabled ??
      pricingSettings?.pricingEnabled ??
      false,
    currencyConfigs: normalizeCurrencyConfigs(
      priceSettingsDraft.currencyConfigs ??
        pricingSettings?.currencyConfigs ??
        [],
    ),
    defaultPrices: buildDefaultPrices(
      normalizeCurrencyConfigs(
        priceSettingsDraft.currencyConfigs ??
          pricingSettings?.currencyConfigs ??
          [],
      ),
      priceSettingsDraft.defaultPrices ?? pricingSettings?.defaultPrices,
      pricingSettings?.defaultPrice,
    ),
    difficultyPricesByCurrency: buildDifficultyPricesByCurrency(
      normalizeCurrencyConfigs(
        priceSettingsDraft.currencyConfigs ??
          pricingSettings?.currencyConfigs ??
          [],
      ),
      priceSettingsDraft.difficultyPricesByCurrency ??
        pricingSettings?.difficultyPricesByCurrency,
      pricingSettings?.difficultyPrices ?? DEFAULT_DIFFICULTY_PRICES,
    ),
  };

  const handleCurrencyToggle = (key: string, unit: string, checked: boolean) => {
    setPriceSettingsDraft((prev) => {
      const current = normalizeCurrencyConfigs(
        prev.currencyConfigs ?? priceSettings.currencyConfigs,
      );
      const currentDefaultPrices = sanitizeCurrencyPriceMap(
        prev.defaultPrices ?? priceSettings.defaultPrices,
      ) ?? { ...(priceSettings.defaultPrices ?? {}) };
      const currentDifficultyByCurrency = sanitizeDifficultyPricesByCurrency(
        prev.difficultyPricesByCurrency ?? priceSettings.difficultyPricesByCurrency,
      ) ?? { ...(priceSettings.difficultyPricesByCurrency ?? {}) };

      if (checked) {
        if (current.some((item) => item.key === key)) {
          return prev;
        }
        return {
          ...prev,
          currencyConfigs: [...current, { key, unit, amount: null }],
          defaultPrices: { ...currentDefaultPrices, [key]: currentDefaultPrices[key] ?? null },
          difficultyPricesByCurrency: {
            ...currentDifficultyByCurrency,
            [key]:
              currentDifficultyByCurrency[key] ??
              sanitizeDifficultyPrices(pricingSettings?.difficultyPrices) ??
              { ...DEFAULT_DIFFICULTY_PRICES },
          },
        };
      }

      const nextCurrencyConfigs = current.filter((item) => item.key !== key);
      const nextDefaultPrices = { ...currentDefaultPrices };
      const nextDifficultyByCurrency = { ...currentDifficultyByCurrency };
      delete nextDefaultPrices[key];
      delete nextDifficultyByCurrency[key];

      return {
        ...prev,
        currencyConfigs: nextCurrencyConfigs,
        defaultPrices:
          Object.keys(nextDefaultPrices).length > 0 ? nextDefaultPrices : null,
        difficultyPricesByCurrency:
          Object.keys(nextDifficultyByCurrency).length > 0
            ? nextDifficultyByCurrency
            : null,
      };
    });
  };

  const handleDefaultPriceChange = (key: string, value: string) => {
    const amount = value === '' ? null : Number(value);
    setPriceSettingsDraft((prev) => {
      const currentDefaultPrices = sanitizeCurrencyPriceMap(
        prev.defaultPrices ?? priceSettings.defaultPrices,
      ) ?? {};
      return {
        ...prev,
        defaultPrices: {
          ...currentDefaultPrices,
          [key]:
            amount == null || Number.isNaN(amount)
              ? null
              : Math.max(0, Math.floor(amount)),
        },
      };
    });
  };

  const handleDifficultyPriceChange = (
    currencyKey: string,
    level: keyof DifficultyPrices,
    value: string,
  ) => {
    const amount = value === '' ? null : Number(value);
    setPriceSettingsDraft((prev) => {
      const currentDifficultyByCurrency = sanitizeDifficultyPricesByCurrency(
        prev.difficultyPricesByCurrency ?? priceSettings.difficultyPricesByCurrency,
      ) ?? {};
      const currentDifficulty =
        sanitizeDifficultyPrices(currentDifficultyByCurrency[currencyKey]) ??
        { ...DEFAULT_DIFFICULTY_PRICES };

      return {
        ...prev,
        difficultyPricesByCurrency: {
          ...currentDifficultyByCurrency,
          [currencyKey]: {
            ...currentDifficulty,
            [level]:
              amount == null || Number.isNaN(amount)
                ? null
                : Math.max(0, Math.floor(amount)),
          },
        },
      };
    });
  };

  const handleSaveRequestSettings = async (options?: { silent?: boolean }) => {
    if (!channelId) {
      if (!options?.silent) {
        toast.error('채널 정보를 불러오지 못했습니다');
      }
      return false;
    }

    try {
      // 라이브 active + requestEnabled OFF 토글 → 세션 종료. 라이브 비활성 시는 별도 처리 불필요.
      if (activeSession?.id && !settings.requestEnabled) {
        await endSessionMutation.mutateAsync(activeSession.id);
        if (!options?.silent) {
          toast.success('신청곡 모드를 끄고 세션을 종료했습니다');
        }
        setSettingsDraft({});
        return true;
      }

      // 2026-05-14 P0 재설계: useUpdateSessionSettings 가 sessionId null 이면 channel endpoint
      // 로 자동 라우팅. 라이브 비활성 상태에서도 채널-scope 토글 변경 가능.
      await updateSessionSettingsMutation.mutateAsync({
        sessionId: activeSession?.id ?? null,
        settings: {
          ...LEGACY_DISABLED_REQUEST_SETTINGS,
          ...(activeSession?.id && { requestEnabled: settings.requestEnabled }),
          allowAnonymous: settings.allowAnonymous,
          randomRequestEnabled: settings.randomRequestEnabled,
          maxQueueSize: settings.maxQueueSize,
          requireSongMatch: settings.requireSongMatch,
          preventDuplicateSongs: settings.preventDuplicateSongs,
          maxRequestsPerUser: settings.maxRequestsPerUser,
          maxTotalRequests: settings.maxTotalRequests,
          blockedCategoryIds: settings.blockedCategoryIds,
        },
      });
      if (!options?.silent) {
        toast.success('신청곡 설정이 저장되었습니다');
      }
      setSettingsDraft({});
      return true;
    } catch (error: unknown) {
      if (!options?.silent) {
        toast.error(getErrorMessage(error) || '신청곡 설정 저장에 실패했습니다');
      }
      return false;
    }
  };

  const handleSavePriceSettings = async (options?: { silent?: boolean }) => {
    if (!channelId) {
      if (!options?.silent) {
        toast.error('채널 정보를 불러오지 못했습니다');
      }
      return false;
    }

    try {
      const primaryCurrencyKey =
        priceSettings.currencyConfigs[0]?.key ??
        Object.keys(priceSettings.defaultPrices ?? {})[0] ??
        Object.keys(priceSettings.difficultyPricesByCurrency ?? {})[0] ??
        null;
      const legacyDefaultPrice = primaryCurrencyKey
        ? (priceSettings.defaultPrices?.[primaryCurrencyKey] ?? null)
        : (pricingSettings?.defaultPrice ?? null);
      const legacyDifficultyPrices = primaryCurrencyKey
        ? (priceSettings.difficultyPricesByCurrency?.[primaryCurrencyKey] ?? null)
        : (pricingSettings?.difficultyPrices ?? null);

      await updatePricingMutation.mutateAsync({
        pricingEnabled: priceSettings.pricingEnabled,
        defaultPrice: legacyDefaultPrice,
        defaultPrices: priceSettings.defaultPrices,
        difficultyPrices: legacyDifficultyPrices,
        difficultyPricesByCurrency: priceSettings.difficultyPricesByCurrency,
        currencyConfigs: priceSettings.currencyConfigs.map((config) => ({
          key: config.key,
          unit: config.unit,
          amount: null,
        })),
      });
      setPriceSettingsDraft({});
      if (!options?.silent) {
        toast.success('참고 가격 설정이 저장되었습니다');
      }
      return true;
    } catch (error: unknown) {
      if (!options?.silent) {
        toast.error(getErrorMessage(error) || '참고 가격 설정 저장에 실패했습니다');
      }
      return false;
    }
  };

  const handleSaveAllSettings = async () => {
    const canSavePrice = !!channelId;
    const canSaveRequest = !!channelId;

    if (!canSavePrice && !canSaveRequest) {
      toast.error('저장할 설정 대상을 찾을 수 없습니다');
      return;
    }

    let savedCount = 0;
    let hasFailure = false;

    if (canSavePrice) {
      const ok = await handleSavePriceSettings({ silent: true });
      if (ok) {
        savedCount += 1;
      } else {
        hasFailure = true;
      }
    }

    if (canSaveRequest) {
      const ok = await handleSaveRequestSettings({ silent: true });
      if (ok) {
        savedCount += 1;
      } else {
        hasFailure = true;
      }
    }

    if (savedCount > 0 && !hasFailure) {
      toast.success('설정이 저장되었습니다');
      return;
    }

    if (savedCount > 0 && hasFailure) {
      toast.error('일부 설정 저장에 실패했습니다');
      return;
    }

    toast.error('설정 저장에 실패했습니다');
  };

  const changedCount =
    Object.keys(settingsDraft).length +
    Object.keys(priceSettingsDraft).length;

  return (
    <div className="p-6">
      <ManagementHeader
        title="신청곡 설정"
        description="노래책에서 받는 신청 규칙과 팬에게 보여줄 참고 가격을 설정합니다."
        icon={ListOrdered}
      />

      <ContextualHint hintKey="song_request_settings_hint">
        여기서 설정한 내용은 신청곡 모드 시작 후 적용됩니다.
        기본 설정만 해두면 바로 신청곡을 받을 수 있어요.
        설정을 마친 뒤에는 <strong>오버레이 설정</strong>에서 방송 화면에 표시할 위젯을 꾸며보세요.
      </ContextualHint>

      <div className="mb-4">
        <SessionModeCard
          user={_user}
          sessionId={activeSession?.id ?? null}
          isPaused={activeSession?.settings?.paused ?? false}
          isLoading={isSessionLoading}
        />
      </div>

      <SectionAnchorBar />

      <Card className="py-0">
        <CardContent className="px-4">
          <div>
            <SessionSettingsFields
              settings={settings}
              onChange={(partial) =>
                setSettingsDraft((prev) => ({ ...prev, ...partial }))
              }
              hasActiveSession={!!activeSession?.id}
              categories={categories?.map((c) => ({
                id: c.id,
                name: c.name,
                color: c.color ?? null,
              }))}
              hideRequesterNameToggle
              hidePlaybackSection
              hideRequestEnabledRow
              basicSectionId="basic-settings"
              conditionsSectionId="request-conditions"
              rulesSectionId="request-rules"
            />

            <OmakaseSettingsSection channelId={channelId} />

            {/* 팬에게 보여줄 참고 가격 설정 */}
            <div id="pricing" className="scroll-mt-20">
              <SectionHeader title="참고 가격 설정" />
            </div>

            {isPricingLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <SettingRow
                  title="참고 가격 표시"
                  description="노래책에서 팬에게 곡별 참고 가격을 보여줍니다. 신청 접수와 재생 순서에는 영향을 주지 않습니다"
                >
                  <Switch
                    checked={priceSettings.pricingEnabled}
                    onCheckedChange={(checked) =>
                      setPriceSettingsDraft((prev) => ({ ...prev, pricingEnabled: checked }))
                    }
                  />
                </SettingRow>

                {priceSettings.pricingEnabled && (
                  <>
                    <SettingRow
                      title="재화 선택"
                      description="팬에게 보여줄 가격 단위와 기본·난이도별 참고 가격을 설정합니다"
                    >
                      <div className="space-y-3">
                        {AVAILABLE_CURRENCY_OPTIONS.map((option) => {
                          const selected = priceSettings.currencyConfigs.find(
                            (config) => config.key === option.key,
                          );
                          return (
                            <div key={option.key} className="flex flex-wrap items-center gap-2">
                              <Switch
                                checked={!!selected}
                                onCheckedChange={(checked) =>
                                  handleCurrencyToggle(option.key, option.unit, checked)
                                }
                              />
                              <span className="text-sm min-w-28">{option.label}</span>
                              {selected && (
                                <span className="text-xs text-muted-foreground">
                                  선택됨
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </SettingRow>

                    <SettingRow title="기본 참고 가격" description="개별 참고 가격이 없는 곡에 표시됩니다">
                      {priceSettings.currencyConfigs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          재화를 먼저 선택해주세요.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {priceSettings.currencyConfigs.map((config) => (
                            <div key={config.key} className="flex items-center gap-2">
                              <span className="text-sm min-w-24">{config.unit}</span>
                              <Input
                                type="number"
                                min="0"
                                value={priceSettings.defaultPrices?.[config.key] ?? ''}
                                onChange={(e) =>
                                  handleDefaultPriceChange(config.key, e.target.value)
                                }
                                placeholder="미설정"
                                className="w-36 font-mono"
                              />
                              <span className="text-sm text-muted-foreground">{config.unit}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </SettingRow>

                    <SettingRow title="난이도별 참고 가격" description="곡 난이도별 참고 가격을 재화마다 따로 설정합니다">
                      {priceSettings.currencyConfigs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          재화를 먼저 선택해주세요.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {priceSettings.currencyConfigs.map((config) => (
                            <div key={config.key} className="space-y-2">
                              <div className="text-sm font-medium">{config.unit}</div>
                              {(['1', '2', '3', '4', '5'] as const).map((level) => (
                                <div key={`${config.key}-${level}`} className="flex items-center gap-3">
                                  <div className="flex w-24">
                                    {Array.from({ length: Number(level) }).map((_, i) => (
                                      <Star
                                        key={i}
                                        className="size-4 text-yellow-400 fill-yellow-400"
                                      />
                                    ))}
                                  </div>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={
                                      priceSettings.difficultyPricesByCurrency?.[config.key]?.[level] ??
                                      ''
                                    }
                                    onChange={(e) =>
                                      handleDifficultyPriceChange(
                                        config.key,
                                        level,
                                        e.target.value,
                                      )
                                    }
                                    placeholder="미설정"
                                    className="w-28 font-mono"
                                  />
                                  <span className="text-sm text-muted-foreground">
                                    {config.unit}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </SettingRow>

                    <SettingRow title="카테고리별 참고 가격" description="카테고리에 따라 다른 참고 가격을 설정합니다">
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          카테고리 관리에서 각 카테고리의 참고 가격을 재화별로 설정할 수 있습니다.
                        </p>
                      </div>
                    </SettingRow>

                    <SettingRow title="참고 가격 표시 순서">
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>1. 곡 자체 참고 가격</div>
                        <div>2. 난이도/카테고리 참고 가격 (높은 값 적용)</div>
                        <div>3. 기본 참고 가격</div>
                      </div>
                    </SettingRow>
                  </>
                )}
              </>
            )}

            {!activeSession?.id && (
              <p className="py-4 text-xs text-muted-foreground">
                저장한 신청곡 운영 설정은 다음 신청곡 모드를 시작할 때 적용됩니다.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {changedCount > 0 && (
        <FloatingSaveBar
          changedCount={changedCount}
          onSave={() => {
            const willEndSession =
              !!activeSession?.id && !settings.requestEnabled;
            if (willEndSession) {
              setSaveAllEndConfirmOpen(true);
              return;
            }
            void handleSaveAllSettings();
          }}
          onReset={() => {
            setSettingsDraft({});
            setPriceSettingsDraft({});
          }}
          isPending={
            updateSessionSettingsMutation.isPending ||
            updatePricingMutation.isPending ||
            endSessionMutation.isPending
          }
        />
      )}

      <EndSessionConfirmDialog
        open={saveAllEndConfirmOpen}
        onOpenChange={(next) => {
          if (!next && !endSessionMutation.isPending)
            setSaveAllEndConfirmOpen(false);
        }}
        onConfirm={async () => {
          await handleSaveAllSettings();
          setSaveAllEndConfirmOpen(false);
        }}
        isPending={endSessionMutation.isPending}
      />
    </div>
  );
}
