import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CssValidatorService } from './css-validator.service';
import {
  assertProSubscriberAndChannelOwner,
  assertCustomizationViewAccess,
} from './utils/channel-ownership.util';
import { ChannelService } from '../channel.service';
import { channelCacheKeys } from '../cache/channel.cache-keys';
import { channelCustomizationSelect } from './prisma/customization.selections';
import type { ChannelCustomization } from './prisma/customization.selections';
import { toPrismaChannelColorMode } from './constants/color-mode';
import { toPrismaChannelLayoutWidth } from './constants/layout-width';
import { toPrismaChannelHeaderStyle } from './constants/header-style';
import { toPrismaChannelLayoutType } from './constants/layout-type';
import type { UpdateCssDto } from './dto/customization.request.dto';

@Injectable()
export class ChannelCustomizationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly cssValidator: CssValidatorService,
    private readonly channelService: ChannelService,
  ) {}

  /**
   * CSS 조회 (Preview 모드 지원)
   * - 소유자: Pro 구독 여부와 관계없이 조회 가능
   * - 매니저: 채널 소유자가 Pro 구독자일 때만 조회 가능
   *
   * @param channelId 채널 ID
   * @param userId 사용자 ID
   * @returns 채널 커스터마이징 정보 + 권한 정보
   */
  async getCss(
    channelId: number,
    userId: number,
  ): Promise<{
    customization: ChannelCustomization | null;
    isOwner: boolean;
    isOwnerPro: boolean;
  }> {
    // 권한 확인: 소유자는 Pro 없이도 조회 가능
    const { isOwner, isOwnerPro } = await assertCustomizationViewAccess(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );

    const customization = await this.prisma.channelCustomization.findUnique({
      where: { channelId },
      select: channelCustomizationSelect,
    });

    return { customization, isOwner, isOwnerPro };
  }

  /**
   * CSS 저장/수정
   *
   * @param channelId 채널 ID
   * @param userId 사용자 ID
   * @param dto 커스터마이징 업데이트 DTO
   * @returns 저장된 채널 커스터마이징 정보
   */
  async updateCss(
    channelId: number,
    userId: number,
    dto: UpdateCssDto,
  ): Promise<ChannelCustomization> {
    const {
      customCss: css,
      isEnabled: enabled,
      customCssNew: cssNew,
      isEnabledNew: enabledNew,
      layoutType,
      forcedColorMode,
      layoutWidth,
      headerStyle,
    } = dto;

    // 권한 확인: 프로 구독자 + 채널 소유자
    await assertProSubscriberAndChannelOwner(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );

    // CSS가 제공된 경우 검증
    if (css !== undefined) {
      const validation = this.cssValidator.validate(css);
      if (!validation.isValid) {
        throw new BadRequestException({
          message: 'CSS 검증 실패',
          errors: validation.errors,
        });
      }
    }

    // 신규 레이아웃 CSS가 제공된 경우 검증
    if (cssNew !== undefined) {
      const validation = this.cssValidator.validate(cssNew);
      if (!validation.isValid) {
        throw new BadRequestException({
          message: 'CSS 검증 실패',
          errors: validation.errors,
        });
      }
    }

    // 채널 정보 조회 (캐시 키 생성용)
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, webPath: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    // 업데이트 데이터 준비 (변환 결과를 재사용)
    const updateData: {
      customCss?: string | null;
      isEnabled?: boolean;
      customCssNew?: string | null;
      isEnabledNew?: boolean;
      layoutType?: ReturnType<typeof toPrismaChannelLayoutType>;
      forcedColorMode?: ReturnType<typeof toPrismaChannelColorMode>;
      layoutWidth?: ReturnType<typeof toPrismaChannelLayoutWidth>;
      headerStyle?: ReturnType<typeof toPrismaChannelHeaderStyle>;
    } = {};

    if (css !== undefined) {
      updateData.customCss = css || null;
    }

    if (enabled !== undefined) {
      updateData.isEnabled = enabled;
    }

    if (cssNew !== undefined) {
      updateData.customCssNew = cssNew || null;
    }

    if (enabledNew !== undefined) {
      updateData.isEnabledNew = enabledNew;
    }

    if (layoutType !== undefined) {
      updateData.layoutType = toPrismaChannelLayoutType(layoutType);
    }

    if (forcedColorMode !== undefined) {
      updateData.forcedColorMode = toPrismaChannelColorMode(forcedColorMode);
    }

    if (layoutWidth !== undefined) {
      updateData.layoutWidth = toPrismaChannelLayoutWidth(layoutWidth);
    }

    if (headerStyle !== undefined) {
      updateData.headerStyle = toPrismaChannelHeaderStyle(headerStyle);
    }

    // Upsert로 저장/수정
    const customization = await this.prisma.channelCustomization.upsert({
      where: { channelId },
      create: {
        channelId,
        customCss: css || null,
        isEnabled: enabled ?? false,
        ...updateData,
      },
      update: updateData,
      select: channelCustomizationSelect,
    });

    // 캐시 무효화
    await this.invalidateChannelCache(channelId, channel.webPath);

    return customization;
  }

  /**
   * CSS 활성화/비활성화
   *
   * @param channelId 채널 ID
   * @param userId 사용자 ID
   * @param enabled 활성화 여부
   * @returns 업데이트된 채널 커스터마이징 정보
   */
  async toggleEnabled(
    channelId: number,
    userId: number,
    enabled: boolean,
  ): Promise<ChannelCustomization> {
    // 권한 확인: 프로 구독자 + 채널 소유자
    await assertProSubscriberAndChannelOwner(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );

    // 채널 정보 조회 (캐시 키 생성용)
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, webPath: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    // 기존 커스터마이징이 없으면 생성
    const customization = await this.prisma.channelCustomization.upsert({
      where: { channelId },
      create: {
        channelId,
        customCss: null,
        isEnabled: enabled,
      },
      update: {
        isEnabled: enabled,
      },
      select: channelCustomizationSelect,
    });

    // 캐시 무효화
    await this.invalidateChannelCache(channelId, channel.webPath);

    return customization;
  }

  /**
   * CSS 삭제
   *
   * @param channelId 채널 ID
   * @param userId 사용자 ID
   */
  async deleteCss(channelId: number, userId: number): Promise<void> {
    // 권한 확인: 프로 구독자 + 채널 소유자
    await assertProSubscriberAndChannelOwner(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );

    // 채널 정보 조회 (캐시 키 생성용)
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, webPath: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    // 커스터마이징 삭제
    await this.prisma.channelCustomization.delete({
      where: { channelId },
    });

    // 캐시 무효화
    await this.invalidateChannelCache(channelId, channel.webPath);
  }

  /**
   * 채널 캐시 무효화
   *
   * @param channelId 채널 ID
   * @param webPath 채널 주소
   */
  private async invalidateChannelCache(
    channelId: number,
    webPath: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheManager.del(channelCacheKeys.byId(channelId)),
      this.cacheManager.del(channelCacheKeys.byWebPath(webPath)),
    ]);
  }
}
