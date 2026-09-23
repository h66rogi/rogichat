import { ChannelGlobalProfile } from '@prisma/client';
import { ChannelGlobalProfileResponseDto } from '../dto/channel-global-profile.dto';

export function toGlobalProfileResponseDto(
  row: ChannelGlobalProfile | null,
  channelId: number,
): ChannelGlobalProfileResponseDto {
  if (!row) {
    // opt-out 모델: row 가 없는 채널은 기본 노출.
    return {
      channelId,
      globalEnabled: true,
      globalName: null,
      globalDescription: null,
      globalProfileImageUrl: null,
      primaryLocale: null,
    };
  }
  return {
    channelId: row.channelId,
    globalEnabled: row.globalEnabled,
    globalName: row.globalName,
    globalDescription: row.globalDescription,
    globalProfileImageUrl: row.globalProfileImageUrl,
    primaryLocale: row.primaryLocale,
  };
}
