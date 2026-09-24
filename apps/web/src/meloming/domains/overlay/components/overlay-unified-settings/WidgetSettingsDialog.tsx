"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isEqual } from "es-toolkit";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  toUpdateBody,
  type UnifiedThemeConfig,
  type WidgetType,
} from "@/meloming/domains/channel/apis/overlay-theme";
import {
  useThemeCatalog,
  useUnifiedThemeConfig,
  useUpdateUnifiedThemeConfig,
} from "@/meloming/domains/channel/hooks/use-overlay-theme";
import { WidgetTabContent } from "../theme-management/WidgetTabContent";
import { WIDGET_LABELS } from "../theme-management/utils";

interface WidgetSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelIdentifier: string;
  widgetType: WidgetType;
}

export function WidgetSettingsDialog({
  open,
  onOpenChange,
  channelIdentifier,
  widgetType,
}: WidgetSettingsDialogProps) {
  const { data: config, isLoading: configLoading } =
    useUnifiedThemeConfig(channelIdentifier, open);
  const { data: catalogData, isLoading: catalogLoading } = useThemeCatalog();
  const mutation = useUpdateUnifiedThemeConfig(channelIdentifier);

  const [draft, setDraft] = useState<UnifiedThemeConfig | null>(null);
  const seededKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededKeyRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 모달 닫힘 시 draft 리셋
      setDraft(null);
      return;
    }
    if (!config) return;
    const key = `${widgetType}`;
    if (seededKeyRef.current === key) return;
    seededKeyRef.current = key;
    setDraft(structuredClone(config));
  }, [open, config, widgetType]);

  const isDirty = useMemo(() => {
    if (!draft || !config) return false;
    return !isEqual(draft, config);
  }, [draft, config]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    try {
      await mutation.mutateAsync(toUpdateBody(draft));
      toast.success(`${WIDGET_LABELS[widgetType]} 설정이 저장되었습니다`);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "저장에 실패했습니다";
      toast.error(message);
    }
  }, [draft, mutation, widgetType, onOpenChange]);

  const handleRequestClose = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        "저장하지 않은 변경사항이 있습니다. 닫을까요?",
      );
      if (!confirmed) return;
    }
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  const isLoading = configLoading || catalogLoading;
  const catalog = catalogData?.themes ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          handleRequestClose();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-3xl p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-3 flex-shrink-0 border-b">
          <DialogTitle>{WIDGET_LABELS[widgetType]} 설정</DialogTitle>
          <DialogDescription>
            이 위젯의 테마와 옵션을 수정합니다. 저장 시 오버레이에 즉시 반영됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading || !draft ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <WidgetTabContent
              widgetType={widgetType}
              draft={draft}
              onChange={setDraft}
              catalog={catalog}
            />
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={handleRequestClose}>
            취소
          </Button>
          <Button
            onClick={handleSave}
            disabled={!isDirty || mutation.isPending || isLoading || !draft}
          >
            {mutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
