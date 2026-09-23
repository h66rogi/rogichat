/**
 * Regression test for the ag-psd "Canvas not initialized" BLOCKER.
 *
 * Background:
 *   Before this fix, importing the worker would not register a canvas
 *   factory with ag-psd. The first time ag-psd's composite/layer/mask
 *   decoder hit `helpers.createImageData(...)` (which lazily calls
 *   `createCanvas(1, 1)`), it threw:
 *     "Canvas not initialized, use initializeCanvas method to set up
 *      createCanvas method"
 *   See ag-psd/src/helpers.ts:372 and psdReader.js:720-740.
 *
 * What this test does:
 *   - Imports the worker module WITHOUT mocking ag-psd, so the
 *     `initializeCanvas(...)` side-effect at the top of the worker actually
 *     runs against the real ag-psd.
 *   - Generates a tiny, valid PSD on the fly via ag-psd's `writePsdBuffer`,
 *     filling 1x1 imageData. `writePsdBuffer` itself calls
 *     `helpers.createCanvas(10, 10)` to build a thumbnail (psdWriter.js:565),
 *     so the very act of producing the fixture would throw before the fix.
 *   - Feeds the generated PSD bytes through `runPsdParse`, which calls
 *     `ag-psd.readPsd(...)`. With `useImageData: true` +
 *     `skipCompositeImageData: false` (our production options) the reader
 *     hits `createImageDataBitDepth` -> `helpers.createImageData(...)` ->
 *     ag-psd's default impl which lazily allocates a 1x1 canvas via
 *     `createCanvas`. Without the fix, this throws with the BLOCKER message.
 *
 * The test fails loudly if the BLOCKER message ever resurfaces, even if a
 * future refactor accidentally drops the `initializeCanvas(...)` call at
 * the top of the worker module.
 *
 * NOTE: this spec deliberately does NOT call `jest.mock('ag-psd', ...)`.
 * It needs the real ag-psd to verify the canvas wiring.
 */

import { writePsdBuffer } from 'ag-psd';
import { runPsdParse, PsdParseError } from './psd-parse.worker';

const CANVAS_NOT_INITIALIZED = /canvas not initialized/i;

describe('psd-parse.worker — ag-psd canvas init regression', () => {
  it('importing the worker registers a canvas factory so writePsdBuffer does not throw', () => {
    // Importing the worker (top of file) ran `initializeCanvas(...)`. If
    // the registration is missing, this writePsdBuffer call throws
    // "Canvas not initialized" because the writer allocates a thumbnail
    // canvas via `helpers.createCanvas(10, 10)`.
    expect(() =>
      writePsdBuffer({
        width: 1,
        height: 1,
        children: [{ name: 'L1' }],
      }),
    ).not.toThrow(CANVAS_NOT_INITIALIZED);
  });

  it('runPsdParse parses a real round-trip PSD without the "Canvas not initialized" error', async () => {
    // Build a minimal valid PSD via ag-psd itself. This exercises:
    //   1. `helpers.createCanvas` during write (thumbnail allocation).
    //   2. `helpers.createImageData` during read (composite decode).
    // Both are the codepaths that previously blew up.
    const buffer = writePsdBuffer({
      width: 4,
      height: 4,
      children: [{ name: 'L1' }],
    });

    // Slice into a fresh standalone ArrayBuffer (matches what the service
    // layer hands to the worker via piscina's transferList).
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );

    let result;
    try {
      result = await runPsdParse({ buffer: ab });
    } catch (e) {
      // Re-throw with extra context so a regression is obvious in CI logs.
      const msg = e instanceof Error ? e.message : String(e);
      if (CANVAS_NOT_INITIALIZED.test(msg)) {
        throw new Error(
          `BLOCKER regression: ag-psd's createCanvas factory is not registered. ` +
            `Original error: ${msg}`,
        );
      }
      throw e;
    }

    expect(result.baseImageW).toBe(4);
    expect(result.baseImageH).toBe(4);
    expect(result.flattenPngBuffer.length).toBeGreaterThan(0);
    expect(result.templateSpec.slots).toEqual([]);
  });

  it('runPsdParse throws PsdParseError(PSD_INVALID) for non-PSD bytes (and not "Canvas not initialized")', async () => {
    // Sanity check: the canvas-init regression path doesn't accidentally
    // mask other failure modes — non-PSD input should still throw the
    // structured PsdParseError, not the canvas BLOCKER.
    const garbage = Buffer.alloc(40); // wrong magic
    const ab = garbage.buffer.slice(
      garbage.byteOffset,
      garbage.byteOffset + garbage.byteLength,
    );
    try {
      await runPsdParse({ buffer: ab });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PsdParseError);
      expect((e as PsdParseError).code).toBe('PSD_INVALID');
      expect((e as PsdParseError).message).not.toMatch(CANVAS_NOT_INITIALIZED);
    }
  });
});
