import {
  ChannelCustomizationResponseDto,
  ChannelCustomizationWithAccessResponseDto,
} from '../dto/customization.response.dto';
import { toChannelColorModeValue } from '../constants/color-mode';
import { toChannelLayoutWidthValue } from '../constants/layout-width';
import { toChannelHeaderStyleValue } from '../constants/header-style';
import { toChannelLayoutTypeValue } from '../constants/layout-type';
import type { ChannelCustomization } from '../prisma/customization.selections';

/**
 * ChannelCustomization 엔티티를 Response DTO로 변환
 *
 * @param customization 채널 커스터마이징 엔티티
 * @returns 채널 커스터마이징 응답 DTO
 */
export function toChannelCustomizationResponseDto(
  customization: ChannelCustomization,
): ChannelCustomizationResponseDto {
  return {
    id: customization.id,
    channelId: customization.channelId,
    customCss: customization.customCss ?? null,
    isEnabled: customization.isEnabled,
    customCssNew: customization.customCssNew ?? null,
    isEnabledNew: customization.isEnabledNew,
    layoutType: toChannelLayoutTypeValue(customization.layoutType),
    forcedColorMode: toChannelColorModeValue(customization.forcedColorMode),
    layoutWidth: toChannelLayoutWidthValue(customization.layoutWidth),
    headerStyle: toChannelHeaderStyleValue(customization.headerStyle),
    createdAt: customization.createdAt,
    updatedAt: customization.updatedAt,
  };
}

/**
 * ChannelCustomization + 권한 정보를 Response DTO로 변환
 *
 * @param data 커스터마이징 + 권한 정보
 * @returns 권한 정보 포함 응답 DTO
 */
export function toChannelCustomizationWithAccessResponseDto(data: {
  customization: ChannelCustomization | null;
  isOwner: boolean;
  isOwnerPro: boolean;
}): ChannelCustomizationWithAccessResponseDto {
  return {
    customization: data.customization
      ? toChannelCustomizationResponseDto(data.customization)
      : null,
    isOwner: data.isOwner,
    isOwnerPro: data.isOwnerPro,
    canSave: data.isOwnerPro,
  };
}
