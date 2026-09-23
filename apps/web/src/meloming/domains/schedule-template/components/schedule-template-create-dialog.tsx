"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileImage, ImageIcon, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/meloming/shared/components/ui/tabs";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { useCreateScheduleTemplate } from "@/meloming/domains/schedule-template/hooks";
import type {
  ParsePsdResponse,
  TemplateSpecV1,
} from "@/meloming/domains/schedule-template/types";
import { coerceTemplateSpec } from "@/meloming/domains/schedule-template/components/editor/default-slots";
import {
  BaseImageUpload,
  type BaseImageUploadValue,
} from "./base-image-upload";
import { PsdUpload } from "./psd-upload";

// 백엔드 DTO(CreateScheduleTemplateRequest) 정합: name 1-100,
// baseImage* 필수, templateSpec 은 빈 v1 스펙으로 시작 (또는 PSD 로 채워짐).
const createFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "이름을 입력해주세요.")
    .max(100, "이름은 100자 이내로 입력해주세요."),
  isDefault: z.boolean(),
});

type CreateFormData = z.infer<typeof createFormSchema>;

// 빈 슬롯 스펙 — 이미지 업로드 경로 기본값. PSD 경로에서는 자동 추출 결과로 대체.
const EMPTY_TEMPLATE_SPEC: TemplateSpecV1 = { version: 1, slots: [] };

type SourceMode = "image" | "psd";

interface ScheduleTemplateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: number;
  channelIdentifier: string;
}

/**
 * 시간표 템플릿 생성 다이얼로그 (F3 + F8 Phase 1).
 *
 * 두 가지 입력 경로:
 *  1) 이미지 (PNG/JPEG): 사용자가 빈 templateSpec 으로 시작해 에디터에서 슬롯을 직접 배치.
 *  2) PSD: 텍스트 레이어를 자동으로 슬롯으로 추출. 이름/베이스/스펙 모두 자동 채움.
 *
 * 두 경로 모두 마지막엔 동일한 `POST /v1/schedule-templates` 로 저장된다 —
 * 차이는 templateSpec 의 초기값 + originalPsdUrl 보존 여부 뿐.
 *
 * 베이스 이미지/PSD 결과는 RHF 바깥의 useState 로 다루고 submit 시점에 수동 검증.
 * (file 업로드 + 치수 추출이 RHF 의 dirtyField 모델과 잘 맞지 않음.)
 */
export function ScheduleTemplateCreateDialog({
  open,
  onOpenChange,
  channelId,
  channelIdentifier,
}: ScheduleTemplateCreateDialogProps) {
  const router = useRouter();
  const createMutation = useCreateScheduleTemplate();
  const [sourceMode, setSourceMode] = useState<SourceMode>("image");
  const [baseImage, setBaseImage] = useState<BaseImageUploadValue | null>(null);
  // PSD 경로 전용 상태: 원본 PSD URL + 추출된 templateSpec 보존.
  // 이미지 경로에서는 둘 다 null/빈 스펙 으로 유지.
  const [originalPsdUrl, setOriginalPsdUrl] = useState<string | null>(null);
  const [psdTemplateSpec, setPsdTemplateSpec] =
    useState<TemplateSpecV1 | null>(null);

  const form = useForm<CreateFormData>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      name: "",
      isDefault: false,
    },
  });

  // 다이얼로그 close 시 모든 상태 리셋.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        form.reset({ name: "", isDefault: false });
        setBaseImage(null);
        setOriginalPsdUrl(null);
        setPsdTemplateSpec(null);
        setSourceMode("image");
      }
      onOpenChange(next);
    },
    [form, onOpenChange]
  );

  /**
   * 탭 전환 시 다른 경로에서 채워둔 PSD/베이스 이미지 상태를 초기화한다.
   * (사용자가 PSD → Image 로 옮긴 뒤 기존 PSD 결과가 그대로 제출되는 사고 방지.)
   */
  const handleTabChange = useCallback(
    (next: string) => {
      if (next !== "image" && next !== "psd") return;
      const mode = next as SourceMode;
      if (mode === sourceMode) return;
      setSourceMode(mode);
      setBaseImage(null);
      setOriginalPsdUrl(null);
      setPsdTemplateSpec(null);
    },
    [sourceMode]
  );

  const handlePsdParsed = useCallback(
    (result: ParsePsdResponse, file: File) => {
      // 1) 베이스 이미지: PSD 가 flatten 한 PNG 로 그대로 사용.
      setBaseImage({
        url: result.baseImageUrl,
        width: result.baseImageW,
        height: result.baseImageH,
      });
      // 2) 원본 PSD URL 보존 — 추후 재업로드 없이 재파싱/디버그 가능.
      setOriginalPsdUrl(result.originalPsdUrl);
      // 3) 자동 추출된 templateSpec — coerce 로 안전하게 V1 으로 좁힌다.
      //    백엔드가 v1 보장하지만 unknown 으로 받기 때문에 한 번 검증.
      setPsdTemplateSpec(coerceTemplateSpec(result.templateSpec));
      // 4) 이름이 비어 있을 때만 파일명 → 이름으로 자동 채움. 이미 사용자가
      //    입력했다면 덮어쓰지 않는다 (의도 보존).
      const currentName = form.getValues("name").trim();
      if (!currentName) {
        const derived = deriveTemplateNameFromFile(file);
        form.setValue("name", derived, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    },
    [form]
  );

  const isSubmitting = createMutation.isPending;
  const canSubmit = !!baseImage && !isSubmitting;

  const onSubmit = form.handleSubmit(async (values) => {
    if (!baseImage) {
      toast.error(
        sourceMode === "psd"
          ? "PSD 업로드가 필요합니다."
          : "베이스 이미지를 업로드해주세요."
      );
      return;
    }

    const templateSpecToSubmit =
      sourceMode === "psd" && psdTemplateSpec
        ? psdTemplateSpec
        : EMPTY_TEMPLATE_SPEC;

    try {
      const created = await createMutation.mutateAsync({
        channelId,
        name: values.name,
        isDefault: values.isDefault,
        baseImageUrl: baseImage.url,
        baseImageW: baseImage.width,
        baseImageH: baseImage.height,
        templateSpec: templateSpecToSubmit,
        // PSD 경로에서만 원본 URL 전송. 이미지 경로면 undefined → 미전송.
        ...(sourceMode === "psd" && originalPsdUrl
          ? { originalPsdUrl }
          : {}),
      });
      toast.success("시간표 템플릿을 만들었어요.");
      handleOpenChange(false);
      router.push(
        `/channel/${channelIdentifier}/manage/schedule-templates/${created.id}`
      );
    } catch (error) {
      toast.error(
        extractApiErrorMessage(
          error,
          "템플릿 생성에 실패했어요. 잠시 후 다시 시도해 주세요."
        )
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            시간표 템플릿 만들기
          </DialogTitle>
          <DialogDescription>
            이미지 또는 PSD 파일을 올리면 다음 단계 에디터에서 슬롯을 자유롭게
            편집할 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* 입력 경로 선택 */}
          <Tabs
            value={sourceMode}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <TabsList className="w-full">
              <TabsTrigger value="image" disabled={isSubmitting}>
                <ImageIcon className="size-4" />
                이미지 (PNG/JPEG)
              </TabsTrigger>
              <TabsTrigger value="psd" disabled={isSubmitting}>
                <FileImage className="size-4" />
                PSD 로 시작하기
              </TabsTrigger>
            </TabsList>

            <TabsContent value="image" className="mt-3">
              <BaseImageUpload
                label="베이스 이미지"
                description="시간표 배경으로 쓸 이미지를 업로드하세요. 이 이미지 위에 요일별 콘텐츠가 올라갑니다."
                value={baseImage}
                onChange={setBaseImage}
                disabled={isSubmitting}
              />
            </TabsContent>

            <TabsContent value="psd" className="mt-3 space-y-3">
              <PsdUpload
                onParsed={handlePsdParsed}
                disabled={isSubmitting}
              />
              {baseImage && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    PSD 파싱 결과 — 미리보기
                  </p>
                  <div className="relative rounded-md overflow-hidden border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={baseImage.url}
                      alt="PSD 변환 결과"
                      className="w-full max-h-64 object-contain"
                    />
                    <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white tabular-nums">
                      {baseImage.width} × {baseImage.height}
                    </div>
                  </div>
                  {psdTemplateSpec && (
                    <p className="text-xs text-muted-foreground">
                      자동 추출된 슬롯 {psdTemplateSpec.slots.length}개
                    </p>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* 이름 */}
          <div className="space-y-2">
            <Label htmlFor="schedule-template-name">이름</Label>
            <Input
              id="schedule-template-name"
              placeholder="예: 기본 주간 시간표"
              maxLength={100}
              disabled={isSubmitting}
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          {/* 기본 템플릿 토글 */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="schedule-template-is-default">
                기본 템플릿으로 설정
              </Label>
              <p className="text-xs text-muted-foreground">
                새 렌더링 생성 시 기본으로 선택됩니다. 채널당 하나만 기본으로
                지정할 수 있어요.
              </p>
            </div>
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <Switch
                  id="schedule-template-is-default"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isSubmitting}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  만드는 중…
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  만들기
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * PSD 파일명에서 ".psd" 확장자를 떼고 공백/하이픈/언더스코어를 정리해
 * 템플릿 이름으로 사용할 수 있는 한 줄 텍스트를 만든다.
 *
 * - 길이 100자 (DTO max) 초과 시 잘라낸다.
 * - 빈 문자열이면 "PSD 템플릿" fallback.
 */
function deriveTemplateNameFromFile(file: File): string {
  const raw = file.name.replace(/\.psd$/i, "").trim();
  if (!raw) return "PSD 템플릿";
  // 100자 초과 방지 — DTO Length(1, 100) 와 동일.
  return raw.slice(0, 100);
}
