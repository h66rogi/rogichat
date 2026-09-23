import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
} from "react";
import {
  useEditor,
  EditorContent,
  Editor as TiptapEditor,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { FontFamily } from "@tiptap/extension-font-family";
import { FontSize } from "./extensions/font-size";
import { Iframe } from "./extensions/iframe";
import { Video } from "./extensions/video";
import { postUploadImage } from "@/meloming/shared/apis/upload";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { EditorToolbar } from "./editor-tiptap-toolbar";
import { EditorLinkDialog } from "./editor-tiptap-link-dialog";
import { EditorIframeDialog } from "./editor-tiptap-iframe-dialog";
import styles from "./editor-tiptap.module.css";

type EditorProps = {
  readOnly?: boolean;
  defaultValue?: string;
  onUploadImage?: (file: File) => Promise<{ url: string }>;
  onUploadVideo?: (file: File) => Promise<{ url: string; type?: string }>;
  onTextChange?: (...args: unknown[]) => void;
  onSelectionChange?: (...args: unknown[]) => void;
};

const EditorTiptap = forwardRef<TiptapEditor | null, EditorProps>(
  (
    {
      readOnly,
      defaultValue,
      onUploadImage,
      onUploadVideo,
      onTextChange,
      onSelectionChange,
    },
    ref
  ) => {
    const onTextChangeRef = useRef(onTextChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const [showLinkDialog, setShowLinkDialog] = useState(false);
    const [showIframeDialog, setShowIframeDialog] = useState(false);
    const [isHtmlMode, setIsHtmlMode] = useState(false);
    const [htmlContent, setHtmlContent] = useState("");
    const [, setUpdateCounter] = useState(0); // Force toolbar to re-render

    const uploadImage = useCallback(
      async (file: File) => {
        if (onUploadImage) return onUploadImage(file);
        const { imageUrl } = await postUploadImage({ image: file });
        return { url: imageUrl };
      },
      [onUploadImage]
    );

    const insertUploadedImage = useCallback(
      async (file: File, insert: (src: string) => void) => {
        const { url } = await uploadImage(file);
        insert(url);
      },
      [uploadImage]
    );

    const insertUploadedVideo = useCallback(
      async (
        file: File,
        insert: (src: string, type: string | undefined) => void
      ) => {
        if (!onUploadVideo) return;
        const { url, type } = await onUploadVideo(file);
        insert(url, type);
      },
      [onUploadVideo]
    );

    useEffect(() => {
      onTextChangeRef.current = onTextChange;
      onSelectionChangeRef.current = onSelectionChange;
    }, [onTextChange, onSelectionChange]);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Underline,
        TextAlign.configure({
          types: ["heading", "paragraph", "image", "video"],
          alignments: ["left", "center", "right", "justify"],
        }),
        TextStyle,
        FontSize,
        FontFamily.configure({
          types: ["textStyle"],
        }),
        Color,
        Highlight.configure({
          multicolor: true,
        }),
        Image.configure({
          inline: false,
          allowBase64: false,
        }).extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              textAlign: {
                default: null,
                parseHTML: (element) =>
                  element.style.textAlign || element.getAttribute("align"),
                renderHTML: (attributes) => {
                  if (!attributes.textAlign) {
                    return {};
                  }
                  return {
                    style: `text-align: ${attributes.textAlign}; display: block;`,
                  };
                },
              },
            };
          },
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            rel: "noopener noreferrer nofollow",
          },
        }),
        Iframe.configure({
          allowFullscreen: true,
          HTMLAttributes: {
            class: "iframe-embed",
          },
        }),
        Video.configure({
          HTMLAttributes: {
            class: "editor-video",
          },
        }),
      ],
      content: defaultValue || "",
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: "focus:outline-none",
          spellcheck: "false",
        },
        handlePaste: (view, event) => {
          const items = event.clipboardData?.items;
          if (!items) return false;

          // 이미지/영상 파일이 있는지 확인
          for (let i = 0; i < items.length; i++) {
            const itemType = items[i].type;
            if (itemType.startsWith("image/")) {
              event.preventDefault();
              const file = items[i].getAsFile();
              if (!file) continue;

              // 비동기 업로드
              insertUploadedImage(file, (imageUrl) => {
                const { state } = view;
                const { from } = state.selection;
                const transaction = state.tr.insert(
                  from,
                  state.schema.nodes.image.create({ src: imageUrl })
                );
                view.dispatch(transaction);
              }).catch(() => {
                // Silent fail
              });

              return true; // 기본 paste 동작 막기
            }
            if (itemType.startsWith("video/") && onUploadVideo) {
              event.preventDefault();
              const file = items[i].getAsFile();
              if (!file) continue;

              insertUploadedVideo(file, (videoUrl, type) => {
                const { state } = view;
                const videoNode = state.schema.nodes.video;
                if (!videoNode) return;
                const { from } = state.selection;
                const transaction = state.tr.insert(
                  from,
                  videoNode.create({ src: videoUrl, type })
                );
                view.dispatch(transaction);
              }).catch(() => {
                // Silent fail
              });

              return true;
            }
          }

          return false; // 기본 paste 동작 허용
        },
        handleDrop: (view, event) => {
          const file = event.dataTransfer?.files[0];
          if (
            !file ||
            (!file.type.startsWith("image/") &&
              !(file.type.startsWith("video/") && onUploadVideo))
          ) {
            return false;
          }

          event.preventDefault();
          const coordinates = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (!coordinates) return true;

          if (file.type.startsWith("image/")) {
            insertUploadedImage(file, (imageUrl) => {
              const { state } = view;
              const transaction = state.tr.insert(
                coordinates.pos,
                state.schema.nodes.image.create({ src: imageUrl })
              );
              view.dispatch(transaction);
            })
              .catch(() => {
                // Silent fail
              });
          } else {
            insertUploadedVideo(file, (videoUrl, type) => {
              const { state } = view;
              const videoNode = state.schema.nodes.video;
              if (!videoNode) return;
              const transaction = state.tr.insert(
                coordinates.pos,
                videoNode.create({ src: videoUrl, type })
              );
              view.dispatch(transaction);
            }).catch(() => {
              // Silent fail
            });
          }

          return true; // 기본 drop 동작 막기
        },
      },
      onUpdate: ({ editor }) => {
        const html = editor.getHTML();
        const text = editor.getText();
        onTextChangeRef.current?.(null, null, "user", html, text);
        setUpdateCounter((c) => c + 1); // Trigger re-render
      },
      onSelectionUpdate: ({ editor }) => {
        const selection = editor.state.selection;
        onSelectionChangeRef.current?.(selection, null, "user");
        setUpdateCounter((c) => c + 1); // Trigger re-render
      },
    });

    useImperativeHandle(ref, () => editor as TiptapEditor, [editor]);

    useEffect(() => {
      if (editor && typeof readOnly === "boolean") {
        editor.setEditable(!readOnly);
      }
    }, [editor, readOnly]);

    const toggleHtmlMode = useCallback(() => {
      if (!editor) return;

      if (isHtmlMode) {
        // HTML 모드 -> 에디터 모드
        editor.commands.setContent(htmlContent);
        setIsHtmlMode(false);
      } else {
        // 에디터 모드 -> HTML 모드
        setHtmlContent(editor.getHTML());
        setIsHtmlMode(true);
      }
    }, [editor, isHtmlMode, htmlContent]);

    const handleHtmlChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setHtmlContent(e.target.value);
      },
      []
    );

    const handleOpenLinkDialog = useCallback(() => {
      setShowLinkDialog(true);
    }, []);

    const handleOpenIframeDialog = useCallback(() => {
      setShowIframeDialog(true);
    }, []);

    if (!editor) {
      return null;
    }

    return (
      <>
        <div className={styles.editorWrapper}>
          <EditorToolbar
            editor={editor}
            isHtmlMode={isHtmlMode}
            onToggleHtmlMode={toggleHtmlMode}
            onOpenLinkDialog={handleOpenLinkDialog}
            onOpenIframeDialog={handleOpenIframeDialog}
            onUploadImage={uploadImage}
            onUploadVideo={onUploadVideo}
          />

          {isHtmlMode ? (
            <Textarea
              value={htmlContent}
              onChange={handleHtmlChange}
              className="min-h-[280px] font-mono text-sm resize-y"
              placeholder="HTML 코드를 입력하세요..."
            />
          ) : (
            <EditorContent editor={editor} className={styles.editorContent} />
          )}
        </div>

        <EditorLinkDialog
          editor={editor}
          open={showLinkDialog}
          onOpenChange={setShowLinkDialog}
        />

        <EditorIframeDialog
          editor={editor}
          open={showIframeDialog}
          onOpenChange={setShowIframeDialog}
        />
      </>
    );
  }
);

EditorTiptap.displayName = "EditorTiptap";

export default EditorTiptap;
