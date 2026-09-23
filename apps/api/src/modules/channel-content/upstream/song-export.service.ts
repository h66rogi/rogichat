import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';

export interface SongExportRow {
  title: string;
  artistName: string;
  categoryNames: string;
  difficulty: number | null;
  proficiency: number | null;
}

export interface SongExportResult {
  csv: string;
  songCount: number;
  channelName: string;
}

export class SongExportService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  /**
   * 채널의 모든 노래를 CSV 형식으로 export
   * - 노래가 1곡 이상 있어야 다운로드 가능
   */
  async exportSongsAsCsv(
    channelId: string,
    channelName: string,
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SongExportResult> {
    // 2. 노래 조회
    const songs = await this.prisma.song.findMany({
      where: { channelId },
      select: {
        title: true, difficulty: true, proficiency: true,
        artist: { select: { name: true } },
        songCategories: {
          select: {
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. 노래가 1곡 이상인지 확인
    if (songs.length === 0) {
      await this.logExportAttempt(userId, channelId, 0, ipAddress, userAgent);
      throw new BadRequestException(
        '다운로드할 노래가 없습니다. 노래를 먼저 추가해주세요.',
      );
    }

    // 4. CSV 생성
    const rows: SongExportRow[] = songs.map((song) => ({
      title: song.title,
      artistName: song.artist?.name || '',
      categoryNames: song.songCategories
        .map((sc) => sc.category?.name || '')
        .filter(Boolean)
        .join(', '),
      difficulty: song.difficulty,
      proficiency: song.proficiency,
    }));

    const csv = this.generateCsv(rows);

    // 5. 다운로드 로그 기록
    await this.logExportAttempt(
      userId,
      channelId,
      songs.length,
      ipAddress,
      userAgent,
    );

    return {
      csv,
      songCount: songs.length,
      channelName,
    };
  }

  /**
   * CSV 문자열 생성
   * - 카테고리명에 쉼표가 있어도 CSV 형식에 문제가 없도록 쌍따옴표로 감싸기
   */
  private generateCsv(rows: SongExportRow[]): string {
    const header = ['노래', '가수', '카테고리', '난이도', '숙련도'];
    const disclaimer =
      'CSV 다운로드를 통해 다운받은 자료는 개인 데이터 보관 목적에 한해 제공됩니다';
    const lines: string[] = [
      [...header, '', this.escapeCsvField(disclaimer)].join(','),
    ];

    for (const row of rows) {
      const escapedTitle = this.escapeCsvField(row.title);
      const escapedArtist = this.escapeCsvField(row.artistName);
      const escapedCategories = this.escapeCsvField(row.categoryNames);
      const difficulty = row.difficulty ?? '';
      const proficiency = row.proficiency ?? '';

      lines.push(
        `${escapedTitle},${escapedArtist},${escapedCategories},${difficulty},${proficiency}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * CSV 필드 이스케이프
   * - 쉼표, 쌍따옴표, 줄바꿈이 포함된 경우 쌍따옴표로 감싸기
   * - 쌍따옴표는 두 개로 이스케이프
   */
  private escapeCsvField(field: string): string {
    if (!field) return '';

    // 쌍따옴표, 쉼표, 줄바꿈이 포함되어 있으면 이스케이프 필요
    const needsEscape =
      field.includes('"') || field.includes(',') || field.includes('\n');

    if (needsEscape) {
      // 쌍따옴표를 두 개로 이스케이프
      const escaped = field.replace(/"/g, '""');
      return `"${escaped}"`;
    }

    return field;
  }

  /**
   * 다운로드 시도 로그 기록
   */
  private async logExportAttempt(
    userId: string,
    channelId: string,
    songCount: number,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.prisma.songExportLog.create({
      data: {
        id: await nextChannelContentId(this.prisma),
        userId,
        channelId,
        songCount,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });
  }
}
