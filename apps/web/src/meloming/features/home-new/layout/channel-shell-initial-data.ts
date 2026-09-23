import type {
  Channel,
  GetChannelIdentifierPermissionResponse,
} from "@/meloming/domains/channel/types/channel";
import type { ChannelFeatureSettings } from "@/meloming/domains/channel/types/channel-tab";
import type { PublicSetlistAvailabilityResponse } from "@/meloming/domains/song-live/types/setlist";

export type ChannelShellInitialData = {
  user: string;
  channel: Channel;
  permission: GetChannelIdentifierPermissionResponse | null;
  featureSettings: ChannelFeatureSettings;
  setlistAvailability: PublicSetlistAvailabilityResponse;
};
