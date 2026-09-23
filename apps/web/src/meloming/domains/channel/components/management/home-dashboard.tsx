"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ListOrdered,
  Palette,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { deleteChannelIdentifier } from "@/meloming/domains/channel/apis/channels";
import {
  channelKeys,
  useChannel,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import { useUserArtists } from "@/meloming/domains/channel/hooks/use-artists";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import { useChannelFavoritesCount } from "@/meloming/domains/channel/hooks/use-favorites";
import { myChannelKeys } from "@/meloming/domains/channel/hooks/use-my-channel";
import { usePublicUserSongs } from "@/meloming/domains/channel/hooks/use-songs";
import type { GetChannelIdentifierPermissionResponse } from "@/meloming/domains/channel/types/channel";
import {
  canAccessSongRequestOverlayFeature,
  isSongRequestOverlayManagementSection,
} from "@/meloming/domains/channel/utils/song-request-overlay-feature";
import ConfirmWithInputDialog from "@/meloming/shared/components/common/confirm-with-input-dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
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
    description: "신청 규칙부터 방송 화면, 리모컨과 지난 기록까지 설정합니다.",
    icon: ListOrdered,
  },
  {
    group: MANAGEMENT_GROUPS.CONTENT,
    description: "방송 일정과 셋리스트, 옷장 등 채널 콘텐츠를 관리합니다.",
    icon: Palette,
  },
  {
    group: MANAGEMENT_GROUPS.SETTINGS,
    description: "채널 정보와 메뉴, 꾸미기, 권한 및 소유권을 관리합니다.",
    icon: Settings,
  },
];

const SECTION_ACCESS: Partial<
  Record<
    ManagementSection,
    (permission: GetChannelIdentifierPermissionResponse) => boolean
  >
> = {
  songs: (permission) => permission.isOwner || permission.manageContent,
  "songbook-download": (permission) =>
    permission.isOwner || permission.manageContent,
  "add-song": (permission) => permission.isOwner || permission.manageContent,
  categories: (permission) => permission.isOwner || permission.manageContent,
  artists: (permission) => permission.isOwner || permission.manageContent,
  "song-requests": (permission) =>
    permission.isOwner || permission.manageContent,
  "song-request-settings": (permission) =>
    permission.isOwner || permission.manageSettings,
  "overlay-settings": (permission) =>
    permission.isOwner || permission.manageSettings,
  "overlay-custom-css": (permission) =>
    permission.isOwner || permission.manageCustomization,
  console: (permission) =>
    permission.isOwner || permission.manageSettings,
  "stream-deck": (permission) =>
    permission.isOwner || permission.manageSettings,
  "session-history": (permission) =>
    permission.isOwner || permission.manageSettings,
  "schedule-settings": (permission) =>
    permission.isOwner || permission.manageContent,
  "schedule-templates": (permission) =>
    permission.isOwner || permission.manageContent,
  "schedule-image": (permission) =>
    permission.isOwner || permission.manageContent,
  "sns-settings": (permission) =>
    permission.isOwner || permission.manageSettings,
  setlists: (permission) => permission.isOwner || permission.manageContent,
  wardrobe: (permission) => permission.isOwner || permission.manageContent,
  emoticons: (permission) =>
    permission.isOwner || permission.manageEmoticons,
  settings: (permission) =>
    permission.isOwner || permission.manageSettings,
  "channel-features": (permission) =>
    permission.isOwner || permission.manageSettings,
  decoration: (permission) =>
    permission.isOwner || permission.manageCustomization,
  manager: (permission) => permission.isOwner,
  favorites: (permission) => permission.isOwner,
  "channel-transfer": (permission) => permission.isOwner,
  "channel-auth": (permission) => permission.isOwner,
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = params?.user as string | undefined;
  const base = `/channel/${user}/manage`;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { user: me, isLoading: isAuthLoading } = useAuth();
  const { data: userData } = useChannel(user || "");
  const { data: permission } = useChannelPermission(user || "");
  const { data: songsData } = usePublicUserSongs(user || "", { limit: 1 });
  const { data: categories } = useUserCategories(user || "");
  const { data: artists } = useUserArtists(user || "");
  const { data: favoritesCount } = useChannelFavoritesCount(userData?.id);

  const overlayCustomCssEnabled = useFeatureFlag("overlayWidgetCustomCss");
  const channelScheduleTemplateEnabled = useFeatureFlag(
    "channelScheduleTemplate",
  );
  const channelEmoticonEnabled = useFeatureFlag("channelEmoticonEnabled");

  const canAccessSongRequestOverlay = useMemo(() => {
    if (isAuthLoading) return true;
    return canAccessSongRequestOverlayFeature(me);
  }, [isAuthLoading, me]);

  const featureGroups = useMemo(() => {
    if (!permission) return [];

    return DASHBOARD_GROUPS.map((definition) => {
      const items = MANAGEMENT_MENU_ITEMS.filter((item) => {
        if (item.group !== definition.group) return false;

        if (
          isSongRequestOverlayManagementSection(item.id) &&
          !canAccessSongRequestOverlay
        ) {
          return false;
        }
        if (
          item.id === "overlay-custom-css" &&
          !overlayCustomCssEnabled
        ) {
          return false;
        }
        if (
          ["schedule-templates", "schedule-image", "sns-settings"].includes(
            item.id,
          ) &&
          !channelScheduleTemplateEnabled
        ) {
          return false;
        }
        if (item.id === "emoticons" && !channelEmoticonEnabled) {
          return false;
        }

        const canAccess = SECTION_ACCESS[item.id];
        return canAccess ? canAccess(permission) : false;
      });

      return { definition, items };
    }).filter(({ items }) => items.length > 0);
  }, [
    canAccessSongRequestOverlay,
    channelEmoticonEnabled,
    channelScheduleTemplateEnabled,
    overlayCustomCssEnabled,
    permission,
  ]);

  const stats = [
    { label: "노래", value: songsData?.total ?? 0 },
    { label: "카테고리", value: categories?.length ?? 0 },
    { label: "아티스트", value: artists?.length ?? 0 },
    { label: "즐겨찾기", value: favoritesCount?.totalFavorites ?? 0 },
  ];

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("채널 식별자가 없습니다.");
      await deleteChannelIdentifier(user);
    },
    onSuccess: async () => {
      toast.success("채널이 삭제되었습니다.");
      await queryClient.invalidateQueries({ queryKey: myChannelKeys.all });
      if (user) {
        queryClient.removeQueries({ queryKey: channelKeys.identifier(user) });
        queryClient.removeQueries({
          queryKey: channelKeys.identifierPermission(user),
        });
      }
      router.replace("/mypage/home");
    },
    onError: () => {
      toast.error("채널 삭제 중 오류가 발생했습니다.");
    },
  });

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

      {permission?.isOwner && (
        <div className="border-t py-5 text-center">
          <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            채널 삭제
          </button>
        </div>
      )}

      <ConfirmWithInputDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="채널 삭제"
        description={`${userData?.name ?? "이"} 채널을 삭제하면 노래책과 일정 등 모든 데이터가 영구적으로 삭제됩니다. 아래에 '삭제'를 입력하여 계속하세요.`}
        requiredText="삭제"
        confirmLabel="삭제"
        cancelLabel="취소"
        onConfirm={() => deleteMutation.mutateAsync()}
      />
    </div>
  );
}
