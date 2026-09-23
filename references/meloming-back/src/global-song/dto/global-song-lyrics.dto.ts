import {
  ConsoleLyricsBodyDto,
  ConsoleLyricsGlobalSongDto,
  ConsoleLyricsStatus,
} from '../../console-api/dto/console-lyrics.dto';

export type GlobalSongLyricsStatus = Exclude<
  ConsoleLyricsStatus,
  'UNLINKED' | 'QUOTA_EXCEEDED'
>;

export class GlobalSongLyricsResponseDto {
  status!: GlobalSongLyricsStatus;
  globalSong!: ConsoleLyricsGlobalSongDto;
  lyrics?: ConsoleLyricsBodyDto;
  mergedFrom!: number | null;
}
