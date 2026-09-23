"use client";

import Link from "next/link";
import { ClipPlayer } from "@/meloming/domains/clip/components/clip-player";
import { ClipPlatformBadge } from "@/meloming/domains/clip/components/clip-platform-badge";
import { useClip } from "@/meloming/domains/clip/hooks/use-clips";

export function ClipDetailContent({ clipId }: { clipId: number }) {
  const { data: clip, isLoading, error } = useClip(clipId);
  if (isLoading) return <main className="mx-auto max-w-5xl p-6">클립을 불러오는 중...</main>;
  if (error || !clip) return <main className="mx-auto max-w-5xl p-6">클립을 불러오지 못했습니다.</main>;
  const channel = clip.channels[0];
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-8">
      <ClipPlayer clipId={clip.id} platform={clip.platform}
        videoId={clip.videoId ?? undefined} videoUrl={clip.videoUrl ?? undefined}
        thumbnailUrl={clip.thumbnailUrl ?? undefined} title={clip.title} />
      <div className="flex items-center gap-2"><ClipPlatformBadge platform={clip.platform} />
        <h1 className="text-2xl font-bold">{clip.title}</h1></div>
      {channel && <Link className="text-sm text-primary hover:underline" href={`/channel/${channel.channelWebPath ?? 'hurogi'}/musicbook`}>
        {channel.channelName}{channel.songTitle ? ` · ${channel.songTitle}` : ""}
      </Link>}
      {clip.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{clip.description}</p>}
    </main>
  );
}
