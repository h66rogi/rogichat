// ag-psd and sharp must be mocked BEFORE importing the worker module.
//
// We stub `initializeCanvas` as a no-op because the worker module's top-level
// `initializeCanvas(...)` side-effect runs at import time. The real
// `initializeCanvas` would also work here, but we mock the entire `ag-psd`
// module surface anyway to keep this spec hermetic from ag-psd internals.
// (The non-mocked canvas-init regression is covered separately by
// psd-parse.worker.canvas-init.spec.ts.)
jest.mock('ag-psd', () => ({
  readPsd: jest.fn(),
  initializeCanvas: jest.fn(),
}));
jest.mock('sharp', () => {
  return jest.fn();
});

import { readPsd } from 'ag-psd';
import sharp from 'sharp';
import {
  buildAggregatedFontWarning,
  BUNDLED_FONTS,
  clampBoundsToImage,
  collectTextLayerBounds,
  collectTextSlots,
  colorToHex,
  DEFAULT_COLOR_HEX,
  FONT_DEDUPE_NAME_LIMIT,
  MAX_DIMENSION,
  MAX_LAYER_DEPTH,
  MAX_PIXEL_COUNT,
  MAX_WARNINGS,
  normalizeFontName,
  parseErrorPrefix,
  pushWarning,
  PsdParseError,
  runPsdParse,
  validatePsdHeader,
} from './psd-parse.worker';

const readPsdMock = readPsd as jest.MockedFunction<typeof readPsd>;
const sharpMock = sharp as unknown as jest.Mock;

function stubSharpReturnsPng(buffer: Buffer = Buffer.from('png-bytes')): void {
  // The pipeline returned by sharp(...) must support `.composite(...)` (used
  // by the dest-out text-erase path), `.png()`, and `.toBuffer()`. Both
  // `.composite()` and `.png()` are chainable in real sharp; we make them
  // return the same pipeline object so the chain doesn't break.
  const pipeline: Record<string, unknown> = {};
  pipeline.composite = jest.fn().mockReturnValue(pipeline);
  pipeline.png = jest.fn().mockReturnValue(pipeline);
  pipeline.toBuffer = jest.fn().mockResolvedValue(buffer);
  sharpMock.mockImplementation(() => pipeline);
}

function makePixelData(width: number, height: number) {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  };
}

/**
 * Build a synthetic 26-byte PSD header. Defaults to 1920x1080, 8-bit RGB.
 */
function makePsdHeader(
  opts: {
    magic?: [number, number, number, number];
    version?: number;
    channels?: number;
    width?: number;
    height?: number;
    depth?: number;
    colorMode?: number;
    extraBytes?: number;
  } = {},
): Buffer {
  const magic = opts.magic ?? [0x38, 0x42, 0x50, 0x53];
  const version = opts.version ?? 1;
  const channels = opts.channels ?? 4;
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const depth = opts.depth ?? 8;
  const colorMode = opts.colorMode ?? 3;
  const extra = opts.extraBytes ?? 0;
  const buf = Buffer.alloc(26 + extra);
  buf[0] = magic[0];
  buf[1] = magic[1];
  buf[2] = magic[2];
  buf[3] = magic[3];
  buf.writeUInt16BE(version, 4);
  // bytes 6-11 reserved
  buf.writeUInt16BE(channels, 12);
  buf.writeUInt32BE(height, 14);
  buf.writeUInt32BE(width, 18);
  buf.writeUInt16BE(depth, 22);
  buf.writeUInt16BE(colorMode, 24);
  return buf;
}

describe('validatePsdHeader', () => {
  it('accepts a well-formed 8-bit PSD header', () => {
    const buf = makePsdHeader({ width: 1920, height: 1080 });
    expect(validatePsdHeader(buf)).toEqual({ width: 1920, height: 1080 });
  });

  it('throws PSD_INVALID when buffer is shorter than 26 bytes', () => {
    expect(() => validatePsdHeader(Buffer.alloc(10))).toThrow(PsdParseError);
    try {
      validatePsdHeader(Buffer.alloc(10));
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
    }
  });

  it('throws PSD_INVALID when magic is not 8BPS', () => {
    const buf = makePsdHeader({ magic: [0x00, 0x00, 0x00, 0x00] });
    try {
      validatePsdHeader(buf);
      fail('should have thrown');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
      expect((e as PsdParseError).message).toMatch(/magic/i);
    }
  });

  it('accepts version 2 (PSB)', () => {
    const buf = makePsdHeader({ version: 2 });
    expect(validatePsdHeader(buf).width).toBe(1920);
  });

  it('rejects unknown versions', () => {
    const buf = makePsdHeader({ version: 5 });
    try {
      validatePsdHeader(buf);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
    }
  });

  it('rejects channel count out of 1..56 range', () => {
    const buf = makePsdHeader({ channels: 100 });
    try {
      validatePsdHeader(buf);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
    }

    const buf2 = makePsdHeader({ channels: 0 });
    try {
      validatePsdHeader(buf2);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
    }
  });

  it('rejects zero width or height with PSD_INVALID', () => {
    const buf = makePsdHeader({ width: 0, height: 1080 });
    try {
      validatePsdHeader(buf);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
    }
  });

  it('rejects width > MAX_DIMENSION with PSD_OVERSIZED', () => {
    const buf = makePsdHeader({ width: MAX_DIMENSION + 1, height: 1000 });
    try {
      validatePsdHeader(buf);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_OVERSIZED');
    }
  });

  it('rejects height > MAX_DIMENSION with PSD_OVERSIZED', () => {
    const buf = makePsdHeader({ width: 1000, height: MAX_DIMENSION + 1 });
    try {
      validatePsdHeader(buf);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_OVERSIZED');
    }
  });

  it('exposes MAX_PIXEL_COUNT of 1억 (100M) pixels', () => {
    // Pod-memory reduction from the B8 review#2: cap pixel count at 100M
    // (reference: 10000×10000). Per-side cap stays at 20000 (the pixel
    // check is the real memory guard).
    expect(MAX_PIXEL_COUNT).toBe(100_000_000);
  });

  it('accepts PSD exactly at the pixel-count cap (10000×10000)', () => {
    const exactCap = makePsdHeader({ width: 10000, height: 10000 });
    expect(validatePsdHeader(exactCap)).toEqual({ width: 10000, height: 10000 });
  });

  it('rejects pixel count > MAX_PIXEL_COUNT with PSD_OVERSIZED', () => {
    // Per-side cap stays at 20000; a 10000×10001 PSD passes dimension check
    // (both sides well under 20000) but trips the pixel-count guard.
    const overPixel = makePsdHeader({ width: 10000, height: 10001 });
    try {
      validatePsdHeader(overPixel);
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PsdParseError);
      expect((e as PsdParseError).code).toBe('PSD_OVERSIZED');
      expect((e as PsdParseError).message).toMatch(/pixel count/i);
    }
  });

  it('still rejects any side > MAX_DIMENSION even when pixel count is below cap', () => {
    // A 20001×1 PSD has only ~20k pixels (way under 100M) but blows the
    // single-side cap. Dimension check still fires first.
    const overSide = makePsdHeader({ width: MAX_DIMENSION + 1, height: 1 });
    try {
      validatePsdHeader(overSide);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_OVERSIZED');
    }
  });

  it('rejects 16-bit depth with PSD_UNSUPPORTED_DEPTH', () => {
    const buf = makePsdHeader({ depth: 16 });
    try {
      validatePsdHeader(buf);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_UNSUPPORTED_DEPTH');
    }
  });

  it('rejects 32-bit depth with PSD_UNSUPPORTED_DEPTH', () => {
    const buf = makePsdHeader({ depth: 32 });
    try {
      validatePsdHeader(buf);
      fail('should throw');
    } catch (e) {
      expect((e as PsdParseError).code).toBe('PSD_UNSUPPORTED_DEPTH');
    }
  });
});

describe('PsdParseError + parseErrorPrefix', () => {
  it('PsdParseError.message includes [CODE] prefix so it survives structured clone', () => {
    const err = new PsdParseError('PSD_OVERSIZED', 'too big');
    expect(err.message).toBe('[PSD_OVERSIZED] too big');
    expect(err.code).toBe('PSD_OVERSIZED');
    expect(err.name).toBe('PsdParseError');
  });

  it('parseErrorPrefix extracts known codes', () => {
    expect(parseErrorPrefix('[PSD_INVALID] bad')).toEqual({
      code: 'PSD_INVALID',
      message: 'bad',
    });
    expect(parseErrorPrefix('[PSD_OVERSIZED] too big')).toEqual({
      code: 'PSD_OVERSIZED',
      message: 'too big',
    });
    expect(parseErrorPrefix('[PSD_UNSUPPORTED_DEPTH] use 8-bit')).toEqual({
      code: 'PSD_UNSUPPORTED_DEPTH',
      message: 'use 8-bit',
    });
  });

  it('parseErrorPrefix returns null for messages without a prefix', () => {
    expect(parseErrorPrefix('plain message')).toBeNull();
    expect(parseErrorPrefix('[UNKNOWN_CODE] something')).toBeNull();
  });
});

describe('normalizeFontName', () => {
  it('lowercases and strips weight suffix separated by hyphen', () => {
    expect(normalizeFontName('Pretendard-Regular')).toBe('pretendard');
  });
  it('lowercases when only the case differs', () => {
    expect(normalizeFontName('PRETENDARD')).toBe('pretendard');
  });
  it('strips weight suffix separated by underscore', () => {
    expect(normalizeFontName('Pretendard_Bold')).toBe('pretendard');
  });
  it('strips weight suffix separated by space', () => {
    expect(normalizeFontName('Pretendard Bold')).toBe('pretendard');
  });
  it('confirms BUNDLED_FONTS contains pretendard and paperlogy', () => {
    expect(BUNDLED_FONTS.has('pretendard')).toBe(true);
    expect(BUNDLED_FONTS.has('paperlogy')).toBe(true);
  });
});

describe('colorToHex (NaN / Infinity guards)', () => {
  it('returns default when r is NaN', () => {
    expect(colorToHex({ r: NaN, g: 0, b: 0 } as never)).toBe(DEFAULT_COLOR_HEX);
  });
  it('returns default when r is Infinity', () => {
    expect(colorToHex({ r: Infinity, g: 0, b: 0 } as never)).toBe(
      DEFAULT_COLOR_HEX,
    );
  });
  it('returns default when g is -Infinity', () => {
    expect(colorToHex({ r: 0, g: -Infinity, b: 0 } as never)).toBe(
      DEFAULT_COLOR_HEX,
    );
  });
  it('clamps and converts a valid RGB color', () => {
    expect(colorToHex({ r: 0, g: 0, b: 0 } as never)).toBe('#000000');
    expect(colorToHex({ r: 255, g: 255, b: 255 } as never)).toBe('#ffffff');
  });
});

describe('pushWarning (cap)', () => {
  it('appends up to MAX_WARNINGS and adds a single truncation marker', () => {
    const w: string[] = [];
    for (let i = 0; i < 100; i++) {
      pushWarning(w, `warn ${i}`);
    }
    // 50 real + 1 truncation marker = 51 total
    expect(w).toHaveLength(MAX_WARNINGS + 1);
    expect(w[MAX_WARNINGS]).toBe('...and more warnings truncated');
    // First 50 are the original messages
    expect(w[0]).toBe('warn 0');
    expect(w[MAX_WARNINGS - 1]).toBe(`warn ${MAX_WARNINGS - 1}`);
  });

  it('does not double-add the truncation marker on subsequent calls', () => {
    const w: string[] = [];
    for (let i = 0; i < MAX_WARNINGS + 5; i++) {
      pushWarning(w, `warn ${i}`);
    }
    const truncatedCount = w.filter(
      (m) => m === '...and more warnings truncated',
    ).length;
    expect(truncatedCount).toBe(1);
  });

  it('appends normally below the cap', () => {
    const w: string[] = [];
    pushWarning(w, 'a');
    pushWarning(w, 'b');
    expect(w).toEqual(['a', 'b']);
  });
});

describe('collectTextSlots', () => {
  it('caps recursion depth and pushes a single truncation warning', () => {
    // Build a chain 50 levels deep, with a text leaf at the bottom.
    const buildChain = (depth: number): unknown => {
      if (depth === 0) {
        return {
          left: 0,
          top: 0,
          right: 50,
          bottom: 30,
          text: {
            text: 'leaf',
            style: { fontSize: 14, font: { name: 'Pretendard' } },
          },
        };
      }
      return { children: [buildChain(depth - 1)] };
    };
    const root = buildChain(50);

    const slots: never[] = [];
    const warnings: string[] = [];
    collectTextSlots(root as never, slots as never[], warnings);

    // Leaf is below depth limit so it should not be emitted
    expect(slots.length).toBe(0);
    const truncationWarnings = warnings.filter((w) =>
      w.includes('depth limit'),
    );
    expect(truncationWarnings).toHaveLength(1);
    expect(truncationWarnings[0]).toContain(`${MAX_LAYER_DEPTH}`);
  });

  it('recurses into a group and skips the group\'s own text', () => {
    const root = {
      // Group with both children AND text — text on the group is ignored.
      text: {
        text: 'group-self',
        style: { fontSize: 16, font: { name: 'Pretendard' } },
      },
      children: [
        {
          left: 0,
          top: 0,
          right: 100,
          bottom: 30,
          text: {
            text: 'child-text',
            style: { fontSize: 16, font: { name: 'Pretendard' } },
          },
        },
      ],
    };
    const slots: never[] = [];
    const warnings: string[] = [];
    collectTextSlots(root as never, slots as never[], warnings);

    expect(slots).toHaveLength(1);
    expect((slots[0] as never as { literal: string }).literal).toBe(
      'child-text',
    );
  });
});

describe('runPsdParse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubSharpReturnsPng();
  });

  it('parses a happy-path PSD end-to-end', async () => {
    const header = makePsdHeader({ width: 1920, height: 1080 });
    readPsdMock.mockReturnValue({
      width: 1920,
      height: 1080,
      imageData: makePixelData(1920, 1080),
      children: [
        {
          left: 100,
          top: 200,
          right: 400,
          bottom: 260,
          hidden: false,
          text: {
            text: 'Hello world',
            style: {
              fontSize: 32,
              fillColor: { r: 255, g: 128, b: 64 },
              font: { name: 'Pretendard' },
            },
            paragraphStyle: { justification: 'center' },
          },
        },
      ],
    } as never);

    const result = await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });
    expect(result.baseImageW).toBe(1920);
    expect(result.baseImageH).toBe(1080);
    expect(result.templateSpec.slots).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('invokes ag-psd readPsd with skipLayerImageData: true to bound memory', async () => {
    // B8 review#3 BLOCKER fix: per-layer pixel data is unused (we only need
    // the composite for flatten + layer.text/bounds for slots) and would
    // dominate memory in multi-layer PSDs. ag-psd v30's `skipLayerImageData`
    // short-circuits `readLayerChannelImageData` only — text and layer
    // metadata still parse. This test pins the option set so a future edit
    // doesn't accidentally re-enable layer pixel decoding.
    const header = makePsdHeader({ width: 1024, height: 768 });
    readPsdMock.mockReturnValue({
      width: 1024,
      height: 768,
      imageData: makePixelData(1024, 768),
      children: [
        {
          left: 0,
          top: 0,
          right: 100,
          bottom: 30,
          text: {
            text: 'still works',
            style: { fontSize: 16, font: { name: 'Pretendard' } },
          },
        },
      ],
    } as never);

    const result = await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });

    expect(readPsdMock).toHaveBeenCalledTimes(1);
    const passedOptions = readPsdMock.mock.calls[0][1];
    expect(passedOptions).toMatchObject({
      useImageData: true,
      skipCompositeImageData: false,
      skipLayerImageData: true,
      skipThumbnail: true,
    });
    // And the text-slot path still works under that option set.
    expect(result.templateSpec.slots).toHaveLength(1);
    expect(result.templateSpec.slots[0].literal).toBe('still works');
  });

  it('throws PsdParseError(PSD_INVALID) for non-PSD bytes', async () => {
    const buf = Buffer.alloc(40); // wrong magic
    try {
      await runPsdParse({
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PsdParseError);
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
    }
  });

  it('throws PsdParseError(PSD_OVERSIZED) for oversized PSD before ag-psd is called', async () => {
    const header = makePsdHeader({
      width: MAX_DIMENSION + 1,
      height: 1000,
    });
    try {
      await runPsdParse({
        buffer: header.buffer.slice(
          header.byteOffset,
          header.byteOffset + header.byteLength,
        ),
      });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PsdParseError);
      expect((e as PsdParseError).code).toBe('PSD_OVERSIZED');
    }
    expect(readPsdMock).not.toHaveBeenCalled();
  });

  it('throws PsdParseError(PSD_UNSUPPORTED_DEPTH) for 16-bit PSD', async () => {
    const header = makePsdHeader({ depth: 16 });
    try {
      await runPsdParse({
        buffer: header.buffer.slice(
          header.byteOffset,
          header.byteOffset + header.byteLength,
        ),
      });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PsdParseError);
      expect((e as PsdParseError).code).toBe('PSD_UNSUPPORTED_DEPTH');
    }
  });

  it('wraps an ag-psd throw into PsdParseError(PSD_INVALID)', async () => {
    readPsdMock.mockImplementation(() => {
      throw new Error('corrupt psd');
    });
    const header = makePsdHeader();
    try {
      await runPsdParse({
        buffer: header.buffer.slice(
          header.byteOffset,
          header.byteOffset + header.byteLength,
        ),
      });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PsdParseError);
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
    }
  });

  it('aggregates many text layers using the SAME non-bundled font into ONE warning', async () => {
    // User reported "24 errors" for the BLUE template — all 24 text layers
    // used one of two unique non-bundled fonts. The new dedupe path should
    // emit ONE warning naming both fonts, not 24.
    const children = [];
    for (let i = 0; i < 24; i++) {
      children.push({
        left: 0,
        top: i * 10,
        right: 100,
        bottom: i * 10 + 8,
        text: {
          text: `t${i}`,
          // Alternate between two unique non-bundled fonts (matches the
          // BLUE template's PretendardVariable-SemiBold + ONEMobilePOPRegular).
          style: {
            fontSize: 16,
            font: {
              name: i % 2 === 0 ? 'WeirdFontA' : 'WeirdFontB',
            },
          },
        },
      });
    }
    readPsdMock.mockReturnValue({
      width: 800,
      height: 600,
      imageData: makePixelData(800, 600),
      children,
    } as never);

    const header = makePsdHeader({ width: 800, height: 600 });
    const result = await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('2종');
    expect(result.warnings[0]).toContain('WeirdFontA');
    expect(result.warnings[0]).toContain('WeirdFontB');
    expect(result.warnings[0]).toContain('Pretendard');
  });

  it('aggregated font warning lists fonts deterministically (sorted) when many uniques present', async () => {
    // Many unique fonts → still ONE warning, with names sorted.
    // Stays under FONT_DEDUPE_NAME_LIMIT (50) so no overflow suffix.
    const children = [];
    for (let i = 0; i < 10; i++) {
      children.push({
        left: 0,
        top: i * 10,
        right: 100,
        bottom: i * 10 + 8,
        text: {
          text: `t${i}`,
          style: {
            fontSize: 16,
            font: { name: `WeirdFont${String(i).padStart(2, '0')}` },
          },
        },
      });
    }
    readPsdMock.mockReturnValue({
      width: 800,
      height: 600,
      imageData: makePixelData(800, 600),
      children,
    } as never);

    const header = makePsdHeader({ width: 800, height: 600 });
    const result = await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('10종');
    // Names sorted ascending
    expect(result.warnings[0]).toContain(
      'WeirdFont00, WeirdFont01, WeirdFont02',
    );
  });

  it('aggregated font warning truncates with "외 N종" when uniques exceed FONT_DEDUPE_NAME_LIMIT (50)', async () => {
    const children = [];
    for (let i = 0; i < 60; i++) {
      children.push({
        left: 0,
        top: i * 10,
        right: 100,
        bottom: i * 10 + 8,
        text: {
          text: `t${i}`,
          // 60 unique fonts → 50 listed + "외 10종"
          style: {
            fontSize: 16,
            font: { name: `WeirdFont${String(i).padStart(3, '0')}` },
          },
        },
      });
    }
    readPsdMock.mockReturnValue({
      width: 800,
      height: 600,
      imageData: makePixelData(800, 600),
      children,
    } as never);

    const header = makePsdHeader({ width: 800, height: 600 });
    const result = await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('60종');
    expect(result.warnings[0]).toContain('외 10종');
  });

  it('does not warn for case-mismatched bundled fonts (Pretendard-Regular, PRETENDARD, Pretendard_Bold)', async () => {
    readPsdMock.mockReturnValue({
      width: 800,
      height: 600,
      imageData: makePixelData(800, 600),
      children: [
        {
          left: 0,
          top: 0,
          right: 100,
          bottom: 30,
          text: {
            text: 'a',
            style: { fontSize: 16, font: { name: 'Pretendard-Regular' } },
          },
        },
        {
          left: 0,
          top: 0,
          right: 100,
          bottom: 30,
          text: {
            text: 'b',
            style: { fontSize: 16, font: { name: 'PRETENDARD' } },
          },
        },
        {
          left: 0,
          top: 0,
          right: 100,
          bottom: 30,
          text: {
            text: 'c',
            style: { fontSize: 16, font: { name: 'Pretendard_Bold' } },
          },
        },
      ],
    } as never);

    const header = makePsdHeader({ width: 800, height: 600 });
    const result = await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });
    expect(result.warnings).toEqual([]);
  });
});

describe('collectTextLayerBounds', () => {
  it('returns empty array for an empty/childless layer with no text', () => {
    const out = collectTextLayerBounds({} as never);
    expect(out).toEqual([]);
  });

  it('collects bounds for a single visible text layer', () => {
    const layer = {
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
      text: { text: 'hi' },
    };
    const out = collectTextLayerBounds(layer as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ left: 10, top: 20, width: 100, height: 40 });
  });

  it('skips hidden text layers entirely', () => {
    const layer = {
      hidden: true,
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
      text: { text: 'hi' },
    };
    const out = collectTextLayerBounds(layer as never);
    expect(out).toEqual([]);
  });

  it('recurses into groups and skips group-level text (matches collectTextSlots contract)', () => {
    const root = {
      // A group with both children AND text — group's text is ignored, children walked.
      text: { text: 'group-text' },
      children: [
        { left: 0, top: 0, right: 50, bottom: 30, text: { text: 'child' } },
      ],
    };
    const out = collectTextLayerBounds(root as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ left: 0, top: 0, width: 50, height: 30 });
  });

  it('clamps minimum width/height to 1 when bounds are zero-sized', () => {
    const layer = {
      left: 5,
      top: 5,
      right: 5,
      bottom: 5,
      text: { text: 'point' },
    };
    const out = collectTextLayerBounds(layer as never);
    expect(out[0]).toEqual({ left: 5, top: 5, width: 1, height: 1 });
  });

  it('handles missing left/top/right/bottom by defaulting to 0/+1', () => {
    const layer = { text: { text: 'no bounds' } };
    const out = collectTextLayerBounds(layer as never);
    expect(out).toHaveLength(1);
    // left=0, top=0, right=0+1=1, bottom=0+1=1 → w/h max(1, 1) = 1
    expect(out[0]).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });
});

describe('clampBoundsToImage', () => {
  it('returns unchanged bounds fully inside the image', () => {
    expect(
      clampBoundsToImage({ left: 10, top: 20, width: 50, height: 40 }, 200, 200),
    ).toEqual({ left: 10, top: 20, width: 50, height: 40 });
  });

  it('clamps bounds extending past the right edge', () => {
    expect(
      clampBoundsToImage({ left: 90, top: 0, width: 50, height: 10 }, 100, 100),
    ).toEqual({ left: 90, top: 0, width: 10, height: 10 });
  });

  it('clamps bounds extending past the bottom edge', () => {
    expect(
      clampBoundsToImage({ left: 0, top: 90, width: 10, height: 50 }, 100, 100),
    ).toEqual({ left: 0, top: 90, width: 10, height: 10 });
  });

  it('clamps bounds extending past the left edge (negative left)', () => {
    expect(
      clampBoundsToImage({ left: -10, top: 0, width: 30, height: 10 }, 100, 100),
    ).toEqual({ left: 0, top: 0, width: 20, height: 10 });
  });

  it('returns null for bounds fully outside the image (right of canvas)', () => {
    expect(
      clampBoundsToImage({ left: 200, top: 0, width: 10, height: 10 }, 100, 100),
    ).toBeNull();
  });

  it('returns null for bounds fully outside the image (below canvas)', () => {
    expect(
      clampBoundsToImage({ left: 0, top: 200, width: 10, height: 10 }, 100, 100),
    ).toBeNull();
  });
});

describe('buildAggregatedFontWarning', () => {
  it('returns null when no unknown fonts were collected', () => {
    expect(buildAggregatedFontWarning(new Set())).toBeNull();
  });

  it('lists a single unknown font with korean copy + Pretendard fallback note', () => {
    const out = buildAggregatedFontWarning(new Set(['MyFont']));
    expect(out).toBe(
      '다음 폰트 1종이 번들에 없어 Pretendard 로 대체됩니다: MyFont',
    );
  });

  it('lists multiple fonts in sorted order (deterministic)', () => {
    const out = buildAggregatedFontWarning(new Set(['Cccc', 'Aaaa', 'Bbbb']));
    expect(out).toContain('3종');
    expect(out).toContain('Aaaa, Bbbb, Cccc');
  });

  it(`truncates with "외 N종" when uniques exceed FONT_DEDUPE_NAME_LIMIT (${FONT_DEDUPE_NAME_LIMIT})`, () => {
    const fonts = new Set<string>();
    for (let i = 0; i < FONT_DEDUPE_NAME_LIMIT + 5; i++) {
      fonts.add(`Font${String(i).padStart(3, '0')}`);
    }
    const out = buildAggregatedFontWarning(fonts);
    expect(out).toContain(`${FONT_DEDUPE_NAME_LIMIT + 5}종`);
    expect(out).toContain('외 5종');
  });
});

describe('runPsdParse — text-layer flatten erase (ghost-text fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes one dest-out composite operation per visible text layer to sharp', async () => {
    // Track sharp() calls and what composite ops it received.
    const compositeMock = jest.fn().mockReturnThis();
    const pngMock = jest.fn().mockReturnThis();
    const toBufferMock = jest.fn().mockResolvedValue(Buffer.from('flatten'));

    sharpMock.mockImplementation(() => ({
      composite: compositeMock,
      png: pngMock,
      toBuffer: toBufferMock,
    }));

    readPsdMock.mockReturnValue({
      width: 100,
      height: 100,
      imageData: makePixelData(100, 100),
      children: [
        {
          left: 10,
          top: 20,
          right: 60,
          bottom: 50,
          text: {
            text: 't1',
            style: { fontSize: 16, font: { name: 'Pretendard' } },
          },
        },
        {
          left: 30,
          top: 40,
          right: 80,
          bottom: 60,
          text: {
            text: 't2',
            style: { fontSize: 16, font: { name: 'Pretendard' } },
          },
        },
      ],
    } as never);

    const header = makePsdHeader({ width: 100, height: 100 });
    await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });

    // composite() called once with array of 2 ops.
    expect(compositeMock).toHaveBeenCalledTimes(1);
    const ops = compositeMock.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      blend: 'dest-out',
      left: 10,
      top: 20,
    });
    expect(ops[1]).toMatchObject({
      blend: 'dest-out',
      left: 30,
      top: 40,
    });
  });

  it('does not call composite when there are no text layers (no-op flatten path)', async () => {
    const compositeMock = jest.fn().mockReturnThis();
    const pngMock = jest.fn().mockReturnThis();
    const toBufferMock = jest.fn().mockResolvedValue(Buffer.from('flatten'));
    sharpMock.mockImplementation(() => ({
      composite: compositeMock,
      png: pngMock,
      toBuffer: toBufferMock,
    }));

    readPsdMock.mockReturnValue({
      width: 100,
      height: 100,
      imageData: makePixelData(100, 100),
      children: [
        // image-only layer, no text
        { left: 0, top: 0, right: 100, bottom: 100 },
      ],
    } as never);

    const header = makePsdHeader({ width: 100, height: 100 });
    await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });

    expect(compositeMock).not.toHaveBeenCalled();
  });

  it('skips text layers whose bounds are fully outside the canvas (no composite op for them)', async () => {
    const compositeMock = jest.fn().mockReturnThis();
    const pngMock = jest.fn().mockReturnThis();
    const toBufferMock = jest.fn().mockResolvedValue(Buffer.from('flatten'));
    sharpMock.mockImplementation(() => ({
      composite: compositeMock,
      png: pngMock,
      toBuffer: toBufferMock,
    }));

    readPsdMock.mockReturnValue({
      width: 100,
      height: 100,
      imageData: makePixelData(100, 100),
      children: [
        // Inside canvas
        {
          left: 10,
          top: 20,
          right: 60,
          bottom: 50,
          text: {
            text: 't-in',
            style: { fontSize: 16, font: { name: 'Pretendard' } },
          },
        },
        // Fully outside canvas (off to the right)
        {
          left: 200,
          top: 0,
          right: 250,
          bottom: 30,
          text: {
            text: 't-out',
            style: { fontSize: 16, font: { name: 'Pretendard' } },
          },
        },
      ],
    } as never);

    const header = makePsdHeader({ width: 100, height: 100 });
    await runPsdParse({
      buffer: header.buffer.slice(
        header.byteOffset,
        header.byteOffset + header.byteLength,
      ),
    });

    expect(compositeMock).toHaveBeenCalledTimes(1);
    const ops = compositeMock.mock.calls[0][0];
    // Only the in-bounds layer makes it
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ left: 10, top: 20 });
  });
});
