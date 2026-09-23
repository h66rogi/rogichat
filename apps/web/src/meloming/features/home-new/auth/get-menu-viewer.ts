// src/features/home-new/auth/get-menu-viewer.ts
import { cache } from 'react';
import { getUserMeServer } from '@/meloming/domains/user/apis/users-server';
import type { MenuViewer } from '../menu/menu-types';
import { ANONYMOUS_VIEWER, toAuthenticatedViewer } from './auth-state';

export type ProfileSummary = {
  nickname: string;
  profileImageUrl: string | null;
};

export const getMenuViewer = cache(async (): Promise<{
  viewer: MenuViewer;
  profile?: ProfileSummary;
}> => {
  const user = await getUserMeServer().catch(() => null);
  if (!user) return { viewer: ANONYMOUS_VIEWER };

  return {
    viewer: toAuthenticatedViewer(user),
    profile: {
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl,
    },
  };
});
