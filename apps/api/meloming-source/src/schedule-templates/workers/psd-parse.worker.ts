import {
  readPsd,
  initializeCanvas,
  Color,
  Layer,
  LayerTextData,
  Psd,
} from 'ag-psd';
import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';
import sharp from 'sharp';
import {
  TemplateSpecV1,
  TextSlot,
  TextSlotFont,
} from '../types/template-spec.type';

/**
 * Wire ag-psd's canvas factory to @napi-rs/canvas at module load.
 *
 * Why this is required even with `useImageData: true`:
 *   ag-psd's composite/layer/mask decoder paths still call
 *   `helpers.createImageData(width, height)` (psdReader.js:720-740 and the
 *   `imageDataToCanvas` paths). The default `createImageData` lazily creates
 *   a 1x1 temp canvas via `createCanvas(1,1)` and calls
 *   `getContext('2d').createImageData(...)`. With no `createCanvas`
 *   registered, the very first call throws:
 *     "Canvas not initialized, use initializeCanvas method to set up createCanvas method"
 *   See ag-psd/src/helpers.ts:372 for the throwing default.
 *
 * Why @napi-rs/canvas (and not node-canvas):
 *   @napi-rs/canvas is already a transitive dep used by `schedule-renders`'s
 *   `CanvasRendererService`, ships pure-JS prebuilt binaries (no Cairo system
 *   deps that would break our slim Docker image), and exposes the same
 *   `(width, height) => Canvas` factory shape that ag-psd's official
 *   `ag-psd/initialize-canvas` shim uses with the legacy `canvas` (node-canvas)
 *   package. The npm `@napi-rs/canvas/node-canvas` subpath is the documented
 *   drop-in adapter; we use the bare `@napi-rs/canvas` import because we
 *   only need the value-equivalent `createCanvas` factory and `ImageData`
 *   constructor — the node-canvas-shaped wrapper adds nothing here.
 *
 * Why we cast via `as unknown as ...`:
 *   ag-psd's signature is typed against the browser DOM (`HTMLCanvasElement`,
 *   `ImageData`), but this project's tsconfig lib is `ES2021` only — those
 *   browser globals are not visible to TypeScript in the worker module. At
 *   runtime ag-psd only uses three things on the returned canvas — `width`,
 *   `height`, and `getContext('2d')` — and on the returned `ImageData`
 *   only `data` / `width` / `height`. @napi-rs/canvas's `Canvas` and
 *   `ImageData` provide those structurally. The ag-psd README itself
 *   documents casting via `as any` (node_modules/ag-psd/README.md L75-77),
 *   so this is the intended pattern. We use `Parameters<typeof X>` to
 *   derive the exact return-type expected by ag-psd without re-stating
 *   the unavailable DOM type names.
 *   We pass our own `createImageData` to avoid the wasteful 1x1 temp-canvas
 *   roundtrip in ag-psd's default impl — @napi-rs/canvas's `ImageData`
 *   constructor mints the buffer directly.
 */
type AgPsdCreateCanvas = Parameters<typeof initializeCanvas>[0];
type AgPsdCreateImageData = NonNullable<Parameters<typeof initializeCanvas>[1]>;
type AgPsdCanvas = ReturnType<AgPsdCreateCanvas>;
type AgPsdImageData = ReturnType<AgPsdCreateImageData>;

const napiCreateCanvas: AgPsdCreateCanvas = (width: number, height: number) => {
  // @napi-rs/canvas Canvas is structurally compatible with what ag-psd
  // uses (width/height/getContext('2d')) but lacks the nominal
  // HTMLCanvasElement type — see block comment above. The ReturnType<...>
  // resolves to a DOM type name that the project's tsconfig (lib: ES2021)
  // doesn't expose, so eslint flags the cast-through-unknown as
  // "unsafe-return"; the safety argument lives in the block comment above.
  const canvas: unknown = createCanvas(width, height);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return canvas as AgPsdCanvas;
};

const napiCreateImageData: AgPsdCreateImageData = (
  width: number,
  height: number,
) => {
  // @napi-rs/canvas ImageData is structurally identical to the DOM
  // ImageData (Uint8ClampedArray data + width + height) — see block
  // comment above. Same eslint caveat as napiCreateCanvas.
  const imageData: unknown = new NapiImageData(
    new Uint8ClampedArray(width * height * 4),
    width,
    height,
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return imageData as AgPsdImageData;
};

initializeCanvas(napiCreateCanvas, napiCreateImageData);

/**
 * PSD parse worker. This module is loaded by piscina inside a worker thread.
 * The default export is the worker entry point. All helpers are also named-exported
 * so that unit tests can drive them directly without spinning up a worker pool.
 *
 * No NestJS imports or DI here — this is a pure module.
 */

// Bundled UI fonts. Compared case- and separator-insensitively. See `normalizeFontName`.
export const BUNDLED_FONTS: ReadonlySet<string> = new Set([
  'pretendard',
  'paperlogy',
]);

export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_COLOR_HEX = '#ffffff';
export const LINE_HEIGHT_MULTIPLIER = 1.3;

// PSD spec hard caps. Photoshop allows up to 30000x30000 (PSD) or 300000x300000
// (PSB), but anything beyond 20000 per side is almost certainly malicious or a
// mistaken upload — and would crush our memory budget regardless.
//
// The pixel-count cap is the real memory guard: a 10000×10000 canvas already
// decodes to ~400 MB of raw RGBA, and ag-psd + sharp each need a working copy,
// so even a "modest" 20000×20000 (400Mpx) PSD blew past our 2 GiB pod budget
// in the B8 review. We drop the pixel cap to 1억 (100Mpx) which keeps peak
// memory ~1.5 GiB for a single upload (reference: 10000×10000 × 4 bytes =
// 400MB raw × 2 copies ≈ 800MB + ~300MB PSD file + overhead).
export const MAX_DIMENSION = 20000;
export const MAX_PIXEL_COUNT = 100_000_000;

// Cap on warnings to avoid response bloat / log flooding when a PSD has many
// unknown fonts or other repeating quirks.
export const MAX_WARNINGS = 50;
const WARNINGS_TRUNCATED_MESSAGE = '...and more warnings truncated';

// Cap on layer recursion to avoid stack overflows / pathological PSDs.
export const MAX_LAYER_DEPTH = 32;

export type PsdHeaderErrorCode =
  | 'PSD_INVALID'
  | 'PSD_OVERSIZED'
  | 'PSD_UNSUPPORTED_DEPTH';

export type PsdParseErrorCode = PsdHeaderErrorCode;

/**
 * Marker prefix for typed errors flowing across the worker_threads boundary.
 * Worker_threads' structured clone strips custom Error properties (name, code,
 * etc.), so we encode the code into the message text and decode it in the
 * service layer. The format is `[CODE] human readable message`.
 */
const ERROR_PREFIX_RE =
  /^\[(PSD_INVALID|PSD_OVERSIZED|PSD_UNSUPPORTED_DEPTH)\]\s/;

export class PsdParseError extends Error {
  readonly code: PsdParseErrorCode;
  constructor(code: PsdParseErrorCode, message: string) {
    // Prefix the message so the controller can recover the code after the
    // structured clone roundtrip. The PsdParseError class itself remains
    // useful for in-process tests of the worker module.
    super(`[${code}] ${message}`);
    this.name = 'PsdParseError';
    this.code = code;
  }
}

/**
 * Parses a possibly-prefixed worker error message into (code, plainMessage).
 * If no code prefix is present, returns null.
 */
export function parseErrorPrefix(
  message: string,
): { code: PsdParseErrorCode; message: string } | null {
  const match = message.match(ERROR_PREFIX_RE);
  if (!match) return null;
  const code = match[1] as PsdParseErrorCode;
  return { code, message: message.slice(match[0].length) };
}

export interface PsdParseWorkerInput {
  /**
   * The PSD bytes as an ArrayBuffer (fully transferable across worker threads).
   * The worker wraps this with `Buffer.from(buffer)` internally.
   */
  buffer: ArrayBuffer;
}

export interface PsdParseWorkerResult {
  baseImageW: number;
  baseImageH: number;
  flattenPngBuffer: Buffer;
  templateSpec: TemplateSpecV1;
  warnings: string[];
}

/**
 * Strip weight/style suffix and lowercase. Used so `Pretendard-Regular`,
 * `PRETENDARD`, `Pretendard_Bold` all match the bundled `pretendard`.
 */
export function normalizeFontName(raw: string): string {
  return raw.split(/[-_\s]/)[0].toLowerCase();
}

/**
 * Push a warning into the array, capped at MAX_WARNINGS. When the cap is hit,
 * a single trailing `...and more warnings truncated` message is appended.
 * Subsequent calls are silently dropped.
 */
export function pushWarning(warnings: string[], message: string): void {
  if (warnings.length < MAX_WARNINGS) {
    warnings.push(message);
    if (warnings.length === MAX_WARNINGS) {
      warnings.push(WARNINGS_TRUNCATED_MESSAGE);
    }
  }
  // Once we've hit MAX_WARNINGS + 1 (the truncated marker), drop silently.
}

/**
 * Validate the 26-byte PSD header before handing off to ag-psd. ag-psd will
 * eagerly allocate large buffers based on declared image dimensions, so we
 * reject obviously oversized or malformed PSDs first to avoid OOM on the
 * worker thread.
 *
 * Layout (big-endian, all PSD spec):
 *   0-3   magic '8BPS'
 *   4-5   version (1 = PSD, 2 = PSB)
 *   6-11  reserved (6 bytes)
 *   12-13 number of channels (1..56)
 *   14-17 height
 *   18-21 width
 *   22-23 depth (8/16/32)
 *   24-25 color mode (informational)
 */
export function validatePsdHeader(buffer: Buffer): {
  width: number;
  height: number;
} {
  if (buffer.length < 26) {
    throw new PsdParseError(
      'PSD_INVALID',
      'PSD file is too small to contain a header',
    );
  }

  // Magic '8BPS'
  if (
    buffer[0] !== 0x38 ||
    buffer[1] !== 0x42 ||
    buffer[2] !== 0x50 ||
    buffer[3] !== 0x53
  ) {
    throw new PsdParseError(
      'PSD_INVALID',
      'PSD magic number not found (file does not start with 8BPS)',
    );
  }

  const version = buffer.readUInt16BE(4);
  if (version !== 1 && version !== 2) {
    throw new PsdParseError(
      'PSD_INVALID',
      `Unsupported PSD version ${version} (expected 1 = PSD or 2 = PSB)`,
    );
  }

  const channels = buffer.readUInt16BE(12);
  if (channels < 1 || channels > 56) {
    throw new PsdParseError(
      'PSD_INVALID',
      `PSD channel count out of range: ${channels} (expected 1..56)`,
    );
  }

  const height = buffer.readUInt32BE(14);
  const width = buffer.readUInt32BE(18);

  if (height === 0 || width === 0) {
    throw new PsdParseError(
      'PSD_INVALID',
      `PSD has zero dimension (${width}x${height})`,
    );
  }

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new PsdParseError(
      'PSD_OVERSIZED',
      `PSD dimension exceeds ${MAX_DIMENSION}px (got ${width}x${height})`,
    );
  }

  // width * height fits safely in JS number (max ~9e15) since both ≤ 20000.
  const pixelCount = width * height;
  if (pixelCount > MAX_PIXEL_COUNT) {
    throw new PsdParseError(
      'PSD_OVERSIZED',
      `PSD pixel count ${pixelCount} exceeds ${MAX_PIXEL_COUNT}`,
    );
  }

  const depth = buffer.readUInt16BE(22);
  if (depth !== 8) {
    throw new PsdParseError(
      'PSD_UNSUPPORTED_DEPTH',
      `PSD bit depth ${depth} is not supported. Please re-export as 8-bit/channel.`,
    );
  }

  return { width, height };
}

/**
 * Axis-aligned bounding box of a visible text layer in PSD pixel space.
 * Used to erase text-layer pixel regions from the composite flatten so the
 * editor can re-render the same text via slot bindings without visual
 * duplication ("ghost text" overlap).
 */
export interface TextLayerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Walk the layer tree and collect bounding boxes of every visible text
 * layer (the same definition used by `collectTextSlots`: non-group leaves
 * with `text` set, after `hidden` filtering). Returns the boxes in design
 * pixel space (PSD canvas coordinates).
 *
 * Why it exists separately from `collectTextSlots`:
 *   `buildFlattenPng` needs to erase text pixel regions from the composite
 *   PNG BEFORE we know whether the slot is going to be emitted with a
 *   binding or with a literal. We always erase — the editor will redraw
 *   the same pixels via the slot binding. If we kept the composite intact,
 *   the user would see the original text baked into the background AND
 *   the editor's slot text on top, producing visible double-text.
 *
 *   Walking the tree once for slots and once for bounds is cheap (the
 *   layer tree is small in practice) and keeps each pass single-purpose.
 */
export function collectTextLayerBounds(
  layer: Layer,
  results: TextLayerBounds[] = [],
  depth = 0,
  depthLimitReached: { value: boolean } = { value: false },
): TextLayerBounds[] {
  if (layer.hidden) return results;

  if (depth > MAX_LAYER_DEPTH) {
    // Same depth contract as collectTextSlots — we silently stop here; the
    // depth-limit warning is emitted from collectTextSlots' single source.
    depthLimitReached.value = true;
    return results;
  }

  const hasChildren =
    Array.isArray(layer.children) && layer.children.length > 0;

  if (hasChildren) {
    for (const child of layer.children) {
      collectTextLayerBounds(child, results, depth + 1, depthLimitReached);
    }
    return results;
  }

  if (layer.text) {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const right = layer.right ?? left + 1;
    const bottom = layer.bottom ?? top + 1;
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    results.push({ left, top, width, height });
  }

  return results;
}

/**
 * Clamp a text layer's bounding box to the composite image's bounds so
 * sharp's `composite` does not throw "Image to composite must have same
 * dimensions or smaller". PSDs occasionally have text bounds that extend
 * a few pixels outside the canvas (Photoshop allows it for off-canvas text).
 *
 * Returns null if the box is fully outside the image (skip the erase).
 */
export function clampBoundsToImage(
  bounds: TextLayerBounds,
  imageWidth: number,
  imageHeight: number,
): TextLayerBounds | null {
  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);
  const right = Math.min(imageWidth, bounds.left + bounds.width);
  const bottom = Math.min(imageHeight, bounds.top + bounds.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

/**
 * Build a flattened PNG from the composite imageData embedded in the PSD.
 *
 * Text-layer erase ("ghost text" fix):
 *   The PSD's composite layer pre-bakes every visible layer's pixels —
 *   including the text pixels we are about to recreate via slot bindings
 *   in the editor. If we hand the composite to the editor unchanged, the
 *   user sees the ORIGINAL text as part of the background AND the slot
 *   text drawn on top → visible double-text overlap (user's #2 complaint).
 *
 *   The fix: punch transparent holes (`blend: 'dest-out'`) at every text
 *   layer's bounding box. Sharp's `dest-out` composite zeros the alpha
 *   channel of the destination wherever the source has alpha > 0 — so a
 *   fully-opaque rectangular overlay leaves the destination transparent
 *   in that exact rectangle.
 *
 *   We use rectangular bounds rather than per-pixel text masks because:
 *     - the text layer's bounding box (left/top/right/bottom in PSD record)
 *       always covers the text glyphs (Photoshop guarantees this)
 *     - the editor will redraw text into the same slot rectangle, so any
 *       slight over-erase is hidden under the new text
 *     - extracting per-pixel alpha would require decoding the layer's
 *       raster (which we explicitly skip for memory budget — see ag-psd
 *       options in `runPsdParse`)
 *
 * If imageData is missing, falls back to a 1x1 transparent PNG and pushes
 * a warning.
 */
export async function buildFlattenPng(
  psd: Psd,
  textBounds: TextLayerBounds[],
  warnings: string[],
): Promise<Buffer> {
  if (psd.imageData) {
    const { data, width, height } = psd.imageData;
    const raw = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    let pipeline = sharp(raw, {
      raw: { width, height, channels: 4 },
    });

    if (textBounds.length > 0) {
      // Build one fully-opaque rectangle per text-layer bound and erase it
      // from the composite via dest-out blend (alpha→0 in the destination
      // wherever the overlay has alpha).
      //
      // We allocate the rectangles in parallel up-front; sharp accepts an
      // array of composite operations and applies them in order.
      const overlays = await Promise.all(
        textBounds
          .map((b) => clampBoundsToImage(b, width, height))
          .filter((b): b is TextLayerBounds => b !== null)
          .map(async (b) => {
            const overlay = await sharp({
              create: {
                width: b.width,
                height: b.height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 },
              },
            })
              .png()
              .toBuffer();
            return {
              input: overlay,
              left: b.left,
              top: b.top,
              blend: 'dest-out' as const,
            };
          }),
      );

      if (overlays.length > 0) {
        pipeline = pipeline.composite(overlays);
      }
    }

    return pipeline.png().toBuffer();
  }

  pushWarning(
    warnings,
    'PSD composite imageData was missing; using 1x1 transparent flatten fallback',
  );
  const transparent = Buffer.from([0, 0, 0, 0]);
  return sharp(transparent, {
    raw: { width: 1, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Walk the layer tree and extract one TextSlot per text layer.
 *
 * Rules:
 *   - hidden layers are skipped entirely (and so are their children)
 *   - group layers (layers with non-empty children) recurse into the group;
 *     if a group itself also carries `text`, the group's text is ignored — we
 *     never emit a slot for a layer that has both children and text, because
 *     in practice that's a malformed PSD edge case and the children are what
 *     the user sees
 *   - depth is capped at MAX_LAYER_DEPTH (32). Deeper subtrees are skipped
 *     with a single warning.
 */
export function collectTextSlots(
  layer: Layer,
  slots: TextSlot[],
  warnings: string[],
  unknownFonts: Set<string> = new Set(),
  depth = 0,
  depthLimitWarned: { value: boolean } = { value: false },
): void {
  if (layer.hidden) return;

  if (depth > MAX_LAYER_DEPTH) {
    if (!depthLimitWarned.value) {
      pushWarning(
        warnings,
        `PSD layer nesting exceeds depth limit (${MAX_LAYER_DEPTH}); truncated`,
      );
      depthLimitWarned.value = true;
    }
    return;
  }

  const hasChildren =
    Array.isArray(layer.children) && layer.children.length > 0;

  // A layer with children is a group. Recurse into the group; do not also
  // emit the group's own .text (rare/malformed edge case).
  if (hasChildren) {
    for (const child of layer.children) {
      collectTextSlots(
        child,
        slots,
        warnings,
        unknownFonts,
        depth + 1,
        depthLimitWarned,
      );
    }
    return;
  }

  if (layer.text) {
    const slot = textLayerToSlot(layer, layer.text, slots.length, unknownFonts);
    if (slot) slots.push(slot);
  }
}

export function textLayerToSlot(
  layer: Layer,
  text: LayerTextData,
  globalIndex: number,
  unknownFonts: Set<string>,
): TextSlot | null {
  const x = layer.left ?? 0;
  const y = layer.top ?? 0;
  const rawW = (layer.right ?? x + 1) - x;
  const rawH = (layer.bottom ?? y + 1) - y;
  const w = Math.max(1, rawW);
  const h = Math.max(1, rawH);

  const fontSize = text.style?.fontSize ?? DEFAULT_FONT_SIZE;
  const color = colorToHex(text.style?.fillColor);
  const align = mapAlignment(text.paragraphStyle?.justification);
  const fontName = text.style?.font?.name;

  // Collect unknown fonts into a set so we can emit ONE aggregated warning
  // at the end rather than one warning per text layer (the user reported
  // "24 errors" because the BLUE template has 24 text layers using two
  // unique non-bundled fonts — the noise was per-occurrence, not per-font).
  // The aggregated warning is built in `runPsdParse` after the walk.
  if (fontName) {
    const normalized = normalizeFontName(fontName);
    if (!BUNDLED_FONTS.has(normalized)) {
      unknownFonts.add(fontName);
    }
  }

  const maxLines = Math.max(
    1,
    Math.floor(h / Math.max(1, fontSize * LINE_HEIGHT_MULTIPLIER)),
  );

  const font: TextSlotFont = {
    family: 'Pretendard',
    weight: 400,
    size: fontSize,
    color,
    align,
    lineHeight: LINE_HEIGHT_MULTIPLIER,
    maxLines,
  };

  return {
    id: `psd-text-${globalIndex}`,
    type: 'text',
    x,
    y,
    w,
    h,
    literal: text.text,
    font,
  };
}

/**
 * Build the aggregated "unknown fonts" warning. Returns null if every font
 * encountered was a bundled font (no warning needed).
 *
 * Format (Korean, user-facing):
 *   "다음 폰트 N종이 번들에 없어 Pretendard 로 대체됩니다: A, B, C"
 *
 * Why aggregated:
 *   The previous implementation pushed one warning per text layer that used
 *   a non-bundled font. A 24-text-layer template using two non-bundled fonts
 *   produced 24 warnings (the user's reported "24개 오류"). One warning per
 *   unique font is the right granularity.
 *
 * Capping: if the unique-font count exceeds a sanity cap (50) we list the
 * first 50 and append `... 외 N종` so the message stays readable. The cap
 * is generous because a real template rarely uses > 5 distinct fonts.
 */
export const FONT_DEDUPE_NAME_LIMIT = 50;

export function buildAggregatedFontWarning(
  unknownFonts: ReadonlySet<string>,
): string | null {
  if (unknownFonts.size === 0) return null;
  // Sort for deterministic output (helps tests + makes log diffs stable).
  const names = [...unknownFonts].sort();
  if (names.length <= FONT_DEDUPE_NAME_LIMIT) {
    return `다음 폰트 ${names.length}종이 번들에 없어 Pretendard 로 대체됩니다: ${names.join(', ')}`;
  }
  const shown = names.slice(0, FONT_DEDUPE_NAME_LIMIT).join(', ');
  const overflow = names.length - FONT_DEDUPE_NAME_LIMIT;
  return `다음 폰트 ${names.length}종이 번들에 없어 Pretendard 로 대체됩니다: ${shown} 외 ${overflow}종`;
}

export function colorToHex(color: Color | undefined): string {
  if (!color) return DEFAULT_COLOR_HEX;
  // Color is a union (RGBA | RGB | FRGB | HSB | CMYK | LAB | Grayscale).
  // We only handle RGB / RGBA explicitly; anything else falls back.
  const candidate = color as { r?: unknown; g?: unknown; b?: unknown };
  if (
    typeof candidate.r === 'number' &&
    typeof candidate.g === 'number' &&
    typeof candidate.b === 'number'
  ) {
    const r = candidate.r;
    const g = candidate.g;
    const b = candidate.b;
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return DEFAULT_COLOR_HEX;
    }
    return '#' + toHexByte(r) + toHexByte(g) + toHexByte(b);
  }
  return DEFAULT_COLOR_HEX;
}

export function toHexByte(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
}

export function mapAlignment(
  justification: string | undefined,
): 'left' | 'center' | 'right' {
  switch (justification) {
    case 'center':
    case 'justify-center':
      return 'center';
    case 'right':
    case 'justify-right':
      return 'right';
    default:
      return 'left';
  }
}

/**
 * Worker entry point. Piscina invokes this per task. It:
 *   1. wraps the transferred ArrayBuffer in a Buffer
 *   2. validates the PSD header (size cap, depth, magic)
 *   3. delegates to ag-psd's readPsd
 *   4. flattens to PNG via sharp
 *   5. extracts text slots
 *
 * Throws `PsdParseError` for header-level rejections, or wraps any ag-psd
 * exception into `PsdParseError('PSD_INVALID', ...)`.
 */
export async function runPsdParse(
  input: PsdParseWorkerInput,
): Promise<PsdParseWorkerResult> {
  // The service slices the upload into a fresh ArrayBuffer and lists it in
  // piscina's `transferList`, so the bytes arrived via ownership transfer
  // (no structured-clone duplicate). `Buffer.from(input.buffer)` here is a
  // zero-copy view over that same ArrayBuffer — it does not allocate a
  // second copy. Cost: one slice on the main thread + this view; we avoid
  // the structured-clone copy that would otherwise cross the thread boundary.
  const buffer = Buffer.from(input.buffer);

  // Header pre-validation. Rejects oversized / unsupported / bogus PSDs
  // before ag-psd gets a chance to allocate large internal buffers.
  validatePsdHeader(buffer);

  let psd: Psd;
  try {
    // ag-psd memory budget notes:
    //   - We DO need the composite (`useImageData: true`,
    //     `skipCompositeImageData: false`) because we flatten the PSD into a
    //     PNG via sharp downstream — that's the only base image the editor
    //     uses.
    //   - We do NOT need per-layer pixel data. Decoding every layer's raster
    //     would dominate memory in multi-layer PSDs (rough back-of-envelope:
    //     100 layers × 10000×10000 RGBA ≈ 40 GB working set, well past the
    //     2 GiB pod budget). `skipLayerImageData: true` short-circuits
    //     `readLayerChannelImageData` only — `layer.text` (TySh additional
    //     info), `layer.children`, `layer.bounds` (top/left/right/bottom),
    //     and the layer hierarchy are still populated from the layer record,
    //     which is exactly what `collectTextSlots` consumes.
    //   - `skipThumbnail: true` is a small win — the editor never reads the
    //     embedded thumbnail.
    // Reference (ag-psd v30.1.1): node_modules/.../ag-psd/dist/psdReader.js
    // line 482: `function readLayerChannelImageData(reader, psd, layer, channels) {
    //   if (reader.skipLayerImageData) return; ... }`.
    psd = readPsd(buffer, {
      useImageData: true,
      skipCompositeImageData: false, // composite needed for flatten PNG
      skipLayerImageData: true, // per-layer pixels not needed; metadata still parsed
      skipThumbnail: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PsdParseError('PSD_INVALID', `PSD parse failed: ${message}`);
  }

  const baseImageW = psd.width ?? 0;
  const baseImageH = psd.height ?? 0;
  if (!baseImageW || !baseImageH) {
    throw new PsdParseError(
      'PSD_INVALID',
      `PSD has invalid dimensions: ${baseImageW}x${baseImageH}`,
    );
  }

  const warnings: string[] = [];
  const children = psd.children ?? [];

  // Step 1: collect text-layer bounds (for the dest-out erase in flatten PNG).
  // The walk is identical to collectTextSlots' visibility/depth contract so
  // the erased regions match exactly the slots we emit.
  const textBounds: TextLayerBounds[] = [];
  for (const layer of children) {
    collectTextLayerBounds(layer, textBounds);
  }

  // Step 2: build flatten PNG with text-layer regions erased to transparent.
  // This prevents the "ghost text" overlap the user reported (text baked into
  // composite + slot text drawn on top by the editor).
  const flattenPngBuffer = await buildFlattenPng(psd, textBounds, warnings);

  // Step 3: collect text slots and unique unknown-font names. The font set
  // is aggregated below into a single warning (was 1-warning-per-text-layer
  // previously, producing N×M warnings for N layers using M unique fonts).
  const slots: TextSlot[] = [];
  const unknownFonts = new Set<string>();
  const depthLimitWarned = { value: false };
  for (const layer of children) {
    collectTextSlots(layer, slots, warnings, unknownFonts, 0, depthLimitWarned);
  }

  // Step 4: emit single aggregated unknown-font warning (Korean, user-facing).
  const fontWarning = buildAggregatedFontWarning(unknownFonts);
  if (fontWarning) pushWarning(warnings, fontWarning);

  const templateSpec: TemplateSpecV1 = {
    version: 1,
    slots,
  };

  return {
    baseImageW,
    baseImageH,
    flattenPngBuffer,
    templateSpec,
    warnings,
  };
}

export default runPsdParse;
