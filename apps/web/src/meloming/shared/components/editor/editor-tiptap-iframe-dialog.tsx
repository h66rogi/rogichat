import { useCallback, useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Label } from "@/meloming/shared/components/ui/label";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import {
  ALLOWED_EMBED_DOMAINS,
  isAllowedEmbedDomain,
} from "@/meloming/shared/constants/embed";

type EditorIframeDialogProps = {
  editor: Editor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
function extractIframeSrc(embedCode: string): string | null {
  const iframeMatch = embedCode.match(/<iframe[^>]*src=["']([^"']+)["']/i);
  if (iframeMatch) {
    return iframeMatch[1];
  }
  return null;
}

export function EditorIframeDialog({
  editor,
  open,
  onOpenChange,
}: EditorIframeDialogProps) {
  const [embedCode, setEmbedCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setEmbedCode("");
      setError("");
    }
  }, [open]);

  const handleEmbedInsert = useCallback(() => {
    if (!editor) return;

    if (!embedCode.trim()) {
      setError("임베드 코드를 입력해주세요.");
      return;
    }

    const src = extractIframeSrc(embedCode.trim());
    if (!src) {
      setError("유효한 iframe 태그를 찾을 수 없습니다.");
      return;
    }

    if (!isAllowedEmbedDomain(src)) {
      setError(
        `허용되지 않은 도메인입니다. 허용된 도메인: ${ALLOWED_EMBED_DOMAINS.join(
          ", "
        )}`
      );
      return;
    }

    editor.chain().focus().setIframe({ src }).run();
    onOpenChange(false);
  }, [editor, embedCode, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>임베드 추가</AlertDialogTitle>
          <AlertDialogDescription>
            YouTube, Vimeo, Instagram, Twitter 등의 임베드 코드를 붙여넣으세요.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="iframe-embed">임베드 코드</Label>
            <Textarea
              id="iframe-embed"
              value={embedCode}
              onChange={(e) => {
                setEmbedCode(e.target.value);
                setError("");
              }}
              placeholder='<iframe src="https://..." ...></iframe>'
              className="mt-2 font-mono text-sm min-h-[180px]"
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            <strong>허용된 도메인:</strong> {ALLOWED_EMBED_DOMAINS.join(", ")}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>취소</AlertDialogCancel>
          <AlertDialogAction onClick={handleEmbedInsert}>
            삽입
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
