import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DistributedLockModule } from '../../common/distributed-lock/distributed-lock.module';
import { KoreanPronunciationService } from './korean-pronunciation.service';
import { LyricsExtrasBackfillCronService } from './lyrics-extras-backfill-cron.service';
import { LyricsExtrasBackfillService } from './lyrics-extras-backfill.service';
import { LlmCandidateExtractorService } from './llm-candidate-extractor.service';
import { LyricsRetrievalService } from './lyrics-retrieval.service';
import { MusixmatchAlternateSearchService } from './musixmatch-alternate-search.service';
import { MusixmatchBackfillCronService } from './musixmatch-backfill-cron.service';
import { MusixmatchClient } from './musixmatch.client';
import { MusixmatchLyricsService } from './musixmatch-lyrics.service';
import { MusixmatchMatcherService } from './musixmatch-matcher.service';
import { MusixmatchMatchEventListener } from './musixmatch-match-event.listener';
import { MusixmatchQuotaService } from './musixmatch-quota.service';
import { MusixmatchRedisService } from './musixmatch-redis.service';
import { SerperLookupService } from './serper-lookup.service';

/**
 * Musixmatch integration module (Phase A1a + A1b).
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 *
 * Phase A1a: MusixmatchClient + Quota + Redis (low-level + cache + breaker)
 * Phase A1b: Matcher + Lyrics + event listener
 * Phase A1c: admin endpoints (separate PR)
 * Phase B1: LyricsRetrievalService (console/overlay 공통 read layer)
 *           spec: docs/superpowers/specs/2026-04-29-musixmatch-console-lyrics-design.md
 */
@Module({
  imports: [PrismaModule, ConfigModule, DistributedLockModule],
  providers: [
    MusixmatchQuotaService,
    MusixmatchRedisService,
    MusixmatchClient,
    KoreanPronunciationService,
    MusixmatchLyricsService,
    SerperLookupService,
    LlmCandidateExtractorService,
    MusixmatchAlternateSearchService,
    MusixmatchMatcherService,
    MusixmatchMatchEventListener,
    MusixmatchBackfillCronService,
    LyricsExtrasBackfillCronService,
    LyricsExtrasBackfillService,
    LyricsRetrievalService,
  ],
  exports: [
    MusixmatchQuotaService,
    MusixmatchRedisService,
    MusixmatchClient,
    KoreanPronunciationService,
    MusixmatchLyricsService,
    MusixmatchAlternateSearchService,
    MusixmatchMatcherService,
    LyricsExtrasBackfillService,
    LyricsRetrievalService,
  ],
})
export class MusixmatchModule {}
