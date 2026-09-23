// src/features/home-new/menu/menu-types.ts
import type { LucideIcon } from 'lucide-react';

export type MenuViewer =
  | { kind: 'anonymous' }
  | { kind: 'unknown' }
  | {
      kind: 'authenticated';
      id: number; // GetUserMeResponse.id
      isAdmin: boolean;
      isAmbassador: boolean;
      isProSubscriber: boolean;
    };

/** 메뉴 항목 옆에 붙는 뱃지 종류. 여러 개 동시 노출 가능 */
export type MenuBadge = 'new' | 'update';

type MenuItemBase = {
  id: string;
  label: string;
  icon: LucideIcon;
  order: number;
  visibility?: (viewer: MenuViewer) => boolean;
  /** 여러 뱃지를 순서대로 노출 (ex. ['new'] / ['update', 'new']) */
  badges?: MenuBadge[];
};

export type MenuRouteItem = MenuItemBase & {
  kind: 'route';
  href: string;
  external?: boolean;
};

/** 접었다 펼치는 그룹. children에는 route 아이템만 (중첩 금지) */
export type MenuGroupItem = MenuItemBase & {
  kind: 'group';
  children: MenuRouteItem[];
};

export type MenuItem = MenuRouteItem | MenuGroupItem;
