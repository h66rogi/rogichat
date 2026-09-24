'use client';

import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/meloming/shared/components/ui/dialog';
import { Button } from '@/meloming/shared/components/ui/button';
import { Input } from '@/meloming/shared/components/ui/input';
import { cn } from '@/meloming/shared/lib/utils';

interface OverlayCopyGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  widgetName?: string;
  width?: number;
  height?: number;
}

export function OverlayCopyGuideDialog({
  open,
  onOpenChange,
  url,
  widgetName = '통합 오버레이',
  width = 1920,
  height = 1080,
}: OverlayCopyGuideDialogProps) {
  const [recopied, setRecopied] = useState(false);

  const handleRecopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setRecopied(true);
      toast.success('URL을 다시 복사했어요');
      setTimeout(() => setRecopied(false), 2000);
    } catch {
      toast.error('복사에 실패했어요. 수동으로 복사해주세요');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
              <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <DialogTitle>{widgetName} URL이 복사되었어요</DialogTitle>
              <DialogDescription>
                OBS(또는 방송 프로그램)에 브라우저 소스로 아래 권장 크기로 추가하세요
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 권장 크기 강조 */}
        <div className="rounded-xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            브라우저 소스 권장 크기
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums">
              {width.toLocaleString()}
            </span>
            <span className="text-muted-foreground">×</span>
            <span className="font-mono text-2xl font-bold tabular-nums">
              {height.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">px</span>
          </div>
        </div>

        {/* 복사된 URL */}
        {url && (
          <div className="space-y-1.5 min-w-0">
            <div className="text-xs font-medium text-muted-foreground">복사된 URL</div>
            <div className="flex items-center gap-2 min-w-0">
              <Input
                readOnly
                value={url}
                title={url}
                className="flex-1 min-w-0 font-mono text-xs"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={handleRecopy}
                aria-label="URL 다시 복사"
                className="shrink-0"
              >
                {recopied ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* 단계 안내 */}
        <ol className="space-y-3">
          <li className="flex gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-muted text-xs font-bold shrink-0">
              1
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-medium">브라우저 소스 추가</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                OBS 소스 패널에서{' '}
                <span className="font-semibold text-foreground">+</span> →{' '}
                <span className="font-semibold text-foreground">브라우저</span> 선택
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-muted text-xs font-bold shrink-0">
              2
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-medium">URL 붙여넣기</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                복사한 주소를 브라우저 소스의 URL 필드에 붙여넣으세요
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-muted text-xs font-bold shrink-0">
              3
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-medium">
                크기를{' '}
                <span className="font-mono font-semibold text-primary">
                  {width.toLocaleString()} × {height.toLocaleString()}
                </span>
                로 설정
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                너비/높이를 권장 크기로 맞춰야 방송 화면에 잘리지 않아요
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <div
              className={cn(
                'flex items-center justify-center size-7 rounded-lg shrink-0',
                'bg-green-500/15 text-xs font-bold text-green-600',
              )}
            >
              ✓
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-medium">완료</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                확인을 누르면 {widgetName}이(가) 방송 화면에 표시됩니다. 배경은
                기본적으로 투명입니다.
              </p>
            </div>
          </li>
        </ol>

        {/* OBS 버전 주의 */}
        <div className="flex gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              OBS 31.0.0 이상
            </span>
            에서만 배경 투명이 정상 작동해요. 이전 버전에선 배경이 까맣게 표시될 수 있어요.
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
