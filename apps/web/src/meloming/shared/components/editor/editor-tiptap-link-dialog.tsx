import { useCallback, useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
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

type EditorLinkDialogProps = {
  editor: Editor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditorLinkDialog({
  editor,
  open,
  onOpenChange,
}: EditorLinkDialogProps) {
  const [linkUrl, setLinkUrl] = useState("");

  useEffect(() => {
    if (open && editor) {
      const previousUrl = editor.getAttributes("link").href || "";
      setLinkUrl(previousUrl);
    }
  }, [open, editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;

    if (linkUrl === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl })
        .run();
    }

    onOpenChange(false);
    setLinkUrl("");
  }, [editor, linkUrl, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
    setLinkUrl("");
  }, [onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>링크 추가</AlertDialogTitle>
          <AlertDialogDescription>
            링크 URL을 입력하세요. 빈 값으로 두면 링크가 제거됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-4">
          <Label htmlFor="link-url">URL</Label>
          <Input
            id="link-url"
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            className="mt-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>취소</AlertDialogCancel>
          <AlertDialogAction onClick={applyLink}>적용</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
