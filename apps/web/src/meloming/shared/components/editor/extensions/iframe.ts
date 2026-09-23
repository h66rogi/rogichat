import { Node, mergeAttributes } from "@tiptap/core";
import { isAllowedEmbedDomain } from "@/meloming/shared/constants/embed";

export type IframeOptions = {
  allowFullscreen: boolean;
  HTMLAttributes: Record<string, unknown>;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    iframe: {
      /**
       * Set an iframe
       */
      setIframe: (options: { src: string }) => ReturnType;
    };
  }
}

export const Iframe = Node.create<IframeOptions>({
  name: "iframe",

  group: "block",

  atom: true,

  addOptions() {
    return {
      allowFullscreen: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      frameborder: {
        default: 0,
      },
      allowfullscreen: {
        default: this.options.allowFullscreen,
        parseHTML: () => this.options.allowFullscreen,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "iframe",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // 보안: src URL 검증
    if (!HTMLAttributes.src || !isAllowedEmbedDomain(HTMLAttributes.src as string)) {
      return ["div", { class: "iframe-error" }, "Invalid iframe source"];
    }

    return [
      "div",
      { class: "iframe-wrapper" },
      [
        "iframe",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
          referrerpolicy: "strict-origin-when-cross-origin",
        }),
      ],
    ];
  },

  addCommands() {
    return {
      setIframe:
        (options) =>
        ({ commands }) => {
          if (!isAllowedEmbedDomain(options.src)) {
            console.error("Invalid iframe URL:", options.src);
            return false;
          }
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});
