// Adapted by copying mutation methods from meloming-back a91393b2
// src/artist/artist.service.ts. Rogichat maps Channel int to its room UUID.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';
import { normalizeForSearch } from './search-normalize.js';

export interface ArtistDto { name: string }
export class ArtistService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async createArtistByChannelId(
    createArtistDto: ArtistDto,
    channelId: string,
  ) {
    await this.assertUniqueArtistNameInChannel(createArtistDto.name, channelId);

    const newArtist = await this.prisma.artist.create({
      data: {
        id: await nextChannelContentId(this.prisma),
        ...createArtistDto,
        nameSearchable: normalizeForSearch(createArtistDto.name),
        channelId: channelId,
      },
    });

    return newArtist;
  }


  async updateArtistByChannelId(
    artistId: number,
    updateArtistDto: ArtistDto,
    channelId: string,
  ) {
    if (updateArtistDto.name && updateArtistDto.name.trim() !== '') {
      await this.assertUniqueArtistNameInChannel(
        updateArtistDto.name,
        channelId,
        artistId,
      );
    }

    let updatedArtist;
    try {
      updatedArtist = await this.prisma.artist.update({
        where: {
          id: artistId,
          channelId: channelId,
        },
        data: {
          ...updateArtistDto,
          ...(updateArtistDto.name !== undefined && {
            nameSearchable: normalizeForSearch(updateArtistDto.name),
          }),
        },
      });
    } catch (error) {
      // P2025 (record not found) 만 NotFound 로 매핑. 그 외 (P2002 unique
      // 위반 / Lock wait / connection drop 등) 는 silent NotFound 로 가리지 않고
      // 그대로 throw — deleteArtistByChannelId 의 정석 패턴과 정렬.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(
          '가수를 찾을 수 없거나 수정 권한이 없습니다.',
        );
      }
      throw error;
    }

    return updatedArtist;
  }


  async deleteArtistByChannelId(artistId: number, channelId: string) {
    // The original service deletes attached songs in one transaction. Rogichat
    // has restrictive FKs and no GlobalSong index, so remove current dependent
    // rows explicitly inside the caller's owner-locked transaction.
    try {
      await this.prisma.$queryRaw`SELECT id FROM artists WHERE id = ${artistId} AND channel_id = ${channelId} FOR UPDATE`;
      const songs = await this.prisma.song.findMany({ where: { artistId, channelId }, select: { id: true } });
      const songIds = songs.map(song => song.id);
      if (songIds.length) {
        await this.prisma.userSongLike.deleteMany({ where: { songId: { in: songIds } } });
        await this.prisma.songCategory.deleteMany({ where: { songId: { in: songIds } } });
        await this.prisma.songVideoPreference.deleteMany({ where: { songId: { in: songIds } } });
        await this.prisma.songSheetMusic.deleteMany({ where: { songId: { in: songIds } } });
        await this.prisma.song.deleteMany({ where: { id: { in: songIds }, channelId } });
      }
      await this.prisma.artist.delete({ where: { id: artistId, channelId } });
    } catch (error) {
      // P2025 = "An operation failed because it depends on one or more records
      // that were required but not found." Other errors (lock wait timeout,
      // deadlock, FK violation) must surface for observability — silently
      // mapping them to 404 hides real DB failures.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(
          '가수를 찾을 수 없거나 삭제 권한이 없습니다.',
        );
      }
      throw error;
    }

    return { message: '가수가 삭제되었습니다.' };
  }


  private async assertUniqueArtistNameInChannel(
    name: string,
    channelId: string,
    excludeArtistId?: number,
  ): Promise<void> {
    const trimmedName = name?.trim();
    if (!trimmedName) return;

    // Prisma cannot express the source's LOWER/REPLACE normalized name rule.
    const dup = (
      await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id
      FROM artists
      WHERE channel_id = ${channelId}
        AND REPLACE(LOWER(name), ' ', '') = REPLACE(LOWER(${trimmedName}), ' ', '')
      LIMIT 1
    `
    )[0];

    if (dup && (!excludeArtistId || dup.id !== excludeArtistId)) {
      throw new BadRequestException('이미 존재하는 아티스트 이름입니다.');
    }
  }
}
