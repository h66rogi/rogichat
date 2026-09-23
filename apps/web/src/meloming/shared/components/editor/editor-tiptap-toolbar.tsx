import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Palette,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  ImageIcon,
  Film,
  Link as LinkIcon,
  Quote,
  Code2,
  ChevronsUpDown,
  Check,
  Monitor,
  // Table as TableIcon,
  // TableProperties,
  // Plus,
  // Minus,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/meloming/shared/components/ui/command";
import { cn } from "@/meloming/shared/lib/utils";
import styles from "./editor-tiptap.module.css";

type EditorToolbarProps = {
  editor: Editor;
  isHtmlMode: boolean;
  onToggleHtmlMode: () => void;
  onOpenLinkDialog: () => void;
  onOpenIframeDialog: () => void;
  onUploadImage: (file: File) => Promise<{ url: string }>;
  onUploadVideo?: (file: File) => Promise<{ url: string; type?: string }>;
};

const FONT_SIZES = [
  { label: "8pt", value: "8pt" },
  { label: "10pt", value: "10pt" },
  { label: "12pt", value: "12pt" },
  { label: "13pt", value: "13pt" },
  { label: "14pt", value: "14pt" },
  { label: "16pt", value: "16pt" },
  { label: "18pt", value: "18pt" },
  { label: "20pt", value: "20pt" },
  { label: "24pt", value: "24pt" },
  { label: "32pt", value: "32pt" },
  { label: "48pt", value: "48pt" },
];

const FONT_FAMILIES = [
  { label: "Pretendard", value: "Pretendard", displayName: "프리텐다드" },
  { label: "Paperlogy", value: "Paperlogy", displayName: "페이퍼로지" },
  {
    label: "OngleipKonkon",
    value: "OngleipKonkon",
    displayName: "온글잎 콘콘체",
  },
  { label: "CookieRun", value: "CookieRun", displayName: "쿠키런" },
  { label: "NanumSquare", value: "NanumSquare", displayName: "나눔스퀘어" },
];

export function EditorToolbar({
  editor,
  isHtmlMode,
  onToggleHtmlMode,
  onOpenLinkDialog,
  onOpenIframeDialog,
  onUploadImage,
  onUploadVideo,
}: EditorToolbarProps) {
  const [colorPickerValue, setColorPickerValue] = useState("#000000");
  const [highlightPickerValue, setHighlightPickerValue] = useState("#ffff00");
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false);
  // const [tableMenuOpen, setTableMenuOpen] = useState(false);

  const handleImageUpload = useCallback(() => {
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*");
    input.onchange = async () => {
      const file = (input.files && input.files[0]) || null;
      if (!file) return;
      try {
        const { url } = await onUploadImage(file);
        editor.chain().focus().setImage({ src: url }).run();
      } catch {
        // Silent fail
      }
    };
    input.click();
  }, [editor, onUploadImage]);

  const handleVideoUpload = useCallback(() => {
    if (!onUploadVideo) return;
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "video/mp4,video/webm,video/quicktime");
    input.onchange = async () => {
      const file = (input.files && input.files[0]) || null;
      if (!file) return;
      try {
        const { url, type } = await onUploadVideo(file);
        editor.chain().focus().setVideo({ src: url, type }).run();
      } catch {
        // Silent fail
      }
    };
    input.click();
  }, [editor, onUploadVideo]);

  const getCurrentFontSize = useCallback(() => {
    const fontSize = editor.getAttributes("textStyle").fontSize;
    return fontSize || "16pt";
  }, [editor]);

  const handleFontSizeChange = useCallback(
    (size: string) => {
      if (size) {
        editor.chain().focus().setFontSize(size).run();
      } else {
        editor.chain().focus().unsetFontSize().run();
      }
    },
    [editor]
  );

  const getCurrentFontFamily = useCallback(() => {
    const fontFamily = editor.getAttributes("textStyle").fontFamily;
    const currentFont = FONT_FAMILIES.find((f) => f.value === fontFamily);
    return currentFont?.displayName || "프리텐다드";
  }, [editor]);

  const handleFontFamilyChange = useCallback(
    (family: string) => {
      if (family) {
        editor.chain().focus().setFontFamily(family).run();
      } else {
        editor.chain().focus().unsetFontFamily().run();
      }
    },
    [editor]
  );

  return (
    <div className={styles.toolbar}>
      {/* Font Size Combobox */}
      <Popover open={fontSizeOpen} onOpenChange={setFontSizeOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              styles.toolbarButton,
              "justify-between w-[85px] text-left font-normal"
            )}
            title="폰트 크기"
          >
            <span className="truncate">{getCurrentFontSize()}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[150px] p-0" align="start">
          <Command>
            <CommandList>
              <CommandGroup>
                {FONT_SIZES.map((size) => (
                  <CommandItem
                    key={size.value}
                    value={size.value}
                    onSelect={() => {
                      handleFontSizeChange(size.value);
                      setFontSizeOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        getCurrentFontSize() === size.value
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    {size.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Font Family Combobox */}
      <Popover open={fontFamilyOpen} onOpenChange={setFontFamilyOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              styles.toolbarButton,
              "justify-between w-[110px] text-left font-normal"
            )}
            title="폰트 패밀리"
          >
            <span className="truncate">{getCurrentFontFamily()}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[180px] p-0" align="start">
          <Command>
            <CommandList>
              <CommandGroup>
                {FONT_FAMILIES.map((family) => (
                  <CommandItem
                    key={family.value}
                    value={family.value}
                    onSelect={() => {
                      handleFontFamilyChange(family.value);
                      setFontFamilyOpen(false);
                    }}
                    style={{ fontFamily: family.value }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        getCurrentFontFamily() === family.displayName
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    {family.displayName}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className={styles.toolbarDivider} />

      {/* Text Formatting Group */}
      <div className={styles.toolbarButtonGroup}>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${styles.toolbarButton} ${
            editor.isActive("bold") ? styles.isActive : ""
          }`}
          title="Bold"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${styles.toolbarButton} ${
            editor.isActive("italic") ? styles.isActive : ""
          }`}
          title="Italic"
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`${styles.toolbarButton} ${
            editor.isActive("underline") ? styles.isActive : ""
          }`}
          title="Underline"
        >
          <UnderlineIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`${styles.toolbarButton} ${
            editor.isActive("strike") ? styles.isActive : ""
          }`}
          title="Strike"
        >
          <Strikethrough size={16} />
        </button>
      </div>

      <div className={styles.toolbarDivider} />

      {/* Color Pickers */}
      <div className={styles.toolbarColorGroup}>
        <label className={styles.colorPickerLabel} title="텍스트 색상">
          <Palette size={16} />
          <div
            className={styles.colorIndicator}
            style={{ backgroundColor: colorPickerValue }}
          />
          <input
            type="color"
            value={colorPickerValue}
            onChange={(e) => {
              setColorPickerValue(e.target.value);
              editor.chain().focus().setColor(e.target.value).run();
            }}
            className={styles.colorPickerInput}
          />
        </label>
        <label className={styles.colorPickerLabel} title="배경 색상">
          <Highlighter size={16} />
          <div
            className={styles.colorIndicator}
            style={{ backgroundColor: highlightPickerValue }}
          />
          <input
            type="color"
            value={highlightPickerValue}
            onChange={(e) => {
              setHighlightPickerValue(e.target.value);
              editor
                .chain()
                .focus()
                .setHighlight({ color: e.target.value })
                .run();
            }}
            className={styles.colorPickerInput}
          />
        </label>
      </div>

      <div className={styles.toolbarDivider} />

      {/* Text Alignment Group */}
      <div className={styles.toolbarButtonGroup}>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          className={`${styles.toolbarButton} ${
            editor.isActive({ textAlign: "left" }) ? styles.isActive : ""
          }`}
          title="왼쪽 정렬"
        >
          <AlignLeft size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          className={`${styles.toolbarButton} ${
            editor.isActive({ textAlign: "center" }) ? styles.isActive : ""
          }`}
          title="가운데 정렬"
        >
          <AlignCenter size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          className={`${styles.toolbarButton} ${
            editor.isActive({ textAlign: "right" }) ? styles.isActive : ""
          }`}
          title="오른쪽 정렬"
        >
          <AlignRight size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          className={`${styles.toolbarButton} ${
            editor.isActive({ textAlign: "justify" }) ? styles.isActive : ""
          }`}
          title="양쪽 정렬"
        >
          <AlignJustify size={16} />
        </button>
      </div>

      <div className={styles.toolbarDivider} />

      {/* Lists Group */}
      <div className={styles.toolbarButtonGroup}>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`${styles.toolbarButton} ${
            editor.isActive("bulletList") ? styles.isActive : ""
          }`}
          title="순서 없는 목록"
        >
          <List size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`${styles.toolbarButton} ${
            editor.isActive("orderedList") ? styles.isActive : ""
          }`}
          title="순서 있는 목록"
        >
          <ListOrdered size={16} />
        </button>
      </div>

      <div className={styles.toolbarDivider} />

      {/* Image, Link, Blockquote */}
      <button
        type="button"
        onClick={handleImageUpload}
        title="이미지 업로드"
        className={styles.toolbarButton}
      >
        <ImageIcon size={16} />
      </button>
      {onUploadVideo ? (
        <button
          type="button"
          onClick={handleVideoUpload}
          title="영상 업로드"
          className={styles.toolbarButton}
        >
          <Film size={16} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onOpenLinkDialog}
        className={`${styles.toolbarButton} ${
          editor.isActive("link") ? styles.isActive : ""
        }`}
        title="링크"
      >
        <LinkIcon size={16} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`${styles.toolbarButton} ${
          editor.isActive("blockquote") ? styles.isActive : ""
        }`}
        title="인용"
      >
        <Quote size={16} />
      </button>
      <button
        type="button"
        onClick={onOpenIframeDialog}
        className={`${styles.toolbarButton} ${
          editor.isActive("iframe") ? styles.isActive : ""
        }`}
        title="임베드"
      >
        <Monitor size={16} />
      </button>

      <div className={styles.toolbarDivider} />

      {/* Table Menu */}
      {/* <Popover open={tableMenuOpen} onOpenChange={setTableMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`${styles.toolbarButton} ${
              editor.isActive("table") ? styles.isActive : ""
            }`}
            title="테이블"
          >
            <TableIcon size={16} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-2" align="start">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run();
                setTableMenuOpen(false);
              }}
              className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded"
            >
              <TableIcon size={14} />
              테이블 삽입 (3x3)
            </button>
            {editor.isActive("table") && (
              <>
                <div className="h-px bg-border my-1" />
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().addRowBefore().run();
                    setTableMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded"
                >
                  <Plus size={14} />
                  위에 행 추가
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().addRowAfter().run();
                    setTableMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded"
                >
                  <Plus size={14} />
                  아래에 행 추가
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().deleteRow().run();
                    setTableMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded"
                >
                  <Minus size={14} />행 삭제
                </button>
                <div className="h-px bg-border my-1" />
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().addColumnBefore().run();
                    setTableMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded"
                >
                  <Plus size={14} />
                  왼쪽에 열 추가
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().addColumnAfter().run();
                    setTableMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded"
                >
                  <Plus size={14} />
                  오른쪽에 열 추가
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().deleteColumn().run();
                    setTableMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded"
                >
                  <Minus size={14} />열 삭제
                </button>
                <div className="h-px bg-border my-1" />
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().deleteTable().run();
                    setTableMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm text-destructive hover:bg-accent rounded"
                >
                  <Minus size={14} />
                  테이블 삭제
                </button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover> */}

      {/* <div className={styles.toolbarDivider} /> */}

      {/* HTML Mode Toggle */}
      <button
        type="button"
        onClick={onToggleHtmlMode}
        className={`${styles.toolbarButton} ${
          isHtmlMode ? styles.isActive : ""
        }`}
        title="HTML 모드"
      >
        <Code2 size={16} />
        <span className="ml-1 text-xs">HTML</span>
      </button>
    </div>
  );
}
