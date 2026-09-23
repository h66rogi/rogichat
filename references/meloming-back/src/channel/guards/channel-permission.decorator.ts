import { SetMetadata } from '@nestjs/common';

export type ChannelPermissionScope =
  | 'content'
  | 'settings'
  | 'profile'
  | 'guestbook'
  | 'customization'
  | 'emoticons'
  | 'overlay';

export const CHANNEL_PERMISSION_SCOPE_KEY = 'channel_permission_scope';

export const ChannelPermission = (scope: ChannelPermissionScope) =>
  SetMetadata(CHANNEL_PERMISSION_SCOPE_KEY, scope);
