// src/features/home-new/auth/auth-state.ts
import type { MenuViewer } from '../menu/menu-types';
import type { GetUserMeResponse } from '@/meloming/domains/user/types/user';

export function toAuthenticatedViewer(user: GetUserMeResponse): MenuViewer {
  return {
    kind: 'authenticated',
    id: user.id,
    isAdmin: user.isAdmin,
    isAmbassador: user.isAmbassador,
    isProSubscriber: user.isProSubscriber,
  };
}

export const ANONYMOUS_VIEWER: MenuViewer = { kind: 'anonymous' };
export const UNKNOWN_VIEWER: MenuViewer = { kind: 'unknown' };
