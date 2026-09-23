import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.config';
import { MusixmatchClient, MusixmatchNotFoundError } from './musixmatch.client';
import { LlmCandidateExtractorService } from './llm-candidate-extractor.service';
import { SerperLookupService } from './serper-lookup.service';
import { MxmTrack } from './dto/musixmatch.dto';

export interface AlternateSearchOutcome {
  /** mxm track found via fallback. null when fallback exhausted. */
  track: MxmTrack | null;
  /** Total mxm matcher.track.get attempts during fallback (for telemetry). */
  attempts: number;
  /** Hint text to expose to admin UI when fallback fails. */
  hintForAdmin: string | null;
}

/**
 * Phase A1d — alternate search fallback.
 *
 * Triggered when the primary `matcher.track.get(originalTitle, originalArtist)`
 * returns 404 and the source title appears non-English (Korean / Japanese).
 * Pipeline:
 *
 *   1. Google search via Serper for "{title} {artist} english romanized title spotify"
 *   2. Send top 5 organic results to OpenRouter Claude Haiku for candidate extraction
 *   3. Try each candidate (up to 3) against mxm matcher.track.get
 *   4. First 200 wins; otherwise return null + admin hint snippet
 *
 * Cost per song (one-time): ~$0.001 Serper + ~$0.001 LLM + 1-3 mxm calls.
 *
 * Failure isolation: every step is best-effort. If Serper or LLM are
 * unconfigured/down, returns track=null and caller marks UNMATCHED.
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 *       Section 11.5
 */
@Injectable()
export class MusixmatchAlternateSearchService {
  private readonly logger = new Logger(MusixmatchAlternateSearchService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly serper: SerperLookupService,
    private readonly llm: LlmCandidateExtractorService,
    private readonly mxm: MusixmatchClient,
    configService: ConfigService<EnvironmentVariables>,
  ) {
    this.enabled =
      configService.get('MUSIXMATCH_ALTERNATE_SEARCH_ENABLED') ?? false;
  }

  isEnabled(): boolean {
    return (
      this.enabled && this.serper.isConfigured() && this.llm.isConfigured()
    );
  }

  /**
   * Whether the source title is likely non-English and worth a Serper+LLM
   * fallback. We skip pure-Latin titles since the primary matcher already
   * handles those well.
   */
  shouldAttempt(title: string, artist: string): boolean {
    if (!this.isEnabled()) return false;
    return this.containsNonLatin(title) || this.containsNonLatin(artist);
  }

  async findAlternate(
    title: string,
    artist: string,
    mode: 'normal' | 'backfill',
  ): Promise<AlternateSearchOutcome> {
    let attempts = 0;
    if (!this.isEnabled()) {
      return { track: null, attempts, hintForAdmin: null };
    }

    // 1. Serper
    const query = `${title} ${artist} english romanized title spotify`;
    const organic = await this.serper.search(query, { topN: 5 });
    if (organic.length === 0) {
      return {
        track: null,
        attempts,
        hintForAdmin: 'Serper: no results',
      };
    }

    // 2. LLM extracts candidates
    const candidates = await this.llm.extractCandidates({
      koreanTitle: title,
      koreanArtist: artist,
      serperResults: organic,
    });
    if (candidates.length === 0) {
      return {
        track: null,
        attempts,
        hintForAdmin: this.summarizeOrganic(organic),
      };
    }

    // 3. Try each candidate against mxm
    for (const cand of candidates) {
      // Skip if candidate is identical to original (already tried by primary)
      if (
        cand.q_track.trim() === title.trim() &&
        cand.q_artist.trim() === artist.trim()
      ) {
        continue;
      }
      attempts++;
      try {
        const result = await this.mxm.matcherTrackGet(
          {
            q_track: cand.q_track,
            q_artist: cand.q_artist,
            f_has_lyrics: 1,
          },
          { mode },
        );
        if (result?.track) {
          this.logger.log(
            `alternate match HIT for "${title}/${artist}" via "${cand.q_track}/${cand.q_artist}" → mxm trackId=${result.track.track_id}`,
          );
          return { track: result.track, attempts, hintForAdmin: null };
        }
      } catch (err) {
        if (err instanceof MusixmatchNotFoundError) continue;
        // Quota/breaker/transport — bubble so caller can decide
        throw err;
      }
    }

    return {
      track: null,
      attempts,
      hintForAdmin: this.summarizeOrganic(organic),
    };
  }

  /** Heuristic: any code point outside basic Latin / digits / common punct. */
  private containsNonLatin(s: string): boolean {
    return /[^\x00-\x7F]/.test(s);
  }

  /** Compact admin-readable summary (up to ~280 chars) of Serper hits. */
  private summarizeOrganic(
    organic: Array<{ title: string; snippet: string }>,
  ): string {
    return organic
      .slice(0, 3)
      .map((o) => o.title)
      .join(' | ')
      .slice(0, 280);
  }
}
