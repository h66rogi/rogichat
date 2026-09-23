"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/meloming/shared/components/ui/alert";
import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";

/**
 * 에디터의 비정상 상태(로딩/에러) 화면들.
 *
 * editor.tsx 본체 분량을 300줄 이하로 유지하기 위해 분리.
 * `listHref` 를 받아 공통 '목록으로' 링크를 유지한다.
 */

export function EditorLoading({ listHref }: { listHref: string }) {
  return (
    <div className="p-6 space-y-4">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href={listHref}>
          <ArrowLeft className="size-3.5" />
          목록으로
        </Link>
      </Button>
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  );
}

interface EditorErrorProps {
  listHref: string;
  message: string;
  onRetry: () => void;
  retrying: boolean;
}

export function EditorError({
  listHref,
  message,
  onRetry,
  retrying,
}: EditorErrorProps) {
  return (
    <div className="p-6 space-y-4">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href={listHref}>
          <ArrowLeft className="size-3.5" />
          목록으로
        </Link>
      </Button>
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>에디터를 불러올 수 없어요.</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{message}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "다시 시도"
            )}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
