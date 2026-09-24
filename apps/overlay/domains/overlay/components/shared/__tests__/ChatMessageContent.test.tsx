/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { buildSegments } from '../ChatMessageContent';
import type { SoopEmoticonCatalog } from '../../../data/soop-emoticons';

describe('buildSegments — chzzk', () => {
  it('returns plain text when there are no tokens', () => {
    const segs = buildSegments('안녕하세요', 'chzzk', undefined, null);
    expect(segs).toEqual([{ kind: 'text', text: '안녕하세요' }]);
  });

  it('renders an emote when the inline map provides a URL', () => {
    const segs = buildSegments(
      '안녕 {:d_67:} 잘가',
      'chzzk',
      [
        {
          code: 'd_67',
          start: 3,
          end: 11,
          imageUrl: 'https://e/x/d_67.png',
          source: 'chzzk:inline',
        },
      ],
      null,
    );
    expect(segs).toEqual([
      { kind: 'text', text: '안녕 ' },
      {
        kind: 'emote',
        code: 'd_67',
        url: 'https://e/x/d_67.png',
        alt: '{:d_67:}',
        animated: false,
      },
      { kind: 'text', text: ' 잘가' },
    ]);
  });

  it('falls back to text when the inline map is missing the code', () => {
    const segs = buildSegments(
      '{:unknown:}',
      'chzzk',
      [],
      null,
    );
    expect(segs).toEqual([{ kind: 'text', text: '{:unknown:}' }]);
  });

  it('handles multiple tokens in order', () => {
    const segs = buildSegments(
      '{:a:}{:b:}{:a:}',
      'chzzk',
      [
        { code: 'a', start: 0, end: 0, imageUrl: 'https://e/a' },
        { code: 'b', start: 0, end: 0, imageUrl: 'https://e/b' },
      ],
      null,
    );
    expect(segs.map((s) => s.kind)).toEqual(['emote', 'emote', 'emote']);
  });
});

describe('buildSegments — cime', () => {
  it('renders cime tokens via inline map', () => {
    const segs = buildSegments(
      '안녕 :LG-clap: 좋아',
      'cime',
      [{ code: 'LG-clap', start: 0, end: 0, imageUrl: 'https://e/lg-clap.webp' }],
      null,
    );
    expect(segs[0]).toEqual({ kind: 'text', text: '안녕 ' });
    expect(segs[1].kind).toBe('emote');
    if (segs[1].kind === 'emote') {
      expect(segs[1].url).toBe('https://e/lg-clap.webp');
      expect(segs[1].alt).toBe(':LG-clap:');
    }
    expect(segs[2]).toEqual({ kind: 'text', text: ' 좋아' });
  });

  it('does not match colon punctuation without an entry in the inline map', () => {
    const segs = buildSegments(
      '안녕: 잘가',
      'cime',
      [],
      null,
    );
    expect(segs).toEqual([{ kind: 'text', text: '안녕: 잘가' }]);
  });
});

describe('buildSegments — soop', () => {
  const catalog: SoopEmoticonCatalog = {
    smallUrl: 'https://res.sooplive.com/images/chat/emoticon/small/',
    bigUrl: 'https://res.sooplive.com/images/chat/emoticon/big/',
    byKeyword: new Map([
      [
        '/응원봉/',
        { keyword: '/응원봉/', fileName: '1.png', version: 2 },
      ],
      [
        '/응원1_s/',
        {
          keyword: '/응원1_s/',
          fileName: '225.webp',
          staticFileName: '225.png',
          version: 2,
        },
      ],
    ]),
  };

  it('resolves SOOP tokens from the global catalog', () => {
    const segs = buildSegments(
      '/응원봉//응원봉/ 가자',
      'soop',
      undefined,
      catalog,
    );
    expect(segs.length).toBe(3);
    expect(segs[0].kind).toBe('emote');
    expect(segs[1].kind).toBe('emote');
    expect(segs[2]).toEqual({ kind: 'text', text: ' 가자' });
    if (segs[0].kind === 'emote') {
      expect(segs[0].url).toBe(
        'https://res.sooplive.com/images/chat/emoticon/small/1.png?v=2',
      );
    }
  });

  it('leaves unknown SOOP tokens as plain text', () => {
    const segs = buildSegments('/존재안함/', 'soop', undefined, catalog);
    expect(segs).toEqual([{ kind: 'text', text: '/존재안함/' }]);
  });

  it('falls back to plain text when no catalog is loaded yet', () => {
    const segs = buildSegments('/응원봉/', 'soop', undefined, null);
    expect(segs).toEqual([{ kind: 'text', text: '/응원봉/' }]);
  });
});
