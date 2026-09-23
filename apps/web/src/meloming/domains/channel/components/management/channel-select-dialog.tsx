"use client";

import { useRouter, useParams } from "next/navigation";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { ScrollArea } from "@/meloming/shared/components/ui/scroll-area";
import { useMyChannel } from "@/meloming/domains/channel/hooks/use-my-channel";
import { Badge } from "@/meloming/shared/components/ui/badge";
import UserAvatar from "../channel/user-avatar";
import clsx from "clsx";
import { useSidebar } from "@/meloming/shared/components/ui/sidebar";
import type { ManagementSection } from "./types";

interface ChannelSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSection: ManagementSection;
}

/**
 * 채널 선택 다이얼로그 클라이언트 컴포넌트
 * 사용자가 관리할 채널을 선택할 수 있습니다.
 */
export function ChannelSelectDialog({
  open,
  onOpenChange,
  activeSection,
}: ChannelSelectDialogProps) {
  const params = useParams();
  const user = params?.user as string | undefined;
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: myChannels, isLoading: isMyChannelsLoading } = useMyChannel();

  const getUrlForSectionWithUser = (
    selectedUser: string,
    sectionId: ManagementSection
  ): string => {
    if (sectionId === "home") {
      return `/channel/${selectedUser}/manage`;
    }
    return `/channel/${selectedUser}/manage/${sectionId}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="paperlogy">채널 선택</DialogTitle>
        <div className="mt-2">
          {isMyChannelsLoading && (
            <div className="py-8 text-center text-muted-foreground">
              로딩 중...
            </div>
          )}
          {!isMyChannelsLoading &&
            (!myChannels || myChannels.length === 0) && (
              <div className="py-8 text-center text-muted-foreground">
                생성된 채널이 없습니다.
              </div>
            )}
          {!isMyChannelsLoading && myChannels && myChannels.length > 0 && (
            <ScrollArea className="max-h-[60svh] pr-3">
              <ul className="divide-y divide-border">
                {myChannels.map((ch) => (
                  <li key={ch.id}>
                    <div
                      className={clsx(
                        "w-full flex items-center gap-4 p-3 rounded-md transition-all border group",
                        ch.webPath === (user || "")
                          ? "border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/50"
                          : "border-transparent hover:bg-muted hover:border-border"
                      )}
                    >
                      <button
                        type="button"
                        className="flex items-center gap-4 flex-1 min-w-0 text-left transition-transform group-hover:scale-[1.01]"
                        onClick={() => {
                          onOpenChange(false);
                          if (isMobile) setOpenMobile(false);
                          const target = getUrlForSectionWithUser(
                            ch.webPath,
                            activeSection
                          );
                          router.push(target);
                        }}
                      >
                        <UserAvatar
                          userName={ch.name}
                          profileImageUrl={ch.profileImageUrl}
                          className={clsx(
                            "w-12 h-12 rounded-full object-cover",
                            ch.webPath === (user || "") && "ring-2 ring-primary/40"
                          )}
                          fallbackStyle={{ color: "var(--foreground)" }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-medium truncate paperlogy">
                              {ch.name}
                            </div>
                            {!ch.isOwner && (
                              <Badge
                                variant="default"
                                className="text-[11px] py-0 px-1 paperlogy"
                              >
                                매니저
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground truncate">
                            /channel/{ch.webPath}
                          </div>
                        </div>
                      </button>

                      <Button
                        variant="indigo-outline"
                        size="sm"
                        type="button"
                        className="ml-auto flex items-center gap-2 paperlogy shrink-0"
                        onClick={() => {
                          onOpenChange(false);
                          if (isMobile) setOpenMobile(false);
                          router.push(`/channel/${ch.webPath}`);
                        }}
                      >
                        채널로 이동
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

