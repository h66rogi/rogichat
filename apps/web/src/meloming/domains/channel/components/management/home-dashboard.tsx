"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  ListOrdered,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import {
  useChannel,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import { useUserArtists } from "@/meloming/domains/channel/hooks/use-artists";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import { useChannelFavoritesCount } from "@/meloming/domains/channel/hooks/use-favorites";
import { usePublicUserSongs } from "@/meloming/domains/channel/hooks/use-songs";
import type { GetChannelIdentifierPermissionResponse } from "@/meloming/domains/channel/types/channel";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  MANAGEMENT_GROUPS,
  MANAGEMENT_MENU_ITEMS,
  type ManagementGroup,
  type ManagementMenuItem,
  type ManagementSection,
} from "./types";

type DashboardGroup = {
  group: ManagementGroup;
  description: string;
  icon: LucideIcon;
};

const DASHBOARD_GROUPS: DashboardGroup[] = [
  {
    group: MANAGEMENT_GROUPS.SONGBOOK,
    description: "노래책에 들어갈 곡과 분류, 팬의 등록 요청을 관리합니다.",
    icon: BookOpen,
  },
  {
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
    description: "신청곡 설정과 지난 방송 기록을 관리합니다.",
    icon: ListOrdered,
  },
  {
    group: MANAGEMENT_GROUPS.CONTENT,
    description: "방송 일정과 셋리스트, 옷장을 관리합니다.",
    icon: Palette,
  },
];

const SECTION_ACCESS: Partial<Record<ManagementSection, (permission: GetChannelIdentifierPermissionResponse) => boolean>> = {
  songs: p => p.isOwner || p.manageContent,
  "songbook-download": p => p.isOwner || p.manageContent,
  "add-song": p => p.isOwner || p.manageContent,
  categories: p => p.isOwner || p.manageContent,
  artists: p => p.isOwner || p.manageContent,
  "song-requests": p => p.isOwner || p.manageContent,
  "song-request-settings": p => p.isOwner || p.manageSettings,
  "session-history": p => p.isOwner || p.manageSettings,
  "schedule-settings": p => p.isOwner || p.manageContent,
  setlists: p => p.isOwner || p.manageContent,
  wardrobe: p => p.isOwner || p.manageContent,
};

function FeatureGroupCard({
  base,
  definition,
  items,
}: {
  base: string;
  definition: DashboardGroup;
  items: ManagementMenuItem[];
}) {
  const GroupIcon = definition.icon;

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="border-b bg-muted/30 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <GroupIcon className="size-5" />
          </span>
          <div>
            <h3 className="text-lg font-extrabold paperlogy">
              {definition.group}
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {definition.description}
            </p>
          </div>
        </div>
      </div>

      <ul className="divide-y">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-4 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{item.label}</p>
              {item.description && (
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 rounded-full"
              asChild
            >
              <Link
                href={`${base}/${item.id}`}
                aria-label={`${item.label}로 이동`}
              >
                이동
                <ArrowRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeDashboard() {
  const params = useParams();
  const user = params?.user as string | undefined;
  const base = `/channel/${user}/manage`;

  const { data: userData } = useChannel(user || "");
  const { data: permission } = useChannelPermission(user || "");
  const { data: songsData } = usePublicUserSongs(user || "", { limit: 1 });
  const { data: categories } = useUserCategories(user || "");
  const { data: artists } = useUserArtists(user || "");
  const { data: favoritesCount } = useChannelFavoritesCount(userData?.id);

  const featureGroups = useMemo(() => {
    if (!permission) return [];

    return DASHBOARD_GROUPS.map((definition) => {
      const items = MANAGEMENT_MENU_ITEMS.filter((item) => {
        if (item.group !== definition.group) return false;

        const canAccess = SECTION_ACCESS[item.id];
        return canAccess ? canAccess(permission) : false;
      });

      return { definition, items };
    }).filter(({ items }) => items.length > 0);
  }, [permission]);

  const stats = [
    { label: "노래", value: songsData?.total ?? 0 },
    { label: "카테고리", value: categories?.length ?? 0 },
    { label: "아티스트", value: artists?.length ?? 0 },
    { label: "즐겨찾기", value: favoritesCount?.totalFavorites ?? 0 },
  ];

  return (
    <div className="space-y-8 p-4 md:p-6">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-bold">채널 데이터</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg bg-muted/50 p-4 text-center"
            >
              <div className="tabular-nums text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 md:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-extrabold paperlogy">
            채널 관리 기능
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            메뉴별로 할 수 있는 일을 확인하고 필요한 페이지로 바로 이동하세요.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {featureGroups.map(({ definition, items }) => (
            <FeatureGroupCard
              key={definition.group}
              base={base}
              definition={definition}
              items={items}
            />
          ))}
        </div>
      </section>

    </div>
  );
}
