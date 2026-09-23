import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SongMatcherService } from '../song-request/song-matcher.service';
import { SongbookAddService } from './songbook-add.service';
import { SongMutationService } from '../song/song-mutation.service';
import { CreateSongDto } from '../song/dto/song.dto';

export interface EnsureChannelSongInput {
  channelId: number;
  title: string;
  artist: string;
  /** 신곡 생성 시 기본 카테고리명 (createSongByChannelId 가 category 필수). */
  defaultCategoryName?: string;
}

export interface EnsureChannelSongResult {
  songId: number;
  created: boolean;
}

/**
 * 채널 노래책에 (title, artist) 곡을 GlobalSong 매핑 보장하며 확보한다.
 *
 * 매핑 체인 (실패 시 다음 단계):
 *   1. 채널 노래책 매칭 (SongMatcherService.matchSong) — 있으면 그 songId.
 *   2. GlobalSong 카탈로그 매칭 후 채널 추가 (SongbookAddService.add) —
 *      Song.globalSongId 를 트랜잭션 내 직접 박음 (동기 보장).
 *   3. NO_MATCH/LOW_CONFIDENCE(신곡) — SongMutationService.createSongByChannelId 로
 *      직접 생성. SONG_CREATED 이벤트가 GlobalSongIndexer.indexSong 을 트리거하여
 *      GlobalSong upsert + Song.globalSongId dual-write (매핑 보장).
 *
 * competitor 라인과 (추후) orphan 자동 등록이 공유하는 독립 컴포넌트.
 */
@Injectable()
export class EnsureChannelSongService {
  private readonly logger = new Logger(EnsureChannelSongService.name);

  constructor(
    private readonly matcher: SongMatcherService,
    private readonly adder: SongbookAddService,
    private readonly mutation: SongMutationService,
  ) {}

  async ensure(input: EnsureChannelSongInput): Promise<EnsureChannelSongResult> {
    const { channelId, title, artist } = input;

    // 1) 채널 노래책에 이미 있나
    const matched = await this.matcher.matchSong(channelId, artist, title);
    if (matched?.matched && matched.song) {
      return { songId: matched.song.id, created: false };
    }

    // 2) GlobalSong 카탈로그에 있으면 채널에 추가 (globalSongId 동기 보장)
    try {
      const added = await this.adder.add({
        channelId,
        query: `${artist} ${title}`.trim(),
        requesterUserId: 0,
      });
      return { songId: added.songId, created: true };
    } catch (e) {
      const code = this.errorCode(e);
      if (code === 'ALREADY_IN_SONGBOOK') {
        // pre-check ~ tx 사이 race 또는 matchSong 누락 — 재매칭으로 songId 회수
        const again = await this.matcher.matchSong(channelId, artist, title);
        if (again?.matched && again.song) {
          return { songId: again.song.id, created: false };
        }
        throw e;
      }
      if (code !== 'NO_MATCH' && code !== 'LOW_CONFIDENCE') throw e;
      // 3) 신곡 — GlobalSong 카탈로그에도 없음 → 직접 생성
      return this.createNew(input);
    }
  }

  private errorCode(e: unknown): string | undefined {
    if (e instanceof ConflictException || e instanceof BadRequestException) {
      const r = e.getResponse();
      if (typeof r === 'object' && r && 'code' in r) {
        return (r as { code?: string }).code;
      }
    }
    return undefined;
  }

  private async createNew(
    input: EnsureChannelSongInput,
  ): Promise<EnsureChannelSongResult> {
    // createSongByChannelId 는 category 필수. competitor 곡엔 카테고리 정보가 없으므로
    // 기본 카테고리로 생성 — GlobalSong enrich(SONG_CREATED 이벤트) 후 후속 분류
    // 파이프라인이 보정한다. globalSongId 는 indexSong 이 dual-write 로 보장.
    const dto: CreateSongDto = {
      title: input.title,
      artistName: input.artist,
      categoryNames: [input.defaultCategoryName ?? '기타'],
    };
    const created = await this.mutation.createSongByChannelId(dto, input.channelId);
    this.logger.log(
      `ensure: created new song=${created.id} channel=${input.channelId} "${input.artist} - ${input.title}"`,
    );
    return { songId: created.id, created: true };
  }
}
