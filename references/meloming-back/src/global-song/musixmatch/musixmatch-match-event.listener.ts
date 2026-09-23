import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { EnvironmentVariables } from '../../config/env.config';
import {
  GLOBAL_SONG_EVENTS,
  SongIndexedEvent,
} from '../dto/global-song.events';
import { MusixmatchMatcherService } from './musixmatch-matcher.service';

/**
 * Subscribes to GLOBAL_SONG_EVENTS.SONG_INDEXED and triggers Musixmatch
 * matching for the GlobalSong (when feature-flagged on).
 *
 * Failure isolation: every handler wraps in try/catch, errors logged but
 * NEVER propagate. Real-time song create/update flows must not fail because
 * of a Musixmatch outage.
 *
 * Bootstrap exclusion: SONG_INDEXED is only emitted from the indexer's
 * @OnEvent handlers (real-time path). Rebuild/bootstrap calls indexSong()
 * directly without emitting, so 30K bootstrap rows cannot trigger 30K mxm
 * matching attempts.
 */
@Injectable()
export class MusixmatchMatchEventListener {
  private readonly logger = new Logger(MusixmatchMatchEventListener.name);
  private readonly enabled: boolean;

  constructor(
    private readonly matcher: MusixmatchMatcherService,
    configService: ConfigService<EnvironmentVariables>,
  ) {
    this.enabled = configService.get('MUSIXMATCH_EVENT_EMIT_ENABLED') ?? false;
  }

  @OnEvent(GLOBAL_SONG_EVENTS.SONG_INDEXED, { async: true })
  async handleSongIndexed(event: SongIndexedEvent): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.matcher.maybeMatch(event.globalSongId, 'normal');
    } catch (error) {
      this.logger.error(
        `mxm match listener failed for globalSongId=${event.globalSongId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
