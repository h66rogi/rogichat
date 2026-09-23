"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Image as ImageIcon, Pencil, Star, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import type { ScheduleTemplate } from "@/meloming/domains/schedule-template/types";

interface ScheduleTemplateCardProps {
  template: ScheduleTemplate;
  /** 편집 페이지로 이동할 때 쓸 채널 identifier (URL `[user]` 세그먼트) */
  channelIdentifier: string;
  onDelete: (template: ScheduleTemplate) => void;
}

/**
 * 시간표 템플릿 카드.
 *
 * 썸네일 폴백 규칙(F10): `thumbnailUrl` → `baseImageUrl` → placeholder.
 *  - `thumbnailUrl`: 백엔드가 baseImageUrl 변경 시 자동 생성하는 320px webp.
 *    list grid 에서 바이트/렌더 비용 모두 적음. fire-and-forget 으로 만들어
 *    한동안 null 일 수 있고, 그 사이는 baseImageUrl 로 fallback.
 *  - `baseImageUrl`: 원본 풀해상도. 썸네일이 아직 없거나 생성 실패 시 사용.
 *  - 그 외: placeholder 아이콘.
 *
 * srcSet 미사용 (Codex F10 review):
 *  과거에는 retina 보정 명목으로 `<img srcSet="thumb 1x, base 2x">` 를 썼지만
 *  2x 디바이스에서 풀해상도 baseImageUrl 까지 다시 받아오는 셈이라 thumbnail
 *  자체의 bandwidth 절감 목적을 무력화한다. 따라서 srcSet 은 없애고 thumbnail
 *  하나만 쓴다 — 320px 폭 webp 가 기본 16:9 카드 (실제 약 320~360px CSS 폭)
 *  에서 2x 디바이스에도 시각적으로 충분히 선명하다.
 *
 * 업데이트 시각은 `formatDistanceToNow` 로 상대 시간 표시.
 */
export function ScheduleTemplateCard({
  template,
  channelIdentifier,
  onDelete,
}: ScheduleTemplateCardProps) {
  // 1순위: thumbnailUrl, 2순위: baseImageUrl, 둘 다 없으면 placeholder.
  const previewUrl = template.thumbnailUrl ?? template.baseImageUrl ?? null;

  const relativeUpdated = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(template.updatedAt), {
        addSuffix: true,
        locale: ko,
      });
    } catch {
      return template.updatedAt;
    }
  }, [template.updatedAt]);

  const editHref = `/channel/${channelIdentifier}/manage/schedule-templates/${template.id}`;

  return (
    <Card className="overflow-hidden py-0 gap-0 flex flex-col">
      {/* 썸네일 */}
      <Link
        href={editHref}
        className="relative block aspect-[16/9] bg-muted overflow-hidden group"
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={template.name}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="size-8" />
          </div>
        )}
        {template.isDefault && (
          <Badge className="absolute top-2 left-2 gap-1 bg-amber-500/90 text-white hover:bg-amber-500 border-0">
            <Star className="size-3" />
            기본
          </Badge>
        )}
      </Link>

      <CardContent className="flex flex-col gap-3 p-4 flex-1">
        <div className="space-y-1">
          <Link
            href={editHref}
            className="font-medium line-clamp-1 hover:underline"
            title={template.name}
          >
            {template.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {relativeUpdated} · {template.baseImageW} × {template.baseImageH}
          </p>
        </div>

        <div className="flex items-center gap-2 mt-auto">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="flex-1"
          >
            <Link href={editHref}>
              <Pencil className="size-3.5" />
              편집
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDelete(template)}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`${template.name} 삭제`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
