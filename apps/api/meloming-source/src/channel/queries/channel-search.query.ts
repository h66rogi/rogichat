import { PrismaService } from '../../prisma/prisma.service';

export type ChannelSearchRow = {
  id: number;
  name: string;
  webPath: string;
  platformUrl: string | null;
  topBannerUrl: string | null;
  profileImageUrl: string | null;
  themeColor: string;
  channelDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
  relevanceScore: number;
  isVerified: boolean;
};

export class ChannelSearchQuery {
  constructor(private readonly prisma: PrismaService) {}

  async search(params: {
    keyword: string;
    page: number;
    limit: number;
  }): Promise<{ rows: ChannelSearchRow[]; total: number }> {
    const { keyword, page, limit } = params;
    const offset = (page - 1) * limit;
    const normalizedKeyword = keyword.toLowerCase();
    const likeKeyword = `%${normalizedKeyword}%`;

    // EXISTS subquery 로 isVerified 산출. 과거 LEFT JOIN channel_verifications 패턴은
    // 1 채널 × N verifications(플랫폼별) fanout 으로 검색 결과 중복 발생 (2026-05-12 발견).
    const rows = await this.prisma.$queryRaw<ChannelSearchRow[]>`
      SELECT
        c.id,
        c.name,
        c.web_path as webPath,
        c.platform_url as platformUrl,
        c.top_banner_url as topBannerUrl,
        c.profile_image_url as profileImageUrl,
        c.theme_color as themeColor,
        c.channel_description as channelDescription,
        c.created_at as createdAt,
        c.updated_at as updatedAt,
        CAST(
          CASE
            WHEN LOWER(c.name) = ${normalizedKeyword} THEN 100
            WHEN LOWER(c.web_path) = ${normalizedKeyword} THEN 95
            WHEN LOWER(c.name) LIKE ${`${normalizedKeyword}%`} THEN 90
            WHEN c.platform_url LIKE '%sooplive.co.kr%' AND
                 LOWER(SUBSTRING(c.platform_url, LOCATE('/kr/', c.platform_url) + 4)) LIKE ${likeKeyword} THEN 90
            WHEN LOWER(c.web_path) LIKE ${`${normalizedKeyword}%`} THEN 85
            WHEN LOWER(c.name) LIKE ${likeKeyword} THEN 80
            WHEN LOWER(c.web_path) LIKE ${likeKeyword} THEN 75
            WHEN c.platform_url IS NOT NULL AND c.platform_url != '' AND
                 LOWER(c.platform_url) LIKE ${likeKeyword} THEN 60
            ELSE 0
          END AS UNSIGNED
        ) as relevanceScore,
        CASE WHEN EXISTS (
          SELECT 1 FROM channel_verifications cv
          WHERE cv.channel_id = c.id AND cv.status = 'approved'
        ) THEN TRUE ELSE FALSE END as isVerified
      FROM channels c
      WHERE
        c.visibility = 'PUBLIC' AND (
        LOWER(c.name) LIKE ${likeKeyword} OR
        LOWER(c.web_path) LIKE ${likeKeyword} OR
        (c.platform_url LIKE '%sooplive.co.kr%' AND
         LOWER(SUBSTRING(c.platform_url, LOCATE('/kr/', c.platform_url) + 4)) LIKE ${likeKeyword}) OR
        (c.platform_url IS NOT NULL AND c.platform_url != '' AND
         LOWER(c.platform_url) LIKE ${likeKeyword}))
      ORDER BY relevanceScore DESC, c.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalResult = await this.prisma.$queryRaw<[{ total: number }]>`
      SELECT CAST(COUNT(*) AS SIGNED) as total
      FROM channels
      WHERE
        visibility = 'PUBLIC' AND (
        LOWER(name) LIKE ${likeKeyword} OR
        LOWER(web_path) LIKE ${likeKeyword} OR
        (platform_url LIKE '%sooplive.co.kr%' AND
         LOWER(SUBSTRING(platform_url, LOCATE('/kr/', platform_url) + 4)) LIKE ${likeKeyword}) OR
        (platform_url IS NOT NULL AND platform_url != '' AND
         LOWER(platform_url) LIKE ${likeKeyword}))
    `;

    const total = Number(totalResult[0].total);
    return { rows, total };
  }
}
