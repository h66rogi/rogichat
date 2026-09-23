"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Ban, ListX, Pause } from "lucide-react";

export type SongRequestActionModalVariant =
  | "blocked"
  | "paused"
  | "queue-full";

interface SongRequestActionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: SongRequestActionModalVariant;
}

interface VariantConfig {
  icon: typeof Ban;
  iconTone: string;
  title: string;
  description: string;
}

const STATIC_VARIANTS: Record<SongRequestActionModalVariant, VariantConfig> = {
  blocked: {
    icon: Ban,
    iconTone: "text-rose-500 bg-rose-500/10",
    title: "신청할 수 없는 곡이에요",
    description: "스트리머가 이 카테고리의 신청을 받지 않고 있어요.",
  },
  paused: {
    icon: Pause,
    iconTone: "text-amber-500 bg-amber-500/10",
    title: "신청이 일시정지돼 있어요",
    description: "스트리머가 신청을 잠시 멈췄어요. 조금 뒤에 다시 시도해보세요.",
  },
  "queue-full": {
    icon: ListX,
    iconTone: "text-rose-500 bg-rose-500/10",
    title: "대기열이 가득 찼어요",
    description: "기다리는 곡이 너무 많아요. 잠시 후 다시 시도해주세요.",
  },
};

export function SongRequestActionModal({
  open,
  onOpenChange,
  variant,
}: SongRequestActionModalProps) {
  const config = STATIC_VARIANTS[variant];
  const Icon = config.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`size-8 rounded-full flex items-center justify-center ${config.iconTone}`}>
              <Icon className="size-4" />
            </span>
            {config.title}
          </DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>확인</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
