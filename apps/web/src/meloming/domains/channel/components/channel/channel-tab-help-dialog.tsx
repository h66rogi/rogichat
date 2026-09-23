"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/meloming/shared/components/ui/dialog";
import type { ChannelTab } from "@/meloming/domains/channel/types/channel-tab";
import { cn } from "@/meloming/shared/lib/utils";

type DetailLink = {
  href: string;
  label: string;
  description: string;
};

type ChannelTabHelpData = {
  summary: string;
  highlights: string[];
  detailLink?: DetailLink;
};

const TAB_HELP: Partial<Record<ChannelTab, ChannelTabHelpData>> = {
  musicbook: {
    summary:
      "이 채널이 부를 수 있는 곡과 신청 가능한 곡을 모아 보는 페이지입니다. 곡을 눌러 상세 정보, 신청 버튼, 관련 클립을 확인할 수 있습니다.",
    highlights: [
      "검색, 카테고리, 난이도로 원하는 곡을 빠르게 좁힐 수 있습니다.",
      "신청곡이 켜져 있으면 곡별 가격과 신청 가능 상태를 함께 보여줍니다.",
      "스트리머가 등록한 공지와 신청곡 안내를 노래책 위에서 바로 확인합니다.",
    ],
    detailLink: {
      href: "/musicbook",
      label: "노래책 소개 페이지",
      description: "노래책을 만드는 방법과 방송 운영 기능을 자세히 볼 수 있습니다.",
    },
  },
  schedule: {
    summary:
      "방송 일정, 방송 기록, 노래 방송 셋리스트, 클립 영상, 채널 기념일을 한 곳에서 보는 통합 캘린더입니다.",
    highlights: [
      "주간/월간 보기를 전환해 가까운 일정과 지난 활동을 확인합니다.",
      "날짜를 누르면 그 날의 모든 이벤트를 한 번에 볼 수 있습니다.",
      "기념일, 노래 방송, 방송 기록, 방송 일정이 서로 다른 색으로 구분됩니다.",
    ],
  },
  wardrobe: {
    summary:
      "버추얼 스트리머의 의상, 헤어 등 아바타 이미지를 모아 보는 페이지입니다.",
    highlights: [
      "Live2D/3D 아바타의 의상과 헤어 등을 한 번에 모아서 볼 수 있습니다.",
      "스트리머가 옷장 카테고리도 자유롭게 설정할 수 있습니다.",
    ],
  },
  setlist: {
    summary:
      "방송에서 실제로 재생되거나 부른 곡을 세션별로 다시 보는 페이지입니다. 노래 방송의 흐름을 시간순으로 복기할 수 있습니다.",
    highlights: [
      "방송 단위로 곡 목록을 확인합니다.",
      "셋리스트가 있는 방송만 정리되어 노래 방송 기록을 빠르게 찾을 수 있습니다.",
      "연결된 곡과 클립이 있으면 다른 채널 기능으로 이어집니다.",
    ],
  },
  guestbook: {
    summary:
      "채널에 짧은 메시지를 남기고 다른 방문자의 반응을 볼 수 있는 방명록입니다.",
    highlights: [
      "채널 방문 인사와 응원 메시지를 남길 수 있습니다.",
      "이모티콘과 간단한 상호작용으로 가볍게 소통합니다.",
      "채널 설정에 따라 방명록 메뉴가 숨겨질 수 있습니다.",
    ],
  },
  info: {
    summary:
      "스트리머가 직접 정리한 프로필, 링크, 활동 정보, 채널 안내를 확인하는 페이지입니다.",
    highlights: [
      "방송 플랫폼과 외부 링크를 한 곳에서 확인합니다.",
      "채널 소개와 세부 정보를 구조화해서 볼 수 있습니다.",
      "채널 주인이 업데이트한 최신 안내가 우선 표시됩니다.",
    ],
  },
  content: {
    summary:
      "이 채널이 참여하거나 모집 중인 콘텐츠 정보를 보여주는 페이지입니다. 기획, 참가 조건, 일정 등을 확인할 수 있습니다.",
    highlights: [
      "채널과 연결된 콘텐츠 모집글을 모아 봅니다.",
      "모집 기간, 진행 일정, 참여 조건을 확인합니다.",
      "콘텐츠 뻐꾸기 전체 목록으로 이동해 다른 모집도 탐색할 수 있습니다.",
    ],
    detailLink: {
      href: "/content",
      label: "콘텐츠 뻐꾸기 보기",
      description: "채널 콘텐츠 정보를 둘러봅니다.",
    },
  },
};

interface ChannelTabHelpDialogProps {
  tab: ChannelTab;
  title: string;
  icon: LucideIcon;
  description?: string;
}

export function ChannelTabHelpDialog({
  tab,
  title,
  icon: Icon,
  description,
}: ChannelTabHelpDialogProps) {
  const help = TAB_HELP[tab] ?? {
    summary: description ?? `${title} 페이지에서 채널의 관련 정보를 확인할 수 있습니다.`,
    highlights: [
      "채널 주인이 설정한 정보와 공개 상태에 따라 내용이 달라집니다.",
      "왼쪽 채널 메뉴에서 다른 페이지로 바로 이동할 수 있습니다.",
    ],
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`${title} 설명 열기`}
          title={`${title} 설명`}
          className={cn(
            "group inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-indigo-500/35 bg-indigo-500/10 text-[15px] font-bold text-indigo-700 shadow-sm transition",
            "hover:border-indigo-500/60 hover:bg-indigo-500/15 hover:text-indigo-800 hover:shadow",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-2",
            "dark:border-indigo-400/40 dark:bg-indigo-400/10 dark:text-indigo-300 dark:hover:bg-indigo-400/15"
          )}
        >
          ?
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(720px,calc(100svh-2rem))] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <Icon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 text-left">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <CircleHelp className="size-3.5" aria-hidden />
                채널 페이지 도움말
              </div>
              <DialogTitle className="mt-1 text-xl leading-tight">
                {title}
              </DialogTitle>
            </div>
          </div>
          <DialogDescription className="text-left leading-relaxed">
            {help.summary}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-amber-500" aria-hidden />
              이 페이지에서 할 수 있는 일
            </div>
            <ul className="space-y-2.5">
              {help.highlights.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-relaxed">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-emerald-500"
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {help.detailLink ? (
            <div className="flex flex-col gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{help.detailLink.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {help.detailLink.description}
                </p>
              </div>
              <Button asChild variant="indigo" className="w-full sm:w-auto">
                <Link href={help.detailLink.href}>
                  이동
                  {help.detailLink.href.startsWith("http") ? (
                    <ExternalLink className="size-4" aria-hidden />
                  ) : (
                    <ArrowRight className="size-4" aria-hidden />
                  )}
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
