'use client';

import type { KaraokePlaybackMode, KaraokeVideoType } from '@/meloming/domains/overlay/apis/session';
import { Switch } from '@/meloming/shared/components/ui/switch';
import { Label } from '@/meloming/shared/components/ui/label';
import { SegmentedControl } from '@/meloming/shared/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/meloming/shared/components/ui/select';
import { cn } from '@/meloming/shared/lib/utils';
import {
  SettingsCompactProvider,
  SettingsNumberInput,
  SettingsRow,
  SettingsSectionHeader,
  useCompactSettings,
} from '@/meloming/shared/components/common/settings-form';

export { useCompactSettings };
export type RequestSettingsState = {
  requestEnabled: boolean;
  allowAnonymous: boolean;
  randomRequestEnabled: boolean;
  maxQueueSize: number;
  requireSongMatch: boolean;
  preventDuplicateSongs: boolean;
  maxRequestsPerUser: number;
  maxTotalRequests: number;
  blockedCategoryIds: number[];
  showRequesterName: boolean;
};

export type SessionCategoryOption = {
  id: number;
  name: string;
  color: string | null;
};

export const SettingRow = SettingsRow;
export const SectionHeader = SettingsSectionHeader;
export const NumberCommitInput = SettingsNumberInput;

interface SessionSettingsFieldsProps {
  settings: RequestSettingsState;
  onChange: (partial: Partial<RequestSettingsState>) => void;

  /** 리모컨 재생 설정. hidePlaybackSection=true면 생략 가능. */
  karaokePlaybackMode?: KaraokePlaybackMode;
  onKaraokePlaybackModeChange?: (value: KaraokePlaybackMode) => void | Promise<void>;
  karaokeVideoType?: KaraokeVideoType;
  onKaraokeVideoTypeChange?: (value: KaraokeVideoType) => void | Promise<void>;
  playbackSettingsDisabled?: boolean;

  hasActiveSession: boolean;
  disabled?: boolean;

  categories?: SessionCategoryOption[];

  isPaused?: boolean;
  onPausedChange?: (value: boolean) => void;
  showPauseToggle?: boolean;
  pausedDisabled?: boolean;

  /** 신청자 이름 표시 토글 숨김 (오버레이 설정 페이지로 분리됨) */
  hideRequesterNameToggle?: boolean;
  /** 리모컨 재생 설정 섹션 숨김 (리모컨 페이지로 분리됨) */
  hidePlaybackSection?: boolean;
  /** "신청곡 받기" 행 숨김 (페이지 상단 전용 카드에서 관리) */
  hideRequestEnabledRow?: boolean;
  /** 싱크 라이브세션처럼 채널 단일 카테고리 차단을 지원하지 않는 설정에서 숨김 */
  hideBlockedCategories?: boolean;
  /** 컴팩트 모드 — 좁은 사이드패널용. 라벨 폭/패딩/폰트 축소 */
  compact?: boolean;
  /** 앵커 네비게이션용 — "기본 설정" 섹션 헤더에 지정할 id */
  basicSectionId?: string;
  /** 앵커 네비게이션용 — "신청 조건" 섹션 헤더에 지정할 id */
  conditionsSectionId?: string;
  /** 앵커 네비게이션용 — "신청 규칙" 섹션 헤더에 지정할 id */
  rulesSectionId?: string;
}

export function SessionSettingsFields({
  settings,
  onChange,
  karaokePlaybackMode,
  onKaraokePlaybackModeChange,
  karaokeVideoType,
  onKaraokeVideoTypeChange,
  playbackSettingsDisabled = false,
  hasActiveSession,
  disabled = false,
  categories,
  isPaused,
  onPausedChange,
  showPauseToggle = false,
  pausedDisabled = false,
  hideRequesterNameToggle = false,
  hidePlaybackSection = false,
  hideRequestEnabledRow = false,
  hideBlockedCategories = false,
  compact = false,
  basicSectionId,
  conditionsSectionId,
  rulesSectionId,
}: SessionSettingsFieldsProps) {
  return (
    <SettingsCompactProvider compact={compact}>
    <div>
      <SectionHeader title="기본 설정" id={basicSectionId} />

      {!hideRequestEnabledRow && (
        <SettingRow title="신청곡 받기" description="끄면 신청곡 모드가 종료됩니다">
          <div className="space-y-3">
            <SegmentedControl
              value={settings.requestEnabled ? 'on' : 'off'}
              options={[
                { value: 'on', label: '받는중' },
                { value: 'off', label: '중지' },
              ]}
              disabled={disabled}
              onValueChange={(value) =>
                onChange({ requestEnabled: value === 'on' })
              }
              aria-label="신청곡 받기"
            />
            {showPauseToggle && settings.requestEnabled && onPausedChange && (
              <div className="flex items-center justify-between pt-3 border-t border-dashed">
                <div>
                  <Label className="text-sm font-medium">일시정지</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    신청곡 모드는 유지하되 신청은 받지 않음
                  </p>
                </div>
                <Switch
                  checked={!!isPaused}
                  disabled={pausedDisabled}
                  onCheckedChange={onPausedChange}
                />
              </div>
            )}
          </div>
        </SettingRow>
      )}

      <SettingRow
        title="최대 대기 곡 수"
        description="대기열이 가득 차면 더 이상 신청을 받지 않습니다"
      >
        <div className="flex items-center gap-2">
          <NumberCommitInput
            value={settings.maxQueueSize}
            min={1}
            max={200}
            disabled={disabled}
            className="w-24"
            onCommit={(v) => onChange({ maxQueueSize: v })}
          />
          <span className="text-sm text-muted-foreground">곡</span>
        </div>
      </SettingRow>

      <SettingRow
        title="세션당 최대 곡 수"
        description="세션 동안 받을 수 있는 총 신청곡 수를 제한합니다 (0 = 무제한)"
      >
        <div className="flex items-center gap-2">
          <NumberCommitInput
            value={settings.maxTotalRequests}
            min={0}
            max={500}
            disabled={disabled}
            className="w-24"
            onCommit={(v) => onChange({ maxTotalRequests: v })}
          />
          <span className="text-sm text-muted-foreground">곡</span>
        </div>
      </SettingRow>

      {!hideRequesterNameToggle && (
        <SettingRow
          title="신청자 이름 표시"
          description="오버레이에 곡 신청자의 닉네임을 표시합니다"
        >
          <Switch
            checked={settings.showRequesterName}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ showRequesterName: checked })}
          />
        </SettingRow>
      )}

      <SectionHeader title="신청 조건" id={conditionsSectionId} />

      <SettingRow
        title="랜덤 신청 허용"
        description="노래책 페이지의 '랜덤신청' 버튼을 활성화합니다. 끄면 시청자가 임의의 한 곡을 신청할 수 없습니다"
      >
        <Switch
          checked={settings.randomRequestEnabled}
          onCheckedChange={(checked) =>
            onChange({ randomRequestEnabled: checked })
          }
          disabled={disabled}
          aria-label="랜덤 신청 허용"
        />
      </SettingRow>

      <SettingRow
        title="익명 신청 허용"
        description="로그인 없이 닉네임만 입력해 웹에서 신청할 수 있도록 허용합니다. 남용 방지를 위해 IP당 1분 10건으로 자동 제한됩니다"
      >
        <div className="space-y-1.5">
          <Switch
            checked={settings.allowAnonymous}
            onCheckedChange={(checked) =>
              onChange({ allowAnonymous: checked })
            }
            disabled={disabled}
            aria-label="익명 신청 허용"
          />
          {settings.allowAnonymous && (
            <p className="text-[11px] text-muted-foreground leading-tight">
              신청자 이름은 <span className="font-mono">익명 (웹신청) &#123;닉네임&#125;</span>으로 표시돼요
            </p>
          )}
        </div>
      </SettingRow>

      <SectionHeader title="신청 규칙" id={rulesSectionId} />

      <SettingRow
        title="신청 가능 곡"
        description="노래책만: 등록된 곡만 신청 가능 · 모든 곡: 미등록 곡도 스트리머/매니저가 직접 추가"
      >
        <SegmentedControl
          value={settings.requireSongMatch ? 'songbook-only' : 'all'}
          options={[
            { value: 'songbook-only', label: '노래책만' },
            { value: 'all', label: '모든 곡' },
          ]}
          disabled={disabled}
          onValueChange={(value) =>
            onChange({ requireSongMatch: value === 'songbook-only' })
          }
          aria-label="신청 가능 곡"
        />
      </SettingRow>

      <SettingRow
        title="동일 곡 중복 신청 방지"
        description="같은 곡을 두 번 이상 신청할 수 없습니다"
      >
        <Switch
          checked={settings.preventDuplicateSongs}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ preventDuplicateSongs: checked })
          }
        />
      </SettingRow>

      {!hideBlockedCategories && (
        <SettingRow
          title="신청 불가 카테고리"
          description="선택한 카테고리의 곡은 신청할 수 없습니다"
        >
          {categories && categories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => {
                const isSelected = settings.blockedCategoryIds.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const next = isSelected
                        ? settings.blockedCategoryIds.filter(
                            (id) => id !== category.id,
                          )
                        : [...settings.blockedCategoryIds, category.id];
                      onChange({ blockedCategoryIds: next });
                    }}
                    className={cn(
                      'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                      isSelected
                        ? 'border-transparent text-white'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                    style={
                      isSelected && category.color
                        ? { backgroundColor: category.color }
                        : undefined
                    }
                  >
                    {category.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              등록된 카테고리가 없습니다
            </p>
          )}
        </SettingRow>
      )}

      <SettingRow
        title="1인당 신청 곡수 제한"
        description="한 사람이 신청할 수 있는 최대 곡 수를 설정합니다"
      >
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.maxRequestsPerUser > 0}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({
                maxRequestsPerUser: checked
                  ? settings.maxRequestsPerUser || 3
                  : 0,
              })
            }
          />
          {settings.maxRequestsPerUser > 0 && (
            <div className="flex items-center gap-2">
              <NumberCommitInput
                value={settings.maxRequestsPerUser}
                min={1}
                max={100}
                disabled={disabled}
                className="w-24"
                onCommit={(v) => onChange({ maxRequestsPerUser: v })}
              />
              <span className="text-sm text-muted-foreground">곡</span>
            </div>
          )}
        </div>
      </SettingRow>

      {!hidePlaybackSection &&
        karaokePlaybackMode &&
        karaokeVideoType &&
        onKaraokePlaybackModeChange &&
        onKaraokeVideoTypeChange && (
          <>
            <SectionHeader title="리모컨 (신청곡 콘솔)" />

            <SettingRow
              title="영상 재생 방식"
              description="리모컨 (신청곡 콘솔)의 노래방 영상 재생 방식을 선택합니다"
            >
              <div className="space-y-2">
                <Select
                  value={karaokePlaybackMode}
                  onValueChange={(value) =>
                    onKaraokePlaybackModeChange(value as KaraokePlaybackMode)
                  }
                >
                  <SelectTrigger disabled={playbackSettingsDisabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIRECT">직접 재생</SelectItem>
                    <SelectItem value="YOUTUBE">YouTube 임베드 재생</SelectItem>
                  </SelectContent>
                </Select>
                {!hasActiveSession && (
                  <p className="text-xs text-muted-foreground">
                    신청곡 모드 시작 후에 변경할 수 있습니다
                  </p>
                )}
              </div>
            </SettingRow>

            <SettingRow
              title="재생 영상 종류"
              description="리모컨 (신청곡 콘솔)에서 기본으로 재생할 영상을 선택합니다"
            >
              <div className="space-y-2">
                <Select
                  value={karaokeVideoType}
                  onValueChange={(value) =>
                    onKaraokeVideoTypeChange(value as KaraokeVideoType)
                  }
                >
                  <SelectTrigger disabled={playbackSettingsDisabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KARAOKE">노래방 영상</SelectItem>
                    <SelectItem value="ORIGINAL">원본(원곡) 영상</SelectItem>
                  </SelectContent>
                </Select>
                {!hasActiveSession && (
                  <p className="text-xs text-muted-foreground">
                    신청곡 모드 시작 후에 변경할 수 있습니다
                  </p>
                )}
              </div>
            </SettingRow>
          </>
        )}
    </div>
    </SettingsCompactProvider>
  );
}
