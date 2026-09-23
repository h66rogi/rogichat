"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shirt } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { cn } from "@/meloming/shared/lib/utils";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { useChannelWardrobe } from "@/meloming/domains/channel/hooks/use-wardrobe";
import { getWardrobeAspectRatioStyle } from "@/meloming/domains/channel/utils/wardrobe-aspect-ratio";
import { extractWardrobeDescriptionText } from "@/meloming/domains/channel/utils/wardrobe-description";

export function ChannelWardrobeContent({ user }: { user: string }) {
  const { data: channel } = useChannel(user);
  const { data: wardrobe, isLoading } = useChannelWardrobe(user);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const isWide = channel?.layoutWidth === "wide";

  const categories = wardrobe?.categories ?? [];
  const items = wardrobe?.items ?? [];

  useEffect(() => {
    if (categories.length === 0) {
      setActiveCategoryId(null);
      return;
    }
    if (
      !activeCategoryId ||
      !categories.some((category) => category.id === activeCategoryId)
    ) {
      setActiveCategoryId(categories[0].id);
    }
  }, [activeCategoryId, categories]);

  const visibleItems = useMemo(() => {
    if (!activeCategoryId) return items;
    return items.filter((item) => item.categoryId === activeCategoryId);
  }, [activeCategoryId, items]);
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  if (isLoading) {
    return (
      <section
        className={cn(!isWide && "container", "mx-auto mt-8 px-4 md:px-6")}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[4/3] rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(!isWide && "container", "mx-auto mt-8 px-4 md:px-6")}
    >
      {categories.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {categories.map((category) => (
            <Button
              key={category.id}
              type="button"
              size="sm"
              variant={
                category.id === activeCategoryId ? "default" : "secondary"
              }
              className="rounded-full"
              onClick={() => setActiveCategoryId(category.id)}
            >
              {category.name}
            </Button>
          ))}
        </div>
      ) : null}

      {visibleItems.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-16 text-center text-muted-foreground">
          <Shirt className="size-10 opacity-40" />
          <p className="text-sm">등록된 옷장 항목이 없습니다.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleItems.map((item) => {
            const category = categoryById.get(item.categoryId);
            const descriptionText = extractWardrobeDescriptionText(
              item.description,
            );
            const tags = item.tags?.slice(0, 3) ?? [];
            return (
              <Link
                key={item.id}
                href={`/channel/${user}/wardrobe/${item.id}`}
                className="group overflow-hidden rounded-lg border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div
                  className="overflow-hidden bg-muted"
                  style={getWardrobeAspectRatioStyle(
                    category?.defaultAspectRatio,
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
                <div className="space-y-1 p-4">
                  <h2 className="line-clamp-1 text-base font-semibold">
                    {item.title}
                  </h2>
                  {descriptionText ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {descriptionText}
                    </p>
                  ) : null}
                  {tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
