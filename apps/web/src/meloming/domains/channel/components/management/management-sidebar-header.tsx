"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import UserAvatar from "../channel/user-avatar";
import type { ManagementSection } from "./types";
import { ChannelSelectDialog } from "./channel-select-dialog";

interface ManagementSidebarHeaderProps {
  userData:
    | import("@/meloming/domains/channel/types/channel").Channel
    | null
    | undefined;
  activeSection: ManagementSection;
}

export function ManagementSidebarHeader({
  userData,
  activeSection,
}: ManagementSidebarHeaderProps) {
  const [isChannelSelectOpen, setIsChannelSelectOpen] = useState(false);

  const channelHref = userData?.webPath
    ? `/channel/${userData.webPath}`
    : undefined;

  return (
    <>
      <div className="flex items-center gap-4 rounded-md border border-transparent p-3">
        {channelHref ? (
          <Link
            href={channelHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 min-w-0 flex-1 rounded-md hover:opacity-80 transition-opacity"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <UserAvatar
                userName={userData?.name || ""}
                profileImageUrl={userData?.profileImageUrl}
                className="w-12 h-12 rounded-full object-cover select-none border-none"
                fallbackStyle={{
                  color: "var(--foreground)",
                }}
              />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-bold text-xl paperlogy">
                {userData?.name}
              </span>
              <span className="text-sm text-muted-foreground paperlogy">
                관리자 페이지
              </span>
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <UserAvatar
                userName={userData?.name || ""}
                profileImageUrl={userData?.profileImageUrl}
                className="w-12 h-12 rounded-full object-cover select-none border-none"
                fallbackStyle={{
                  color: "var(--foreground)",
                }}
              />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-bold text-xl paperlogy">
                {userData?.name}
              </span>
              <span className="text-sm text-muted-foreground paperlogy">
                관리자 페이지
              </span>
            </div>
          </div>
        )}
        <button
          type="button"
          className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="채널 선택"
          onClick={() => setIsChannelSelectOpen((prev) => !prev)}
        >
          {isChannelSelectOpen ? (
            <ChevronsDownUp size={18} />
          ) : (
            <ChevronsUpDown size={18} />
          )}
        </button>
      </div>
      <ChannelSelectDialog
        open={isChannelSelectOpen}
        onOpenChange={setIsChannelSelectOpen}
        activeSection={activeSection}
      />
    </>
  );
}

