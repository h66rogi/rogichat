import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Button } from "../ui/button";
import { josa } from "es-hangul";

interface ConfirmWithInputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  requiredText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmWithInputDialog({
  open,
  onOpenChange,
  title = "정말로 진행하시겠습니까?",
  description = "안전한 진행을 위해 아래에 확인 문구를 입력해주세요.",
  requiredText = "삭제",
  confirmLabel = "삭제",
  cancelLabel = "취소",
  onConfirm,
}: ConfirmWithInputDialogProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMatch = value.trim() === requiredText;

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const handleConfirm = async () => {
    if (!isMatch || isSubmitting) return;
    try {
      setIsSubmitting(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-input">
            확인 문구 입력:{" "}
            <span className="font-semibold">{requiredText}</span>
          </Label>
          <Input
            id="confirm-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={requiredText}
          />
          <p className="text-xs text-muted-foreground">
            입력 값이 정확히 "{requiredText}" {josa.pick(requiredText, "와/과")}{" "}
            일치해야 계속할 수 있어요.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isMatch || isSubmitting}
          >
            {isSubmitting ? "처리 중..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
