import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EnsureChannelSongService } from './ensure-channel-song.service';
import { SongMatcherService } from '../song-request/song-matcher.service';
import { SongbookAddService } from './songbook-add.service';
import { SongMutationService } from '../song/song-mutation.service';

describe('EnsureChannelSongService', () => {
  let svc: EnsureChannelSongService;
  const matcher = { matchSong: jest.fn() };
  const adder = { add: jest.fn() };
  const mutation = { createSongByChannelId: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        EnsureChannelSongService,
        { provide: SongMatcherService, useValue: matcher },
        { provide: SongbookAddService, useValue: adder },
        { provide: SongMutationService, useValue: mutation },
      ],
    }).compile();
    svc = mod.get(EnsureChannelSongService);
  });

  it('returns existing songId when channel songbook already has it', async () => {
    matcher.matchSong.mockResolvedValue({ matched: true, song: { id: 111 } });
    const r = await svc.ensure({ channelId: 1, title: 'U R', artist: '태연' });
    expect(r).toEqual({ songId: 111, created: false });
    expect(adder.add).not.toHaveBeenCalled();
  });

  it('adds from global catalog when not in channel but catalog matches', async () => {
    matcher.matchSong.mockResolvedValue({ matched: false });
    adder.add.mockResolvedValue({
      songId: 222,
      globalSongId: 9,
      title: 'U R',
      artistName: '태연',
    });
    const r = await svc.ensure({ channelId: 1, title: 'U R', artist: '태연' });
    expect(r).toEqual({ songId: 222, created: true });
    expect(adder.add).toHaveBeenCalledWith({
      channelId: 1,
      query: '태연 U R',
      requesterUserId: 0,
    });
  });

  it('creates a brand-new song (not in global catalog) so SONG_CREATED guarantees GlobalSong mapping', async () => {
    matcher.matchSong.mockResolvedValue({ matched: false });
    adder.add.mockRejectedValue(new BadRequestException({ code: 'NO_MATCH' }));
    mutation.createSongByChannelId.mockResolvedValue({ id: 333 });
    const r = await svc.ensure({
      channelId: 1,
      title: '신곡',
      artist: '신인',
      defaultCategoryName: '기타',
    });
    expect(r).toEqual({ songId: 333, created: true });
    expect(mutation.createSongByChannelId).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '신곡',
        artistName: '신인',
        categoryNames: ['기타'],
      }),
      1,
    );
  });

  it('recovers songId via re-match when add reports ALREADY_IN_SONGBOOK (race)', async () => {
    matcher.matchSong
      .mockResolvedValueOnce({ matched: false })
      .mockResolvedValueOnce({ matched: true, song: { id: 444 } });
    adder.add.mockRejectedValue(
      new ConflictException({ code: 'ALREADY_IN_SONGBOOK', title: 'x', artistName: 'y' }),
    );
    const r = await svc.ensure({ channelId: 1, title: 'x', artist: 'y' });
    expect(r).toEqual({ songId: 444, created: false });
    expect(mutation.createSongByChannelId).not.toHaveBeenCalled();
  });
});
