'use client';

import { BookmarkCheck, Loader2, Minus, Plus, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/meloming/shared/components/ui/button';
import { Slider } from '@/meloming/shared/components/ui/slider';
import { cn } from '@/meloming/shared/lib/utils';

const MIN_SEMITONES = -6;
const MAX_SEMITONES = 6;

interface SaveSlot {
  /** 현재 곡에 저장된 키. null = 미저장. */
  savedSemitones: number | null;
  /** 슬라이더 값이 저장값과 다른가. true 면 저장 버튼 활성. */
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  /** 저장값 초기화(0 으로 PATCH). 저장된 값이 있을 때만 노출. */
  onClear: () => void;
}

interface PitchShiftControlProps {
  value: number;
  onChange: (semitones: number) => void;
  bypass: boolean;
  onBypassChange: (bypass: boolean) => void;
  unsupported?: boolean;
  /** 원곡 키 (예: "C", "D#"). 표시용. */
  referenceKey?: string | null;
  /** 원곡 BPM. 표시용. */
  referenceBpm?: number | null;
  /** 게이트웨이를 거치지 않는 영상이라 pitch shift가 동작하지 않을 때. */
  unavailableReason?: string | null;
  /** 곡 단위 키 저장. null 이면 저장 UI 미노출 (예: songId/channelIdentifier 없음). */
  saveSlot?: SaveSlot | null;
}

function formatSemitones(value: number): string {
  if (value === 0) return '원곡';
  return value > 0 ? `+${value}` : `${value}`;
}

export function PitchShiftControl({
  value,
  onChange,
  bypass,
  onBypassChange,
  unsupported,
  referenceKey,
  referenceBpm,
  unavailableReason,
  saveSlot,
}: PitchShiftControlProps) {
  const disabled = !!unsupported || !!unavailableReason;
  const clamp = (v: number) =>
    Math.max(MIN_SEMITONES, Math.min(MAX_SEMITONES, v));
  const hasSavedValue =
    saveSlot != null &&
    saveSlot.savedSemitones != null &&
    saveSlot.savedSemitones !== 0;
  const hasReferenceInfo = Boolean(referenceKey) || referenceBpm != null;

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border border-border bg-card/40 px-3 py-2.5',
        disabled && 'opacity-60'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground">키 조절</span>
          {referenceKey && (
            <span className="text-[11px] text-muted-foreground/80">
              원곡 {referenceKey}
            </span>
          )}
          {hasSavedValue && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
              <BookmarkCheck className="size-2.5" />
              저장 {formatSemitones(saveSlot!.savedSemitones!)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm tabular-nums">
            {formatSemitones(value)}
          </span>
          <span className="text-[10px] text-muted-foreground">semitone</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-7"
          disabled={disabled || value <= MIN_SEMITONES}
          onClick={() => onChange(clamp(value - 1))}
          aria-label="키 1단계 내림"
        >
          <Minus className="size-3.5" />
        </Button>
        <Slider
          min={MIN_SEMITONES}
          max={MAX_SEMITONES}
          step={1}
          value={[value]}
          onValueChange={(values) => onChange(clamp(values[0] ?? 0))}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-7"
          disabled={disabled || value >= MAX_SEMITONES}
          onClick={() => onChange(clamp(value + 1))}
          aria-label="키 1단계 올림"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={bypass}
            disabled={disabled}
            onChange={(e) => onBypassChange(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          <span>Bypass</span>
        </label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-muted-foreground"
            disabled={disabled || value === 0}
            onClick={() => onChange(0)}
          >
            <RotateCcw className="size-3" />
            <span>Reset</span>
          </Button>
          {saveSlot && (
            <>
              {hasSavedValue && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-muted-foreground"
                  disabled={disabled || saveSlot.isSaving}
                  onClick={saveSlot.onClear}
                  title="저장된 키를 지우고 원곡으로 되돌립니다"
                >
                  <span>저장 지우기</span>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={saveSlot.isDirty ? 'default' : 'outline'}
                className="h-7 gap-1"
                disabled={disabled || saveSlot.isSaving || !saveSlot.isDirty}
                onClick={saveSlot.onSave}
                title={
                  saveSlot.isDirty
                    ? '현재 키를 이 곡에 저장 (다음 재생 시 자동 적용)'
                    : '이미 저장된 값과 동일'
                }
              >
                {saveSlot.isSaving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Save className="size-3" />
                )}
                <span>이 키로 저장</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {unsupported && (
        <p className="text-[11px] text-muted-foreground">
          이 브라우저는 키 조절을 지원하지 않습니다 (AudioWorklet 미지원).
        </p>
      )}
      {!unsupported && unavailableReason && (
        <p className="text-[11px] text-muted-foreground">{unavailableReason}</p>
      )}

      {hasReferenceInfo && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
          <span className="mr-0.5 text-[10px] font-medium text-muted-foreground">
            참고
          </span>
          {referenceKey && (
            <span className="inline-flex h-5 items-center rounded-full border bg-background px-2 text-[10px] font-medium">
              키 {referenceKey}
            </span>
          )}
          {referenceBpm != null && (
            <span className="inline-flex h-5 items-center rounded-full border bg-background px-2 text-[10px] font-medium tabular-nums">
              {referenceBpm} BPM
            </span>
          )}
        </div>
      )}
    </div>
  );
}
