"use client";

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";

interface PsdWarningsDialogProps {
  /**
   * 표시할 경고 목록. `null` 이면 다이얼로그를 닫음 (lazy mount).
   * 빈 배열이 들어오면 "경고 없음" 메시지를 보여 준다 (방어적).
   */
  warnings: string[] | null;
  onClose: () => void;
}

/**
 * PSD 파싱 시 백엔드가 보낸 경고 목록 다이얼로그 (F8 Phase 1).
 *
 * 자주 등장하는 경고 예시:
 *  - "Font 'NotoSansKR' is not in the bundle, will fall back to Pretendard"
 *  - "Layer 'Logo' has unsupported blend mode, fell back to flatten"
 *
 * 메시지 자체는 영문(서버가 그대로 노출)이며 향후 i18n 시점에 한국어 매핑.
 */
export function PsdWarningsDialog({
  warnings,
  onClose,
}: PsdWarningsDialogProps) {
  const open = warnings !== null;
  const list = warnings ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            PSD 파싱 경고
            {list.length > 0 && (
              <span className="text-muted-foreground text-sm">
                ({list.length}건)
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            PSD 파싱이 완료됐지만 일부 항목은 자동 폴백으로 처리됐어요. 결과
            이미지에 큰 문제가 없으면 그대로 사용해도 괜찮아요.
          </DialogDescription>
        </DialogHeader>

        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">경고가 없습니다.</p>
        ) : (
          <ul className="space-y-2 text-sm max-h-72 overflow-auto pr-2">
            {list.map((warning, idx) => (
              <li
                key={`${idx}-${warning.slice(0, 40)}`}
                className="rounded-md border bg-muted/40 px-3 py-2 break-words"
              >
                {warning}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
