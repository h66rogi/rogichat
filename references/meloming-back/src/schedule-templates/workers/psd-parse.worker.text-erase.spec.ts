/**
 * End-to-end regression for the "ghost text" overlap fix
 * (`buildFlattenPng` text-layer dest-out erase).
 *
 * Background:
 *   The user reported that the editor was rendering text twice — once baked
 *   into the PSD's composite (which the editor uses as the background image)
 *   and once via the slot binding overlay drawn by the editor's TextSlotPreview.
 *   The fix: erase text-layer regions from the composite via sharp's
 *   `dest-out` blend so the editor draws cleanly on transparent slots.
 *
 * What this spec does:
 *   - Synthesizes a real PSD on the fly via ag-psd's `writePsdBuffer` —
 *     a 100×100 red background + one fully-opaque WHITE text layer at
 *     (25, 30) → (75, 60). We DO NOT mock ag-psd or sharp here so the
 *     entire compositing pipeline runs end-to-end.
 *   - Feeds the bytes to `runPsdParse` (the production worker entry).
 *   - Decodes the resulting flatten PNG via sharp.raw() and asserts:
 *       (a) pixels INSIDE the text-layer region have alpha = 0 (erased)
 *       (b) pixels OUTSIDE the text-layer region remain opaque red
 *   - Asserts a single TextSlot was emitted at the same bounds.
 *
 * If a future refactor accidentally drops the dest-out composite, the
 * "inside" pixels will still be opaque red and the test will fail loudly
 * with the original ghost-text symptom.
 *
 * NOTE: This spec deliberately does NOT call `jest.mock(...)`. It needs
 * the real ag-psd + @napi-rs/canvas + sharp to verify the erase actually
 * happens to bytes.
 */

import sharp from 'sharp';
import { writePsdBuffer } from 'ag-psd';
import { createCanvas } from '@napi-rs/canvas';
import { runPsdParse } from './psd-parse.worker';

// Region the synthetic text layer occupies in the PSD.
const TEXT_LEFT = 25;
const TEXT_TOP = 30;
const TEXT_RIGHT = 75;
const TEXT_BOTTOM = 60;

const CANVAS_W = 100;
const CANVAS_H = 100;

function buildSyntheticPsdWithTextLayer(): Buffer {
  // Red background canvas.
  const baseCanvas = createCanvas(CANVAS_W, CANVAS_H);
  const baseCtx = baseCanvas.getContext('2d');
  baseCtx.fillStyle = 'rgb(255, 0, 0)';
  baseCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // White text-layer canvas (50×30) — fully opaque so the composite bakes
  // it on top of the red. Note: ag-psd uses the layer's `canvas` to write
  // pixels and `text` for type info; we keep the canvas a flat white so the
  // composite has a clean rectangle of white pixels we can later assert on.
  const textCanvas = createCanvas(
    TEXT_RIGHT - TEXT_LEFT,
    TEXT_BOTTOM - TEXT_TOP,
  );
  const textCtx = textCanvas.getContext('2d');
  textCtx.fillStyle = 'rgb(255, 255, 255)';
  textCtx.fillRect(
    0,
    0,
    TEXT_RIGHT - TEXT_LEFT,
    TEXT_BOTTOM - TEXT_TOP,
  );

  // Cast shapes to the loose ag-psd `Layer`/`Psd` types via `as never`
  // because `writePsdBuffer`'s typings expect DOM HTMLCanvasElement, but
  // @napi-rs/canvas's Canvas is structurally compatible at runtime — same
  // pattern the worker uses (see worker block comment).
  const psd = {
    width: CANVAS_W,
    height: CANVAS_H,
    canvas: baseCanvas,
    children: [
      {
        name: 'background',
        canvas: baseCanvas,
        left: 0,
        top: 0,
      },
      {
        name: 'text-layer',
        canvas: textCanvas,
        left: TEXT_LEFT,
        top: TEXT_TOP,
        text: {
          text: 'TEST',
          style: {
            fontSize: 20,
            // Use a bundled font name so we don't trigger the font warning.
            font: { name: 'Pretendard' },
          },
        },
      },
    ],
  };

  return writePsdBuffer(psd as never);
}

describe('runPsdParse — ghost-text dest-out erase end-to-end', () => {
  it('erases the text-layer region from the flatten PNG (alpha→0 inside, red outside)', async () => {
    const psdBuf = buildSyntheticPsdWithTextLayer();

    const result = await runPsdParse({
      buffer: psdBuf.buffer.slice(
        psdBuf.byteOffset,
        psdBuf.byteOffset + psdBuf.byteLength,
      ),
    });

    expect(result.baseImageW).toBe(CANVAS_W);
    expect(result.baseImageH).toBe(CANVAS_H);
    expect(result.flattenPngBuffer.length).toBeGreaterThan(0);

    // Decode the flatten PNG back to raw RGBA so we can probe pixels.
    const { data, info } = await sharp(result.flattenPngBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixelAt = (x: number, y: number) => {
      const idx = (y * info.width + x) * channels;
      return {
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
        a: data[idx + 3],
      };
    };

    // Inside the text-layer region: alpha must be 0 (erased).
    const cx = Math.floor((TEXT_LEFT + TEXT_RIGHT) / 2);
    const cy = Math.floor((TEXT_TOP + TEXT_BOTTOM) / 2);
    const inside = pixelAt(cx, cy);
    expect(inside.a).toBe(0);

    // Outside the text-layer region: alpha = 255, color = red.
    const outside = pixelAt(5, 5);
    expect(outside.a).toBe(255);
    expect(outside.r).toBeGreaterThan(200);
    expect(outside.g).toBeLessThan(50);
    expect(outside.b).toBeLessThan(50);
  });

  it('emits exactly one TextSlot at the text-layer bounds with no font warning', async () => {
    const psdBuf = buildSyntheticPsdWithTextLayer();

    const result = await runPsdParse({
      buffer: psdBuf.buffer.slice(
        psdBuf.byteOffset,
        psdBuf.byteOffset + psdBuf.byteLength,
      ),
    });

    expect(result.templateSpec.slots).toHaveLength(1);
    const slot = result.templateSpec.slots[0];
    expect(slot.type).toBe('text');
    expect(slot.x).toBe(TEXT_LEFT);
    expect(slot.y).toBe(TEXT_TOP);
    expect(slot.w).toBe(TEXT_RIGHT - TEXT_LEFT);
    expect(slot.h).toBe(TEXT_BOTTOM - TEXT_TOP);
    // Bundled font → no warning.
    const fontWarnings = result.warnings.filter((w) =>
      w.includes('Pretendard 로 대체'),
    );
    expect(fontWarnings).toEqual([]);
  });

  it('aggregates non-bundled font warnings into a single message (no per-layer noise)', async () => {
    // Build a 2-text-layer PSD using ONE non-bundled font for both.
    // The previous behavior would emit 2 warnings; the new behavior emits 1.
    const baseCanvas = createCanvas(100, 100);
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.fillStyle = 'blue';
    baseCtx.fillRect(0, 0, 100, 100);

    const t1 = createCanvas(40, 20);
    t1.getContext('2d').fillRect(0, 0, 40, 20);
    const t2 = createCanvas(40, 20);
    t2.getContext('2d').fillRect(0, 0, 40, 20);

    const psd = {
      width: 100,
      height: 100,
      canvas: baseCanvas,
      children: [
        { name: 'bg', canvas: baseCanvas, left: 0, top: 0 },
        {
          name: 't1',
          canvas: t1,
          left: 5,
          top: 10,
          text: {
            text: 'A',
            style: { fontSize: 16, font: { name: 'WeirdCustomFont' } },
          },
        },
        {
          name: 't2',
          canvas: t2,
          left: 5,
          top: 50,
          text: {
            text: 'B',
            style: { fontSize: 16, font: { name: 'WeirdCustomFont' } },
          },
        },
      ],
    };
    const buf = writePsdBuffer(psd as never);
    const result = await runPsdParse({
      buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    });

    const fontWarnings = result.warnings.filter((w) =>
      w.includes('Pretendard 로 대체'),
    );
    expect(fontWarnings).toHaveLength(1);
    expect(fontWarnings[0]).toContain('1종');
    expect(fontWarnings[0]).toContain('WeirdCustomFont');
  });
});
