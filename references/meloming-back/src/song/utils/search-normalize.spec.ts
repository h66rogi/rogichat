import { normalizeForSearch, escapeForLike } from './search-normalize';

describe('normalizeForSearch', () => {
  it('returns empty string for null / undefined / non-string input', () => {
    expect(normalizeForSearch(null)).toBe('');
    expect(normalizeForSearch(undefined)).toBe('');
    expect(normalizeForSearch(123 as unknown as string)).toBe('');
  });

  it('lowercases Latin characters', () => {
    expect(normalizeForSearch('Twinkle Star')).toBe('twinklestar');
    expect(normalizeForSearch('IU')).toBe('iu');
  });

  it('removes ASCII whitespace (space, tab, newline)', () => {
    expect(normalizeForSearch('좋은 날')).toBe('좋은날');
    expect(normalizeForSearch('좋\t은\n날')).toBe('좋은날');
    expect(normalizeForSearch('  hello  world  ')).toBe('helloworld');
  });

  it('removes non-ASCII whitespace (NBSP, ideographic, ZWSP, BOM)', () => {
    expect(normalizeForSearch('좋은' + ' ' + '날')).toBe('좋은날');
    expect(normalizeForSearch('좋은' + '　' + '날')).toBe('좋은날');
    expect(normalizeForSearch('좋은' + '​' + '날')).toBe('좋은날');
    expect(normalizeForSearch('﻿' + '좋은 날')).toBe('좋은날');
  });

  it('applies NFKC compatibility normalization (fullwidth -> halfwidth)', () => {
    expect(normalizeForSearch('ＩＵ')).toBe('iu');
    expect(normalizeForSearch('Ｂｏｏｍｂａｙａｈ')).toBe('boombayah');
  });

  it('NFKC folds compatibility forms into base form', () => {
    expect(normalizeForSearch('Ⅸ')).toBe('ix');
    expect(normalizeForSearch('㎏')).toBe('kg');
  });

  it('preserves precomposed Hangul syllables (no decomposition)', () => {
    const out = normalizeForSearch('좋은');
    expect(out).toBe('좋은');
    expect(out.length).toBe(2);
  });

  it('combines decomposed combining marks back into precomposed form', () => {
    const precomposed = 'café';
    const decomposed = 'cafe' + '́';
    expect(normalizeForSearch(precomposed)).toBe('café');
    expect(normalizeForSearch(decomposed)).toBe('café');
    expect(normalizeForSearch(precomposed)).toBe(normalizeForSearch(decomposed));
  });

  it('preserves punctuation and symbols (only whitespace + case is normalized)', () => {
    expect(normalizeForSearch('Hello, World!')).toBe('hello,world!');
    expect(normalizeForSearch('아이유 - 좋은 날')).toBe('아이유-좋은날');
  });

  it('preserves LIKE wildcard chars unchanged (escape is a separate step)', () => {
    expect(normalizeForSearch('10% off')).toBe('10%off');
    expect(normalizeForSearch('a_b c')).toBe('a_bc');
    expect(normalizeForSearch('path\\to\\song')).toBe('path\\to\\song');
  });

  it('treats different spacing of the same query as identical', () => {
    const variants = [
      '좋은 날',
      '좋은날',
      ' 좋 은  날 ',
      '좋은' + '　' + '날',
    ];
    const normalized = variants.map(normalizeForSearch);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('좋은날');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeForSearch('   ')).toBe('');
    expect(normalizeForSearch('　' + ' ')).toBe('');
  });

  it('truncates result to 255 chars to match column length', () => {
    const long = 'a'.repeat(300);
    const out = normalizeForSearch(long);
    expect(out.length).toBe(255);
    expect(out).toBe('a'.repeat(255));
  });

  it('does not split surrogate pairs when slicing at 255 code points', () => {
    // U+1D300 (TETRAGRAM FOR THE CREATIVE) is an astral plane char that
    // occupies 2 UTF-16 code units. 300 copies = 600 code units.
    const astral = String.fromCodePoint(0x1D300);
    const long = astral.repeat(300);
    const out = normalizeForSearch(long);
    // Should be 255 code points (=510 UTF-16 code units), not 255 code units.
    expect(Array.from(out).length).toBe(255);
    // Last code point must be the astral char intact, not a lone surrogate.
    const lastCp = Array.from(out).pop()!;
    expect(lastCp.codePointAt(0)).toBe(0x1D300);
  });
});

describe('escapeForLike', () => {
  it('escapes backslash, percent, underscore for MySQL LIKE', () => {
    expect(escapeForLike('100%')).toBe('100\\%');
    expect(escapeForLike('foo_bar')).toBe('foo\\_bar');
    expect(escapeForLike('a\\b')).toBe('a\\\\b');
    expect(escapeForLike('%a_b\\c%')).toBe('\\%a\\_b\\\\c\\%');
  });

  it('passes through normal text unchanged', () => {
    expect(escapeForLike('좋은날')).toBe('좋은날');
    expect(escapeForLike('twinklestar')).toBe('twinklestar');
    expect(escapeForLike('')).toBe('');
  });
});
