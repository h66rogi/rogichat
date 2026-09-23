import { parseLrc } from './lrc.parser';

describe('parseLrc', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(parseLrc(null)).toEqual([]);
    expect(parseLrc(undefined)).toEqual([]);
    expect(parseLrc('')).toEqual([]);
  });

  it('parses [mm:ss.xx]text into ms', () => {
    const out = parseLrc('[00:12.34]Hello\n[01:05.50]World');
    expect(out).toEqual([
      { startMs: 12_340, text: 'Hello' },
      { startMs: 65_500, text: 'World' },
    ]);
  });

  it('handles ms precision [mm:ss.xxx]', () => {
    const out = parseLrc('[00:01.234]A\n[00:02.5]B\n[00:03.4]C');
    expect(out).toEqual([
      { startMs: 1_234, text: 'A' },
      { startMs: 2_500, text: 'B' },
      { startMs: 3_400, text: 'C' },
    ]);
  });

  it('expands multiple timestamps on the same line', () => {
    const out = parseLrc('[00:10.00][01:00.00]chorus');
    expect(out).toEqual([
      { startMs: 10_000, text: 'chorus' },
      { startMs: 60_000, text: 'chorus' },
    ]);
  });

  it('skips lines without timestamps', () => {
    const out = parseLrc('intro line no stamp\n[00:05.00]first\nfree text');
    expect(out).toEqual([{ startMs: 5_000, text: 'first' }]);
  });

  it('skips empty timestamp markers (kept as empty text)', () => {
    const out = parseLrc('[00:00.00]\n[00:01.00]hi');
    expect(out).toEqual([
      { startMs: 0, text: '' },
      { startMs: 1_000, text: 'hi' },
    ]);
  });

  it('rejects invalid seconds (>=60)', () => {
    const out = parseLrc('[00:99.00]bad\n[00:30.00]good');
    expect(out).toEqual([{ startMs: 30_000, text: 'good' }]);
  });

  it('sorts by startMs ascending', () => {
    const out = parseLrc('[01:00.00]b\n[00:30.00]a\n[02:00.00]c');
    expect(out.map((l) => l.startMs)).toEqual([30_000, 60_000, 120_000]);
  });

  it('handles CRLF line endings', () => {
    const out = parseLrc('[00:01.00]a\r\n[00:02.00]b');
    expect(out).toEqual([
      { startMs: 1_000, text: 'a' },
      { startMs: 2_000, text: 'b' },
    ]);
  });

  it('trims trailing whitespace from text', () => {
    const out = parseLrc('[00:01.00]hello   ');
    expect(out).toEqual([{ startMs: 1_000, text: 'hello' }]);
  });

  it('handles colon-as-fraction-separator [mm:ss:xx]', () => {
    const out = parseLrc('[00:12:34]colon');
    expect(out).toEqual([{ startMs: 12_340, text: 'colon' }]);
  });
});
