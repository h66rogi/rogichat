"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ImageIcon } from "lucide-react";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { cn } from "@/meloming/shared/lib/utils";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { useChannelWardrobe } from "@/meloming/domains/channel/hooks/use-wardrobe";
import { WardrobeRichDescription } from "@/meloming/domains/channel/components/wardrobe-rich-description";

export function ChannelWardrobeDetailContent({
  user,
  itemId,
}: {
  user: string;
  itemId: number;
}) {
  const { data: channel } = useChannel(user);
  const { data: wardrobe, isLoading } = useChannelWardrobe(user);
  const isWide = channel?.layoutWidth === "wide";

  const categoryById = useMemo(
    () =>
      new Map(
        (wardrobe?.categories ?? []).map((category) => [category.id, category]),
      ),
    [wardrobe?.categories],
  );
  const item = useMemo(
    () => wardrobe?.items.find((candidate) => candidate.id === itemId),
    [itemId, wardrobe?.items],
  );
  const category = item ? categoryById.get(item.categoryId) : undefined;

  if (isLoading) {
    return (
      <section
        className={cn(!isWide && "container", "mx-auto mt-8 px-4 md:px-6")}
      >
        <Skeleton className="mb-4 h-8 w-32" />
        <Skeleton className="mb-6 h-28 rounded-lg" />
        <Skeleton className="min-h-[50vh] rounded-lg" />
      </section>
    );
  }

  if (!item) {
    return (
      <section
        className={cn(!isWide && "container", "mx-auto mt-8 px-4 md:px-6")}
      >
        <Button asChild variant="ghost" size="sm" className="mb-5">
          <Link href={`/channel/${user}/wardrobe`}>
            <ArrowLeft className="size-4" />
            옷장
          </Link>
        </Button>
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-16 text-center text-muted-foreground">
          <ImageIcon className="size-10 opacity-40" />
          <p className="text-sm">옷장 항목을 찾을 수 없습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        !isWide && "container",
        "mx-auto mt-8 px-4 pb-12 md:px-6",
      )}
    >
      <Button asChild variant="ghost" size="sm" className="mb-5">
        <Link href={`/channel/${user}/wardrobe`}>
          <ArrowLeft className="size-4" />
          옷장
        </Link>
      </Button>

      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {category ? <Badge variant="outline">{category.name}</Badge> : null}
          {(item.tags ?? []).map((tag) => (
            <Badge key={tag} variant="secondary">
              #{tag}
            </Badge>
          ))}
        </div>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
            {item.title}
          </h1>
          <div className="max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
            <WardrobeRichDescription description={item.description} />
          </div>
        </div>
      </div>

      <div className="flex min-h-[50vh] items-center justify-center overflow-hidden rounded-lg border bg-muted/40 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt={item.title}
          className="max-h-[76vh] w-full object-contain"
        />
      </div>
    </section>
  );
}
