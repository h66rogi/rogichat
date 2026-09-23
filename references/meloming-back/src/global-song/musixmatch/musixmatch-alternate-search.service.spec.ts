import { ConfigService } from '@nestjs/config';
import {
  MusixmatchClient,
  MusixmatchNotFoundError,
} from './musixmatch.client';
import { LlmCandidateExtractorService } from './llm-candidate-extractor.service';
import { MusixmatchAlternateSearchService } from './musixmatch-alternate-search.service';
import { SerperLookupService } from './serper-lookup.service';

describe('MusixmatchAlternateSearchService', () => {
  let serper: jest.Mocked<SerperLookupService>;
  let llm: jest.Mocked<LlmCandidateExtractorService>;
  let mxm: jest.Mocked<MusixmatchClient>;
  let svc: MusixmatchAlternateSearchService;

  function build(enabled = true): MusixmatchAlternateSearchService {
    serper = {
      isConfigured: jest.fn().mockReturnValue(true),
      search: jest.fn(),
    } as unknown as jest.Mocked<SerperLookupService>;
    llm = {
      isConfigured: jest.fn().mockReturnValue(true),
      extractCandidates: jest.fn(),
    } as unknown as jest.Mocked<LlmCandidateExtractorService>;
    mxm = {
      matcherTrackGet: jest.fn(),
    } as unknown as jest.Mocked<MusixmatchClient>;

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'MUSIXMATCH_ALTERNATE_SEARCH_ENABLED') return enabled;
        return undefined;
      }),
    } as unknown as ConfigService;

    return new MusixmatchAlternateSearchService(serper, llm, mxm, config);
  }

  describe('shouldAttempt', () => {
    it('returns false when disabled', () => {
      const s = build(false);
      expect(s.shouldAttempt('만찬가', 'tuki.')).toBe(false);
    });

    it('returns true for non-Latin (Korean) title', () => {
      const s = build(true);
      expect(s.shouldAttempt('만찬가', 'tuki.')).toBe(true);
    });

    it('returns true for Japanese kanji title', () => {
      const s = build(true);
      expect(s.shouldAttempt('晩餐歌', 'tuki.')).toBe(true);
    });

    it('returns true when only artist is non-Latin', () => {
      const s = build(true);
      expect(s.shouldAttempt('Through the Night', '아이유')).toBe(true);
    });

    it('returns false for pure-Latin title and artist (already works in primary)', () => {
      const s = build(true);
      expect(s.shouldAttempt('Hello', 'Adele')).toBe(false);
    });

    it('returns false when serper unconfigured', () => {
      const s = build(true);
      serper.isConfigured.mockReturnValue(false);
      expect(s.shouldAttempt('만찬가', 'tuki.')).toBe(false);
    });

    it('returns false when llm unconfigured', () => {
      const s = build(true);
      llm.isConfigured.mockReturnValue(false);
      expect(s.shouldAttempt('만찬가', 'tuki.')).toBe(false);
    });
  });

  describe('findAlternate', () => {
    it('returns null when disabled', async () => {
      const s = build(false);
      const out = await s.findAlternate('만찬가', 'tuki.', 'normal');
      expect(out.track).toBeNull();
      expect(serper.search).not.toHaveBeenCalled();
    });

    it('returns null + Serper-no-results hint when serper empty', async () => {
      const s = build(true);
      serper.search.mockResolvedValue([]);

      const out = await s.findAlternate('만찬가', 'tuki.', 'normal');

      expect(out.track).toBeNull();
      expect(out.hintForAdmin).toContain('Serper');
      expect(llm.extractCandidates).not.toHaveBeenCalled();
    });

    it('returns null + organic title hint when LLM produces 0 candidates', async () => {
      const s = build(true);
      serper.search.mockResolvedValue([
        { title: 'tuki. - 晩餐歌 (Bansanka)', link: 'x', snippet: 'y' },
      ]);
      llm.extractCandidates.mockResolvedValue([]);

      const out = await s.findAlternate('만찬가', 'tuki.', 'normal');

      expect(out.track).toBeNull();
      expect(out.hintForAdmin).toContain('Bansanka');
    });

    it('returns first matching candidate', async () => {
      const s = build(true);
      serper.search.mockResolvedValue([
        { title: 'serper-1', link: 'x', snippet: 'y' },
      ]);
      llm.extractCandidates.mockResolvedValue([
        { q_track: 'Bansanka', q_artist: 'tuki.' },
        { q_track: '晩餐歌', q_artist: 'tuki.' },
      ]);
      // First candidate 404, second hits
      mxm.matcherTrackGet
        .mockRejectedValueOnce(
          new MusixmatchNotFoundError('matcher.track.get', '404'),
        )
        .mockResolvedValueOnce({
          track: {
            track_id: 315791747,
            commontrack_id: 163453793,
            track_name: '晩餐歌',
            artist_name: 'tuki.',
            has_lyrics: 1,
            has_subtitles: 1,
            has_richsync: 1,
            instrumental: 0,
          } as never,
        } as never);

      const out = await s.findAlternate('만찬가', 'tuki.', 'normal');

      expect(out.track).not.toBeNull();
      expect(out.track?.track_id).toBe(315791747);
      expect(out.attempts).toBe(2);
    });

    it('skips candidate identical to original (already tried by primary)', async () => {
      const s = build(true);
      serper.search.mockResolvedValue([
        { title: 'x', link: 'x', snippet: 'x' },
      ]);
      llm.extractCandidates.mockResolvedValue([
        { q_track: '만찬가', q_artist: 'tuki.' }, // same as input — skip
        {
          q_track: '晩餐歌',
          q_artist: 'tuki.',
        },
      ]);
      mxm.matcherTrackGet.mockResolvedValueOnce({
        track: {
          track_id: 1,
          commontrack_id: 1,
          track_name: '晩餐歌',
          artist_name: 'tuki.',
          has_lyrics: 1,
          has_subtitles: 1,
          has_richsync: 1,
          instrumental: 0,
        } as never,
      } as never);

      const out = await s.findAlternate('만찬가', 'tuki.', 'normal');

      expect(out.track).not.toBeNull();
      expect(out.attempts).toBe(1); // identical candidate skipped
    });

    it('returns null + hint when all candidates 404', async () => {
      const s = build(true);
      serper.search.mockResolvedValue([
        { title: 'tuki. live cover', link: 'x', snippet: 'y' },
      ]);
      llm.extractCandidates.mockResolvedValue([
        { q_track: 'Bansanka', q_artist: 'tuki.' },
        { q_track: '晩餐歌', q_artist: 'tuki.' },
      ]);
      mxm.matcherTrackGet.mockRejectedValue(
        new MusixmatchNotFoundError('matcher.track.get', '404'),
      );

      const out = await s.findAlternate('만찬가', 'tuki.', 'normal');

      expect(out.track).toBeNull();
      expect(out.attempts).toBe(2);
      expect(out.hintForAdmin).toContain('cover');
    });

    it('propagates non-404 errors (quota/breaker)', async () => {
      const s = build(true);
      serper.search.mockResolvedValue([
        { title: 'x', link: 'x', snippet: 'y' },
      ]);
      llm.extractCandidates.mockResolvedValue([
        { q_track: 'X', q_artist: 'Y' },
      ]);
      mxm.matcherTrackGet.mockRejectedValue(
        new Error('Quota exceeded'),
      );

      await expect(
        s.findAlternate('만찬가', 'tuki.', 'normal'),
      ).rejects.toThrow('Quota exceeded');
    });
  });
});
