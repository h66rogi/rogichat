// Adapted by copying Meloming a91393b2 src/song/song-helper.service.ts
// category creation methods used when approving a song registration request.
import type { Prisma } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';

export class SongHelperService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}
  private readonly DEFAULT_COLORS = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#96CEB4',
    '#FFEAA7',
    '#DDA0DD',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E9',
    '#F8C471',
    '#82E0AA',
    '#F1948A',
    '#85C1E9',
    '#D7BDE2',
  ];

  normalizeCategoryName(name: string): string {
    return name.normalize('NFKC').trim().toLowerCase();
  }

  /**
   * Excel bulk import 시 서로 다른 케이스/공백을 가진 카테고리를 하나로
   * 묶기 위해 케이스-비민감 맵을 생성한다.
   */
  buildUniqueCategoryNameMap(categoryNames: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const rawName of categoryNames) {
      if (typeof rawName !== 'string') continue;
      const trimmed = rawName.trim();
      if (!trimmed) continue;
      const normalized = this.normalizeCategoryName(trimmed);
      if (!map.has(normalized)) {
        map.set(normalized, trimmed);
      }
    }
    return map;
  }
  async createNewCategoriesByChannel(
    categoryNames: string[],
    channelId: string,
  ): Promise<number[]> {
    const distinctNameMap = this.buildUniqueCategoryNameMap(categoryNames);
    if (distinctNameMap.size === 0) {
      return [];
    }

    const distinctNames = [...distinctNameMap.values()];
    // MySQL에서는 mode: 'insensitive'를 지원하지 않으므로
    // 입력된 이름들을 정규화하여 비교 가능한 형태로 변환
    const normalizedInputNames = distinctNames.map((name) =>
      this.normalizeCategoryName(name),
    );

    // 해당 채널의 모든 카테고리를 가져온 후 애플리케이션 레벨에서 비교
    // (channelId에 인덱스가 있어 쿼리 자체는 효율적)
    const existing =
      distinctNames.length > 0
        ? await this.prisma.category.findMany({
            where: { channelId },
            select: { id: true, name: true },
          })
        : [];

    // 정규화된 이름으로 매핑 생성
    const existingNameToId = new Map(
      existing
        .map((c) => ({
          normalized: this.normalizeCategoryName(c.name),
          id: c.id,
        }))
        .filter((c) => normalizedInputNames.includes(c.normalized))
        .map((c) => [c.normalized, c.id]),
    );
    // distinctNameMap의 normalized 키와 비교하여 중복 확인
    const namesToCreate = [...distinctNameMap.entries()]
      .filter(([normalized]) => !existingNameToId.has(normalized))
      .map(([, displayName]) => displayName);
    // The source can create in parallel because MySQL allocates its IDs.
    // Rogichat's shared numeric counter needs each increment/read pair ordered.
    const created: Array<{ id: number }> = [];
    for (const [index, name] of namesToCreate.entries()) {
      created.push(await this.prisma.category.create({
        data: {
          id: await nextChannelContentId(this.prisma),
          name,
          color: this.DEFAULT_COLORS[index % this.DEFAULT_COLORS.length]!,
          channelId,
        },
        select: { id: true },
      }));
    }

    // 입력된 이름과 매칭된 기존 카테고리 ID만 포함
    const existingIds = Array.from(existingNameToId.values());
    const createdIds = created.map((c) => c.id);
    const allIds = [...new Set([...existingIds, ...createdIds])];
    return allIds;
  }
}
