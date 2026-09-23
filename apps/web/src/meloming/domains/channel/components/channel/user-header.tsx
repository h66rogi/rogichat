"use client";

import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  LinkIcon,
  Settings,
  Star,
  Share2,
  Camera,
  Loader2,
} from "lucide-react";
import { ShareSheet } from "@/meloming/shared/components/common/share-sheet";
import {
  useChannel,
  useChannelPermission,
  channelKeys,
} from "@/meloming/domains/channel/hooks/use-channel";
import UserAvatar from "./user-avatar";
import ImageCropDialog from "@/meloming/shared/components/common/image-crop-dialog";
import PlatformBadge, {
  PlatformBadges,
  buildPlatformUrl,
  platformIconSrc,
  platformIconSrcByUrl,
} from "./platform-badge";
import type { StreamPlatform } from "@/meloming/domains/platform/types/platform";
import { SkeletonUserHeader } from "@/meloming/shared/components/skeleton";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import { cn, isKSX1001Compatible } from "@/meloming/shared/lib/utils";
import clsx from "clsx";
// PublicUser는 채널의 공개 정보와 동일 스키마로 취급
import type {
  Channel as PublicUser,
  GetChannelIdentifierPermissionResponse,
} from "@/meloming/domains/channel/types/channel";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";
import { putChannelIdentifier } from "@/meloming/domains/channel/apis/channels";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFavoriteChannelStatus,
  useToggleFavoriteChannel,
  useUnfavoriteChannel,
  useChannelFavoritesCount,
} from "@/meloming/domains/channel/hooks/use-favorites";
import { toast } from "sonner";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import LoginRequiredDialog from "@/meloming/shared/components/common/login-required-dialog";
import { VerifiedBadge } from "@/meloming/shared/components/common/verified-badge";

interface CropSession {
  imageSrc: string;
  mime: string;
  fileName: string;
}

function deriveOutputType(mime: string | null): "image/jpeg" | "image/png" | "image/webp" {
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  return "image/jpeg";
}

interface UserHeaderProps {
  userId: string;
  userData?: PublicUser; // userData가 전달되면 API 호출하지 않음
  userPermission?: GetChannelIdentifierPermissionResponse | null; // userPermission이 전달되면 API 호출하지 않음
  /**
   * 렌더 변형:
   * - full(기본): 배너 + 프로필 + 액션 (기존 가로 레이아웃)
   * - banner: 배너 배경만 (신규 레이아웃 콘텐츠 영역)
   * - sidebar: 원형 프로필 + 이름 + 원형 링크 버튼 + 즐겨찾기/공유/관리 (신규 레이아웃 사이드바)
   */
  variant?: "full" | "banner" | "sidebar";
}

export default function UserHeader({
  userId,
  userData,
  userPermission: userPermissionProp,
  variant = "full",
}: UserHeaderProps) {
  const hasUserPermissionProp = userPermissionProp !== undefined;
  const {
    data: user,
    isLoading,
    error,
  } = useChannel(userId, {
    enabled: !userData, // userData가 없을 때만 API 호출
  });
  const isMobile = useIsMobile();

  const { data: userPermissionFetched } = useChannelPermission(userId, {
    enabled: !hasUserPermissionProp, // userPermission prop이 없을 때만 API 호출
    initialData: userPermissionProp,
  });

  // 전달받은 데이터 우선 사용, 없으면 API 호출 결과 사용
  const userInfo = userData || user;
  const userPermission = hasUserPermissionProp
    ? userPermissionProp
    : userPermissionFetched;
  const isOwner = userPermission?.isOwner ?? false;
  const isVerified = Boolean(userInfo?.isVerified);
  const isWide = userInfo?.layoutWidth === "wide";
  const isSeparated = userInfo?.headerStyle === "separated";

  const channelId = userInfo?.id;

  const { data: favoriteStatus, refetch: refetchFavoriteStatus } =
    useFavoriteChannelStatus(
      typeof channelId === "number" ? channelId : undefined
    );
  const { data: favoritesCount, refetch: refetchFavoritesCount } =
    useChannelFavoritesCount(
      typeof channelId === "number" ? channelId : undefined
    );
  const toggleFavoriteChannel = useToggleFavoriteChannel();
  const unFavoriteChannel = useUnfavoriteChannel();
  const { isAuthenticated } = useAuth();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);

  // 프로필 이미지 인라인 편집 (크롭 포함)
  const profileFileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { uploadImage: uploadProfileImage, isUploading: isProfileUploading } = useImageUpload();
  const canEditProfile = isOwner || (userPermission?.manageSettings ?? false);
  const [cropSession, setCropSession] = useState<CropSession | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // 컴포넌트 언마운트 시 object URL 해제
  useEffect(() => {
    return () => {
      if (cropSession?.imageSrc) URL.revokeObjectURL(cropSession.imageSrc);
    };
  }, [cropSession?.imageSrc]);

  const closeCropDialog = () => {
    if (cropSession?.imageSrc) URL.revokeObjectURL(cropSession.imageSrc);
    setCropSession(null);
  };

  const handleProfileFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("이미지 파일만 업로드할 수 있습니다."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("파일 크기는 10MB 이하여야 합니다."); return; }

    // GIF는 크롭 없이 바로 업로드
    if (file.type === "image/gif") {
      handleProfileUploadAndSave(file);
      e.currentTarget.value = "";
      return;
    }

    setCropSession({
      imageSrc: URL.createObjectURL(file),
      mime: file.type,
      fileName: file.name,
    });
    e.currentTarget.value = "";
  };

  const handleProfileUploadAndSave = async (file: File) => {
    if (!userInfo) return;
    try {
      setIsSavingProfile(true);
      const { imageUrl } = await uploadProfileImage(file);
      await putChannelIdentifier(userId, {
        name: userInfo.name,
        webPath: userInfo.webPath,
        platformUrl: userInfo.platformUrl ?? "",
        profileImageUrl: imageUrl,
        topBannerUrl: userInfo.topBannerUrl,
        leftBannerUrl: userInfo.leftBannerUrl,
        leftBannerLink: userInfo.leftBannerLink,
        rightBannerUrl: userInfo.rightBannerUrl,
        rightBannerLink: userInfo.rightBannerLink,
        additionalLinks: userInfo.additionalLinks,
        themeColor: userInfo.themeColor,
        channelDescription: userInfo.channelDescription,
      });
      queryClient.invalidateQueries({ queryKey: channelKeys.identifier(userId) });
      router.refresh();
      toast.success("프로필 이미지가 변경되었습니다.");
    } catch { toast.error("프로필 이미지 변경에 실패했습니다."); }
    finally { setIsSavingProfile(false); }
  };

  const profileBusy = isProfileUploading || isSavingProfile;

  if (!userData && isLoading) {
    return <SkeletonUserHeader />;
  }

  if (!userData && (error || !user)) {
    return (
      <div className="container mx-auto py-8 px-4 md:px-6">
        <div className="text-center">
          <p className="text-red-500 font-medium">
            없는 유저이거나 유저 정보를 불러올 수 없습니다.
          </p>
        </div>
      </div>
    );
  }

  if (!userInfo) {
    return null;
  }

  const channelLinks: {
    url: string;
    label: string;
    iconSrc: string | null;
  }[] = [];
  if (userInfo.verifications && userInfo.verifications.length > 0) {
    userInfo.verifications.forEach((v) => {
      const builtUrl = buildPlatformUrl(
        v.platform as StreamPlatform,
        v.platformChannelId,
        userInfo.platformUrl
      );
      if (builtUrl) {
        channelLinks.push({
          url: builtUrl,
          label: `${v.platform} 채널`,
          iconSrc: platformIconSrc(v.platform as StreamPlatform),
        });
      }
    });
  } else if (userInfo.platformUrl) {
    channelLinks.push({
      url: userInfo.platformUrl,
      label: "방송 채널",
      iconSrc: platformIconSrcByUrl(userInfo.platformUrl),
    });
  }
  (userInfo.additionalLinks ?? []).forEach((l) =>
    channelLinks.push({ url: l.url, label: l.name, iconSrc: null })
  );

  const handleFavoriteClick = async () => {
    if (typeof channelId !== "number") return;
    if (!isAuthenticated) {
      setLoginDialogOpen(true);
      return;
    }
    try {
      if (favoriteStatus?.isFavorite) {
        await unFavoriteChannel.mutateAsync({ channelId });
      } else {
        await toggleFavoriteChannel.mutateAsync({ channelId });
      }
      await refetchFavoriteStatus();
      await refetchFavoritesCount();
    } catch {
      toast.error("즐겨찾기 처리에 실패했습니다. 다시 시도해주세요.");
    }
  };

  const renderChannelLinks = () => {
    if (channelLinks.length === 0) return null;
    return (
      <div className="absolute bottom-4 right-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap justify-end gap-2">
        {channelLinks.map((link, index) => (
          <Button
            key={index}
            asChild
            variant="outline"
            size="icon"
            className="group/link relative size-10 rounded-full border-white/60 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
            title={link.label}
          >
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
            >
              {link.iconSrc ? (
                <img
                  src={link.iconSrc}
                  alt={link.label}
                  className="size-5 rounded-sm object-cover"
                />
              ) : (
                <LinkIcon size={16} />
              )}
              <span className="pointer-events-none absolute bottom-full right-0 mb-2 max-w-64 truncate rounded-md bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground opacity-0 shadow-md ring-1 ring-border transition-opacity group-hover/link:opacity-100 group-focus-visible/link:opacity-100">
                {link.label}
              </span>
            </a>
          </Button>
        ))}
      </div>
    );
  };

  // 신규 레이아웃: 콘텐츠 영역엔 배너 배경만 노출 (프로필/액션은 사이드바가 담당)
  if (variant === "banner") {
    return (
      <section id="channel-header">
        <div
          id="channel-banner"
          className={clsx(
            "relative w-full overflow-hidden",
            isMobile ? "h-28" : "h-44"
          )}
          style={{ backgroundColor: userInfo.themeColor }}
        >
          {userInfo.topBannerUrl && (
            <img
              src={userInfo.topBannerUrl}
              alt={`${userInfo.name} 상단 배너`}
              className="w-full h-full object-cover"
            />
          )}
          {renderChannelLinks()}
        </div>
      </section>
    );
  }

  // 신규 레이아웃 사이드바: 중앙 프로필 + 이름 + 뱃지 + 즐겨찾기/관리/공유
  if (variant === "sidebar") {
    return (
      <div className="relative flex flex-col gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 size-8 rounded-full"
          onClick={() => setShareSheetOpen(true)}
          title="공유하기"
          aria-label="공유하기"
        >
          <Share2 size={16} />
        </Button>

        <div className="flex flex-col items-center gap-3 px-3 pb-2 pt-6 text-center">
          <div className="relative">
            <div className="group/avatar">
              <UserAvatar
                userName={userInfo.name}
                profileImageUrl={userInfo.profileImageUrl}
                className="size-24 rounded-full border-none object-cover select-none shadow-sm"
                fallbackStyle={{ color: "var(--foreground)" }}
              />
              {canEditProfile && (
                <>
                  <div
                    className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/0 transition-colors group-hover/avatar:bg-black/40"
                    onClick={() =>
                      !profileBusy && profileFileInputRef.current?.click()
                    }
                  >
                    <div className="text-white opacity-0 transition-opacity group-hover/avatar:opacity-100">
                      {profileBusy ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <Camera className="size-5" />
                      )}
                    </div>
                  </div>
                  <input
                    ref={profileFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProfileFileSelect}
                  />
                </>
              )}
            </div>
          </div>
          <div className="flex max-w-full items-center justify-center gap-1.5">
            <Link
              href={`/channel/${userInfo.webPath}`}
              className="min-w-0 truncate text-xl font-bold font-pretendard transition-opacity hover:opacity-80"
            >
              {userInfo.name}
            </Link>
            {isVerified && <VerifiedBadge variant="small" />}
          </div>

        </div>

        <div className="flex flex-col gap-2 px-3">
          {/* 즐겨찾기 — 관리 행 위 한 줄 배치 */}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1 px-2 text-xs"
            title="즐겨찾기"
            aria-label="즐겨찾기"
            disabled={
              toggleFavoriteChannel.isPending || unFavoriteChannel.isPending
            }
            onClick={handleFavoriteClick}
          >
            <Star
              size={16}
              className={
                favoriteStatus?.isFavorite ? "text-yellow-500" : undefined
              }
              fill={favoriteStatus?.isFavorite ? "currentColor" : "none"}
            />
            즐겨찾기{" "}
            <span className="font-semibold">
              {favoritesCount?.totalFavorites ?? 0}
            </span>
          </Button>

          {userPermission &&
            (userPermission.manageContent ||
              userPermission.manageSettings ||
              userPermission.manageProfile ||
              userPermission.manageGuestbook ||
              userPermission.manageCustomization ||
              userPermission.manageEmoticons) && (
              <div className="flex w-full gap-2">
                <Button
                  asChild
                  variant="default"
                  size="sm"
                  className="min-w-0 flex-1 gap-1 px-2 text-xs"
                >
                  <Link href={`/channel/${userId}/manage`}>
                    <Settings size={16} />
                    관리
                  </Link>
                </Button>
              </div>
            )}
        </div>

        {/* 다이얼로그 (full 과 동일 인스턴스) */}
        <LoginRequiredDialog
          open={loginDialogOpen}
          onOpenChange={setLoginDialogOpen}
        />
        <ShareSheet
          open={shareSheetOpen}
          onOpenChange={setShareSheetOpen}
          data={{
            title: `${userInfo.name} - 로기챗`,
            text: `${userInfo.name}님의 로기챗 채널`,
            url:
              typeof window !== "undefined"
                ? window.location.href
                : `https://rogi.chat/channel/${userId}`,
          }}
        />
        <ImageCropDialog
          open={!!cropSession}
          imageSrc={cropSession?.imageSrc ?? null}
          outputType={deriveOutputType(cropSession?.mime ?? null)}
          onOpenChange={(open) => {
            if (!open) closeCropDialog();
          }}
          onCancel={closeCropDialog}
          onConfirm={async (blob) => {
            const outputType = deriveOutputType(cropSession?.mime ?? null);
            const base = (cropSession?.fileName ?? "image").replace(
              /\.[^.]+$/,
              ""
            );
            const ext =
              outputType === "image/png"
                ? "png"
                : outputType === "image/webp"
                  ? "webp"
                  : "jpg";
            const file = new File([blob], `${base}-cropped.${ext}`, {
              type: outputType,
            });
            handleProfileUploadAndSave(file);
            closeCropDialog();
          }}
        />
      </div>
    );
  }

  return (
    <>
      {!isSeparated && (
        <section id="channel-header">
          <div
            id="channel-banner"
            className={clsx("w-full", isMobile ? "h-24" : "h-48")}
            style={{ backgroundColor: userInfo.themeColor }}
          >
            {userInfo.topBannerUrl && (
              <img
                src={userInfo.topBannerUrl}
                alt={`${userInfo.name} 상단 배너`}
                className="w-full h-full object-cover"
              />
            )}
          </div>
        </section>
      )}

      <section id="channel-profile" className={cn(!isSeparated && !isWide && "container", "mx-auto", !isSeparated && "px-4 md:px-6")}>
        <div className={`flex gap-4 ${isMobile ? "flex-col" : "flex-row"}`}>
          <div
            id="channel-avatar"
            className={`flex items-end gap-4 ${
              isSeparated
                ? (isMobile ? "justify-center mt-2" : "mt-2")
                : (isMobile ? "mt-[-3rem] justify-center" : "mt-[-2.5rem]")
            }`}
          >
            <div className="relative group/avatar">
              <UserAvatar
                userName={userInfo.name}
                profileImageUrl={userInfo.profileImageUrl}
                className={clsx(isMobile ? "w-24 h-24" : "")}
              />
              {canEditProfile && (
                <>
                  <div
                    className="absolute inset-0 rounded-full bg-black/0 group-hover/avatar:bg-black/40 transition-colors cursor-pointer flex items-center justify-center"
                    onClick={() => !profileBusy && profileFileInputRef.current?.click()}
                  >
                    <div className="opacity-0 group-hover/avatar:opacity-100 transition-opacity text-white">
                      {profileBusy ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <Camera className="size-5" />
                      )}
                    </div>
                  </div>
                  <input
                    ref={profileFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProfileFileSelect}
                  />
                </>
              )}
            </div>
          </div>

          <div
            className={`flex w-full ${
              isMobile ? "flex-col gap-4" : "flex-row justify-between"
            }`}
          >
            <div
              className={`flex flex-col gap-3 ${
                isMobile ? "items-center text-center mt-1" : "mt-6"
              }`}
            >
              <div
                id="channel-name"
                className={clsx(
                  "text-2xl font-bold flex items-center gap-2",
                  isKSX1001Compatible(userInfo.name)
                    ? "paperlogy"
                    : "font-pretendard"
                )}
              >
                {userInfo.name}
                {isVerified && <VerifiedBadge variant="small" />}
              </div>

              <div
                id="channel-platforms"
                className="flex flex-row gap-2 flex-wrap justify-start"
              >
                {userInfo.verifications && userInfo.verifications.length > 0 ? (
                  <PlatformBadges
                    verifications={userInfo.verifications as { platform: StreamPlatform; platformChannelId?: string | null }[]}
                    platformUrl={userInfo.platformUrl}
                  />
                ) : userInfo.platformUrl ? (
                  <a
                    href={userInfo.platformUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <PlatformBadge platformUrl={userInfo.platformUrl} />
                  </a>
                ) : null}

                {userInfo.additionalLinks &&
                  userInfo.additionalLinks.map(
                    (data: { name: string; url: string }, index: number) => (
                      <a
                        key={index}
                        href={data.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Badge variant="outline" className="select-none">
                          <LinkIcon size={14} />
                          {data.name}
                        </Badge>
                      </a>
                    )
                  )}
              </div>
            </div>

            <div
              id="channel-actions"
              className={`flex gap-2 ${
                isMobile ? "justify-center mt-2 flex-wrap" : "flex-row mt-6"
              }`}
            >
              {userPermission &&
                (userPermission.manageContent ||
                  userPermission.manageSettings ||
                  userPermission.manageProfile ||
                  userPermission.manageGuestbook ||
                  userPermission.manageCustomization ||
                  userPermission.manageEmoticons) && (
                  <Link href={`/channel/${userId}/manage`}>
                    <Button variant="default">
                      <Settings size={16} />
                      관리
                    </Button>
                  </Link>
                )}

              <Button
                variant="indigo-outline"
                style={{
                  color: "var(--color-foreground)",
                  borderColor: `${userInfo.themeColor}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = `${userInfo.themeColor}20`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = `transparent`;
                }}
                disabled={
                  toggleFavoriteChannel.isPending || unFavoriteChannel.isPending
                }
                onClick={async () => {
                  if (typeof channelId !== "number") return;
                  if (!isAuthenticated) {
                    setLoginDialogOpen(true);
                    return;
                  }
                  try {
                                  if (favoriteStatus?.isFavorite) {
                      await unFavoriteChannel.mutateAsync({ channelId });
                    } else {
                      await toggleFavoriteChannel.mutateAsync({ channelId });
                    }
                    await refetchFavoriteStatus();
                    await refetchFavoritesCount();
                  } catch {
                    toast.error(
                      "즐겨찾기 처리에 실패했습니다. 다시 시도해주세요."
                    );
                  }
                }}
              >
                <Star
                  size={16}
                  className={
                    favoriteStatus?.isFavorite ? "text-yellow-500" : undefined
                  }
                  fill={favoriteStatus?.isFavorite ? "currentColor" : "none"}
                />
                즐겨찾기{" "}
                <span className="font-semibold">
                  {favoritesCount?.totalFavorites ?? 0}
                </span>
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setShareSheetOpen(true)}
                title="공유하기"
              >
                <Share2 size={16} />
              </Button>

              <LoginRequiredDialog
                open={loginDialogOpen}
                onOpenChange={setLoginDialogOpen}
              />
                    <ShareSheet
                open={shareSheetOpen}
                onOpenChange={setShareSheetOpen}
                data={{
                  title: `${userInfo.name} - 로기챗`,
                  text: `${userInfo.name}님의 로기챗 채널`,
                  url: typeof window !== "undefined" ? window.location.href : `https://rogi.chat/channel/${userId}`,
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 프로필 이미지 크롭 다이얼로그 */}
      <ImageCropDialog
        open={!!cropSession}
        imageSrc={cropSession?.imageSrc ?? null}
        outputType={deriveOutputType(cropSession?.mime ?? null)}
        onOpenChange={(open) => { if (!open) closeCropDialog(); }}
        onCancel={closeCropDialog}
        onConfirm={async (blob) => {
          const outputType = deriveOutputType(cropSession?.mime ?? null);
          const base = (cropSession?.fileName ?? "image").replace(/\.[^.]+$/, "");
          const ext = outputType === "image/png" ? "png" : outputType === "image/webp" ? "webp" : "jpg";
          const file = new File([blob], `${base}-cropped.${ext}`, { type: outputType });
          handleProfileUploadAndSave(file);
          closeCropDialog();
        }}
      />
    </>
  );
}
