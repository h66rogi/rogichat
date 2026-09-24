"use client";

import { Settings, Plus, Trash2, Camera } from "lucide-react";
import { ManagementHeader } from "./management-header";
import { Input } from "@/meloming/shared/components/ui/input";
import { Button } from "@/meloming/shared/components/ui/button";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { useRouter, useParams } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useChannel,
  channelKeys,
  useChannelPermission,
  useChannelMusicbookSettings,
  useUpdateChannelMusicbookSettings,
  useCopyDifficultyToProficiency,
} from "@/meloming/domains/channel/hooks/use-channel";
import { songsKeys } from "@/meloming/domains/channel/hooks/use-songs";
import { putChannelIdentifier } from "@/meloming/domains/channel/apis/channels";
import type { PutChannelIdentifierRequestBody } from "@/meloming/domains/channel/types/channel";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { useRef, useState } from "react";
import { useUploadImage } from "@/meloming/shared/hooks/use-upload";
import ImageCropDialog from "@/meloming/shared/components/common/image-crop-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/meloming/shared/components/ui/avatar";
import {
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/meloming/shared/components/common/settings-form";

const additionalLinkSchema = z.object({
  name: z.string().min(1, "링크 이름을 입력해주세요."),
  url: z.string().url("올바른 URL 형식이 아닙니다."),
});

const channelSettingsSchema = z.object({
  name: z.string().min(1, "노래책 이름을 입력해주세요."),
  webPath: z.string(), // UI에서만 표시, 제출 시 사용 안 함 (API에는 기존값 유지)
  platformUrl: z.string().optional(), // 읽기 전용 (채널 인증을 통해 자동 설정)
  profileImageUrl: z
    .string()
    .refine((value) => value === "/images/hurogi-profile.png" || /^https:\/\//.test(value), "올바른 URL 형식이 아닙니다.")
    .or(z.literal(""))
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  additionalLinks: z
    .array(additionalLinkSchema)
    .max(5, "추가 링크는 최대 5개까지 입력할 수 있습니다.")
    .default([]),
  themeColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, "예: #3B82F6 형태의 HEX 컬러여야 합니다."),
  channelDescription: z
    .string()
    .optional()
    .transform((v) => v ?? ""),
  visibility: z.enum(["PUBLIC", "UNLISTED"]).default("PUBLIC"),
});

type ChannelSettingsFormValues = z.input<typeof channelSettingsSchema>;

export function SettingsSection() {
  const params = useParams();
  const identifier = (params?.user as string) || "";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: channel, isLoading } = useChannel(identifier);
  const { data: musicbookSettings } = useChannelMusicbookSettings(identifier);
  const updateMusicbookSettings =
    useUpdateChannelMusicbookSettings(identifier);
  const copyDifficultyToProficiency =
    useCopyDifficultyToProficiency(identifier);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [sourceMime, setSourceMime] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const { data: userPermission } = useChannelPermission(identifier);

  const handleUseProficiencyChange = async (checked: boolean) => {
    if (
      checked &&
      musicbookSettings &&
      !musicbookSettings.canEnableProficiencyAsPrimary
    ) {
      toast.error(
        `숙련도가 비어있는 곡이 ${musicbookSettings.songsMissingProficiency}곡 있습니다. 먼저 난이도를 숙련도로 복사하거나 곡별 숙련도를 입력해주세요.`,
      );
      return;
    }

    try {
      await updateMusicbookSettings.mutateAsync({
        useProficiencyAsPrimary: checked,
      });
      await queryClient.invalidateQueries({ queryKey: songsKeys.all });
      toast.success("노래책 설정이 저장되었습니다.");
    } catch (error) {
      toast.error(
        extractApiErrorMessage(error, "노래책 설정 저장 중 오류가 발생했습니다."),
      );
    }
  };

  const handleCopyDifficultyToProficiency = async () => {
    try {
      const result = await copyDifficultyToProficiency.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: songsKeys.all });
      toast.success(`${result.updatedCount}곡의 난이도를 숙련도로 복사했습니다.`);
    } catch (error) {
      toast.error(
        extractApiErrorMessage(error, "숙련도 복사 중 오류가 발생했습니다."),
      );
    }
  };

  const uploadImage = useUploadImage({
    onSuccess: (data) => {
      form.setValue("profileImageUrl", data.imageUrl, { shouldDirty: true });
      toast.success("이미지가 업로드되었습니다.");
    },
    onError: () => {
      toast.error(
        "이미지 업로드 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      );
    },
  });

  const form = useForm<ChannelSettingsFormValues>({
    resolver: zodResolver(channelSettingsSchema),
    values: {
      name: channel?.name ?? "",
      webPath: channel?.webPath ?? identifier,
      platformUrl: channel?.platformUrl ?? "",
      profileImageUrl: channel?.profileImageUrl ?? null,
      additionalLinks: channel?.additionalLinks ?? [],
      themeColor: channel?.themeColor ?? "#3B82F6",
      channelDescription: channel?.channelDescription ?? "",
      visibility: channel?.visibility ?? "PUBLIC",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "additionalLinks",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!channel) return;
    try {
      const sanitizedLinks = (values.additionalLinks ?? []).filter(
        (link: { name: string; url: string }) =>
          link.name.trim() !== "" && link.url.trim() !== "",
      );

      // API 타입이 전체 필드를 요구하므로, 폼에 없는 항목은 기존 값을 유지합니다.
      // platformUrl은 채널 인증을 통해서만 변경 가능하므로 기존 값 유지
      const finalBody: PutChannelIdentifierRequestBody = {
        name: values.name,
        webPath: values.webPath,
        platformUrl: channel.platformUrl ?? "",
        profileImageUrl: values.profileImageUrl ?? null,
        topBannerUrl: channel.topBannerUrl,
        leftBannerUrl: channel.leftBannerUrl,
        leftBannerLink: channel.leftBannerLink,
        rightBannerUrl: channel.rightBannerUrl,
        rightBannerLink: channel.rightBannerLink,
        additionalLinks: sanitizedLinks,
        themeColor: values.themeColor,
        channelDescription: values.channelDescription ?? "",
        visibility: values.visibility,
      } satisfies PutChannelIdentifierRequestBody;

      await putChannelIdentifier(identifier, finalBody);
      const newIdentifier = values.webPath.trim();

      if (newIdentifier !== identifier) {
        // 1) 기존 식별자 관련 쿼리 중단 및 제거 (불필요한 404 방지)
        await queryClient.cancelQueries({
          queryKey: channelKeys.identifier(identifier),
        });
        await queryClient.cancelQueries({
          queryKey: channelKeys.identifierPermission(identifier),
        });
        queryClient.removeQueries({
          queryKey: channelKeys.identifier(identifier),
        });
        queryClient.removeQueries({
          queryKey: channelKeys.identifierPermission(identifier),
        });

        // 2) 새 주소로 이동
        router.replace(`/channel/${newIdentifier}/manage/settings`);
        toast.success("채널 주소가 변경되었습니다. 새 주소로 이동합니다.");

        // 3) 새 식별자 관련 데이터만 invalidate하여 최신화
        await queryClient.invalidateQueries({
          queryKey: channelKeys.identifier(newIdentifier),
        });
        await queryClient.invalidateQueries({
          queryKey: channelKeys.identifierPermission(newIdentifier),
        });
      } else {
        // 식별자 변경이 없는 경우에만 현재 키 invalidate
        await queryClient.invalidateQueries({
          queryKey: channelKeys.identifier(identifier),
        });
        toast.success("채널 설정이 저장되었습니다.");
      }
    } catch (error) {
      console.error(error);
      const errorMsg = extractApiErrorMessage(
        error,
        "저장 중 오류가 발생했습니다.",
      );
      toast.error(errorMsg);
    }
  });

  if (userPermission && !userPermission.manageSettings) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="설정"
          description="채널 설정을 관리할 수 있습니다."
          icon={Settings}
        />

        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed text-muted-foreground text-center">
          접근 권한이 없습니다.
          <br />
          (채널 '설정 관리' 권한이 없습니다)
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="설정"
        description="채널 설정을 관리할 수 있습니다."
        icon={Settings}
      />

      <SettingsPanel contentClassName="min-h-[500px]">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">
              로딩 중...
            </div>
          ) : (
            <form onSubmit={onSubmit} className="max-w-4xl">
              <SettingsSectionHeader title="기본 정보" />

              <SettingsRow title="채널 프로필 이미지">
                  <div className="flex items-center gap-4">
                    <div
                      className="group relative size-20 cursor-pointer"
                      role="button"
                      aria-label="이미지 업로드"
                      title="클릭하여 이미지 업로드"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Avatar className="size-20">
                        <AvatarImage
                          src={form.watch("profileImageUrl") ?? undefined}
                          alt="channel profile"
                        />
                        <AvatarFallback>
                          {form.watch("name").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="pointer-events-none absolute inset-0 rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center">
                        <Camera className="text-white size-5" />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const mime = file.type;
                          const name = file.name;
                          if (mime === "image/gif") {
                            uploadImage.mutate({ image: file });
                            e.currentTarget.value = "";
                            return;
                          }
                          const objectUrl = URL.createObjectURL(file);
                          setCropImageSrc(objectUrl);
                          setSourceMime(mime);
                          setSourceFileName(name);
                          setIsCropOpen(true);
                          e.currentTarget.value = ""; // 같은 파일 재선택 가능하도록 초기화
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadImage.isPending}
                      >
                        {uploadImage.isPending ? "업로드 중..." : "이미지 선택"}
                      </Button>
                      {form.watch("profileImageUrl") && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            form.setValue("profileImageUrl", null, {
                              shouldDirty: true,
                            })
                          }
                        >
                          이미지 제거
                        </Button>
                      )}
                    </div>
                  </div>
              </SettingsRow>

              <SettingsRow title="채널 이름">
                <div className="space-y-2">
                  <Input id="name" {...form.register("name")} />
                  {form.formState.errors.name && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>
              </SettingsRow>

              <SettingsRow
                title="채널 주소"
                description="후로기 채널의 고정 주소입니다"
              >
                <div className="space-y-2">
                <div className="flex h-9 w-full items-center rounded-md border border-input bg-transparent text-base shadow-xs md:text-sm">
                  <span
                    className="px-3 whitespace-nowrap select-none text-muted-foreground border-r border-input h-full items-center sm:flex hidden"
                    aria-hidden
                  >
                    /channel/
                  </span>
                  <input
                    id="webPath"
                    {...form.register("webPath")}
                    readOnly
                    className="flex-1 bg-transparent px-3 outline-none disabled:cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  채널 주소는 현재 변경할 수 없습니다.
                </p>
              </div>
              </SettingsRow>

              <SettingsRow
                title="방송 플랫폼 주소"
                description="채널 인증을 통해 자동으로 설정됩니다"
              >
                <div className="space-y-2">
                <Input
                  id="platformUrl"
                  placeholder="https://..."
                  value={form.watch("platformUrl") || ""}
                  disabled
                  className="bg-muted cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground">
                  방송 플랫폼 주소는 채널 인증을 통해 자동으로 설정됩니다.
                  <br />
                  채널 인증은 '채널 인증' 메뉴에서 진행할 수 있습니다.
                </p>
              </div>
              </SettingsRow>

              <SettingsSectionHeader title="채널 표시 정보" />

              <SettingsRow title="추가 링크" description={`${fields.length}/5`}>
                <div className="space-y-3">
                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (fields.length >= 5) {
                        toast.info(
                          "추가 링크는 최대 5개까지 추가할 수 있어요.",
                        );
                        return;
                      }
                      append({ name: "", url: "" });
                    }}
                    disabled={fields.length >= 5}
                  >
                    <Plus className="h-4 w-4 mr-1" /> 링크 추가
                  </Button>
                </div>

                <div className="space-y-3">
                  {fields.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      추가 링크가 없습니다. 필요 시 추가해주세요.
                    </p>
                  )}
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="grid grid-cols-1 md:grid-cols-12 gap-2"
                    >
                      <div className="md:col-span-3">
                        <Input
                          placeholder="이름"
                          {...form.register(
                            `additionalLinks.${index}.name` as const,
                          )}
                        />
                        {form.formState.errors.additionalLinks?.[index]
                          ?.name && (
                          <p className="text-xs text-destructive mt-1">
                            {
                              form.formState.errors.additionalLinks?.[index]
                                ?.name?.message as string
                            }
                          </p>
                        )}
                      </div>
                      <div className="md:col-span-8">
                        <Input
                          placeholder="https://..."
                          {...form.register(
                            `additionalLinks.${index}.url` as const,
                          )}
                        />
                        {form.formState.errors.additionalLinks?.[index]
                          ?.url && (
                          <p className="text-xs text-destructive mt-1">
                            {
                              form.formState.errors.additionalLinks?.[index]
                                ?.url?.message as string
                            }
                          </p>
                        )}
                      </div>
                      <div className="md:col-span-1 flex items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          aria-label="링크 삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </SettingsRow>

              <SettingsRow title="테마 색상">
                <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    id="themeColor"
                    {...form.register("themeColor")}
                    className="max-w-[140px]"
                    placeholder="#3B82F6"
                  />
                  <input
                    type="color"
                    aria-label="테마 색상 선택"
                    value={form.watch("themeColor")}
                    onChange={(e) =>
                      form.setValue("themeColor", e.target.value)
                    }
                    className="h-9 w-9 rounded-md border bg-transparent p-0"
                  />
                </div>
                {form.formState.errors.themeColor && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.themeColor.message}
                  </p>
                )}
              </div>
              </SettingsRow>

              <SettingsRow title="노래책 공지">
                <Textarea
                  id="channelDescription"
                  rows={5}
                  placeholder="노래책 상단에 표시될 공지사항을 입력하세요."
                  {...form.register("channelDescription")}
                />
              </SettingsRow>

              <SettingsSectionHeader title="노출 설정" />

              <SettingsRow
                title="노래책 기본 별점"
                description="켜면 노래책 카드와 필터에서 난이도 대신 숙련도를 사용합니다"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        난이도 대신 숙련도 기본 사용
                      </p>
                      <p className="text-xs text-muted-foreground">
                        켜진 동안 노래 추가 시 난이도와 숙련도를 모두 입력해야
                        합니다.
                      </p>
                    </div>
                    <Switch
                      checked={
                        musicbookSettings?.useProficiencyAsPrimary ?? false
                      }
                      disabled={
                        updateMusicbookSettings.isPending ||
                        !musicbookSettings
                      }
                      onCheckedChange={handleUseProficiencyChange}
                      aria-label="난이도 대신 숙련도 기본 사용"
                    />
                  </div>

                  {musicbookSettings && (
                    <div className="rounded-md bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                      <span className="block pb-1">
                        {musicbookSettings.hasExplicitUseProficiencyAsPrimary
                          ? "현재 사용자가 명시적으로 저장한 설정입니다."
                          : "현재 기본값은 꺼짐입니다."}
                      </span>
                      전체 {musicbookSettings.totalSongs}곡 중 숙련도 미입력{" "}
                      {musicbookSettings.songsMissingProficiency}곡
                      {!musicbookSettings.canEnableProficiencyAsPrimary && (
                        <span className="block pt-1 text-destructive">
                          모든 곡에 숙련도가 있어야 이 옵션을 켤 수 있습니다.
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCopyDifficultyToProficiency}
                      disabled={copyDifficultyToProficiency.isPending}
                    >
                      {copyDifficultyToProficiency.isPending
                        ? "복사 중..."
                        : "난이도를 숙련도로 복사"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      기존 숙련도 값은 무시하고 난이도 값으로 덮어씁니다.
                    </p>
                  </div>
                </div>
              </SettingsRow>

              <SettingsRow
                title="채널 공개 범위"
                description={
                  <>
                    &apos;링크 공유만&apos;으로 설정하면 검색 결과, 인기 채널,
                    전체 목록에 노출되지 않으며 싱크룸 방에 참여할 수 없습니다
                  </>
                }
              >
                <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="PUBLIC"
                      {...form.register("visibility")}
                      className="accent-primary"
                    />
                    <span className="text-sm">공개</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="UNLISTED"
                      {...form.register("visibility")}
                      className="accent-primary"
                    />
                    <span className="text-sm">링크 공유만</span>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  &apos;링크 공유만&apos;으로 설정하면 채널이 검색 결과, 인기
                  채널, 전체 목록에 노출되지 않습니다.
                  <br />
                  채널 링크를 직접 공유하면 누구나 채널에 접속할 수 있습니다.
                  <br />
                  &apos;링크 공유만&apos;으로 설정하면 싱크룸 방에 참여할 수
                  없습니다.
                </p>
              </div>
              </SettingsRow>

              <div className="flex justify-end py-4">
                <Button type="submit">저장</Button>
              </div>
            </form>
          )}
      </SettingsPanel>

      <ImageCropDialog
        open={isCropOpen}
        imageSrc={cropImageSrc}
        outputType={(function deriveOutputType(
          mime: string | null,
        ): "image/jpeg" | "image/png" | "image/webp" {
          if (!mime) return "image/jpeg";
          if (mime === "image/png") return "image/png";
          if (mime === "image/webp") return "image/webp";
          return "image/jpeg";
        })(sourceMime)}
        onOpenChange={(open) => {
          if (!open) {
            if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
            setIsCropOpen(false);
            setCropImageSrc(null);
            setSourceMime(null);
            setSourceFileName(null);
          }
        }}
        onCancel={() => {
          if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
          setIsCropOpen(false);
          setCropImageSrc(null);
          setSourceMime(null);
          setSourceFileName(null);
        }}
        onConfirm={async (blob) => {
          const outputType = (function deriveOutputType(
            mime: string | null,
          ): "image/jpeg" | "image/png" | "image/webp" {
            if (!mime) return "image/jpeg";
            if (mime === "image/png") return "image/png";
            if (mime === "image/webp") return "image/webp";
            return "image/jpeg";
          })(sourceMime);
          const toFile = (
            b: Blob,
            originalName: string | null,
            outType: string,
          ): File => {
            const base = (originalName ?? "image").replace(/\.[^.]+$/, "");
            const ext =
              outType === "image/png"
                ? "png"
                : outType === "image/webp"
                  ? "webp"
                  : "jpg";
            return new File([b], `${base}-cropped.${ext}`, { type: outType });
          };
          const file = toFile(blob, sourceFileName, outputType);
          uploadImage.mutate({ image: file });
          if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
          setIsCropOpen(false);
          setCropImageSrc(null);
          setSourceMime(null);
          setSourceFileName(null);
        }}
      />
    </div>
  );
}
