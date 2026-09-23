/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import type { Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  Star,
  Check,
  Search,
  Loader2,
  Film,
  X,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { resolveClipUrl } from "@/meloming/domains/clip/apis/clips";
import type { ClipPendingData } from "@/meloming/domains/clip/types/clip";
import { Toggle } from "@/meloming/shared/components/ui/toggle";
import { Switch } from "@/meloming/shared/components/ui/switch";
import SearchableCombobox from "./searchable-combobox";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import { useUserArtists } from "@/meloming/domains/channel/hooks/use-artists";
import { useArtistsManagement } from "@/meloming/domains/channel/hooks/use-artists-management";
import { useCategoriesManagement } from "@/meloming/domains/channel/hooks/use-categories-management";
import {
  useImageSearch,
  useSongTitleAutocomplete,
  useSongArtistSuggestions,
} from "@/meloming/domains/channel/hooks/use-songs";
import {
  deleteSongMrVideo,
  SONG_MR_VIDEO_MAX_BYTES,
  uploadSongMrVideo,
} from "@/meloming/domains/channel/apis/songs";
import {
  useChannel,
  useChannelMusicbookSettings,
} from "@/meloming/domains/channel/hooks/use-channel";
import { useQueryClient } from "@tanstack/react-query";
import { artistsKeys } from "@/meloming/domains/channel/hooks/use-artists";
import { categoriesKeys } from "@/meloming/domains/channel/hooks/use-categories";
import { songsKeys } from "@/meloming/domains/channel/hooks/use-songs";
import type { ImageSearchRequest } from "@/meloming/domains/channel/types/image-search";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import CategoryEditDialog from "@/meloming/shared/components/common/category-edit-dialog";
import InlineYoutubeSearch from "./inline-youtube-search";
import InlineWebSearch from "./inline-web-search";
import { DEFAULT_CATEGORY_COLORS } from "@/meloming/shared/constants/category";
import { ImageDropzone } from "@/meloming/shared/components/common/image-dropzone";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";
import { useDebounce } from "@/meloming/shared/hooks/use-debounce";

import {
  createSongFormSchema,
  type SongFormValues,
} from "./song-form.schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/meloming/shared/components/ui/card";
import { usePricingSettings } from "@/meloming/domains/channel/hooks/use-pricing-settings";
import type { CurrencyConfig } from "@/meloming/domains/channel/types/pricing";
import {
  calculateSongPrice,
  PRICE_SOURCE_LABELS,
} from "@/meloming/domains/channel/utils/song-price";
import { sanitizeCurrencyPriceMap } from "@/meloming/domains/channel/utils/sanitize-currency-price-map";
import { SheetMusicSection } from "@/meloming/domains/channel/components/sheet-music";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import { SettingsRow } from "@/meloming/shared/components/common/settings-form";

/**
 * onSubmit / onSaveAndContinue 결과 타입.
 * 부분 실패(예: song POST 성공 + sheet upload 실패) 를 부모가 알리고, 폼 초기화/이동 여부를
 * 호출자(SongFormV2 내부) 가 결정할 수 있도록 옵션을 제공한다. 반환하지 않으면 기존 동작
 * (정상 완료로 간주, 저장하고 계속 흐름에서는 form reset).
 */
export type SongFormSubmitResult = void | {
  /** 저장하고 계속 흐름에서 form.reset 을 건너뛸지 여부. true 면 reset skip. */
  skipReset?: boolean;
};

interface SongFormProps {
  identifier: string; // channel webPath (username)
  channelId?: number; // required for creating artists/categories
  initialValues?: Partial<SongFormValues>;
  onSubmit?: (values: SongFormValues) => Promise<void | SongFormSubmitResult>;
  submitLabel?: string;
  onSaveAndContinue?: (
    values: SongFormValues
  ) => Promise<void | SongFormSubmitResult>;
  validationMode?: "strict" | "relaxed";
  /** 요청 모드: true일 때 아티스트/카테고리 생성 API 호출 안 함, "(추가예정)" 표시 */
  requestMode?: boolean;
  /** 제출 버튼 숨기기 */
  hideSubmitButton?: boolean;
  /** 폼 값 변경 시 호출 */
  onValuesChange?: (values: SongFormValues) => void;
  /** 클립 추가 기능 활성화 여부 */
  enableClipAdd?: boolean;
  /** 클립 추가 예정 데이터 변경 시 콜백 */
  onClipPendingChange?: (data: ClipPendingData | null) => void;
  /**
   * 수정 모드일 때 대상 노래 id. 새 노래 생성 흐름에서는 undefined.
   * 설정되면 SheetMusicSection이 즉시(server endpoint 직접 호출) 모드로 동작한다.
   * undefined 면 pending 모드(부모가 song POST 후 직접 업로드).
   */
  editingSongId?: number;
  /**
   * 신규 곡 생성 흐름에서 사용자가 임시로 선택한 악보 파일. (mode === pending)
   * 부모(add-song-manual-content)가 form submit 시 업로드한다.
   */
  pendingSheetMusicFile?: File | null;
  /**
   * 신규 곡 생성 흐름에서 사용자가 악보 파일을 선택/제거하면 호출.
   */
  onPendingSheetMusicFileChange?: (file: File | null) => void;
  /**
   * react-hook-form 의 isDirty 가 변할 때 호출 (M3 unsaved guard 용).
   * 부모가 페이지 이탈 가드를 결정한다.
   */
  onDirtyChange?: (isDirty: boolean) => void;
}

type OptionalFieldKey =
  | "proficiency"
  | "songKey"
  | "bpm"
  | "karaokeUrl"
  | "originalUrl"
  | "mrVideo"
  | "coverUrl"
  | "lyricsLink"
  | "lyricsText"
  | "description"
  | "sheetMusic";

const OPTIONAL_FIELDS: Array<{ key: OptionalFieldKey; label: string }> = [
  { key: "proficiency", label: "숙련도" },
  { key: "songKey", label: "키" },
  { key: "bpm", label: "BPM" },
  { key: "karaokeUrl", label: "노래방 주소" },
  { key: "originalUrl", label: "원곡 유튜브 링크" },
  { key: "mrVideo", label: "MR 영상" },
  { key: "coverUrl", label: "본인 커버 링크" },
  { key: "lyricsLink", label: "가사 링크" },
  { key: "description", label: "설명" },
  { key: "lyricsText", label: "메모 (가사)" },
  { key: "sheetMusic", label: "악보" },
];

const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5] as const;

function normalizeCurrencyConfigs(
  currencyConfigs: CurrencyConfig[] | null | undefined
): Array<{ key: string; unit: string }> {
  return (currencyConfigs ?? []).filter(
    (config) => config.key?.trim() && config.unit?.trim()
  );
}

const SongFormLabel = ({
  htmlFor,
  name,
  description,
  isRequired,
  hideRequired,
}: {
  htmlFor: string;
  name: string;
  description?: string;
  isRequired: boolean;
  hideRequired?: boolean;
}) => {
  return (
    <Label htmlFor={htmlFor} className="mb-2 flex flex-col items-start gap-1">
      <div className="flex items-baseline gap-1">
        <span className={isRequired ? "font-semibold" : "font-medium"}>
          {name}
        </span>
        {isRequired && !hideRequired ? " *" : ""}
        {!hideRequired && (
          <span className="text-xs text-muted-foreground">
            {isRequired ? "(필수)" : "(선택)"}
          </span>
        )}
      </div>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </Label>
  );
};

//

export function SongFormV2({
  identifier,
  channelId,
  initialValues,
  onSubmit,
  submitLabel = "저장",
  onSaveAndContinue,
  validationMode = "strict",
  requestMode = false,
  hideSubmitButton = false,
  onValuesChange,
  enableClipAdd = false,
  onClipPendingChange,
  editingSongId,
  pendingSheetMusicFile,
  onPendingSheetMusicFileChange,
  onDirtyChange,
}: SongFormProps) {
  const { data: categories } = useUserCategories(identifier);
  const { data: artists } = useUserArtists(identifier);
  const { createArtist } = useArtistsManagement(channelId ?? 0, {
    enabled: (channelId ?? 0) > 0,
  });
  const { createCategory } = useCategoriesManagement(channelId ?? 0, {
    enabled: (channelId ?? 0) > 0,
  });
  const { data: pricingSettings } = usePricingSettings(channelId);
  const { data: musicbookSettings } = useChannelMusicbookSettings(identifier);
  const requireProficiency =
    musicbookSettings?.useProficiencyAsPrimary ?? false;
  const formSchema = useMemo(
    () =>
      createSongFormSchema({
        relaxed: validationMode === "relaxed",
        requireProficiency,
      }),
    [requireProficiency, validationMode]
  );

  // NOTE: relaxed일 때도 내부 form 타입은 SongFormValues로 유지하되 resolver만 완화 스키마로 교체
  const form = useForm<SongFormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<SongFormValues>,
    mode: "onChange",
    defaultValues: {
      title: initialValues?.title ?? "",
      artistName: initialValues?.artistName ?? "",
      categoryNames: initialValues?.categoryNames ?? [],
      albumArt: initialValues?.albumArt ?? "",
      karaokeUrl: initialValues?.karaokeUrl ?? "",
      coverUrl: initialValues?.coverUrl ?? "",
      originalUrl: initialValues?.originalUrl ?? "",
      mrVideoUrl: initialValues?.mrVideoUrl ?? null,
      mrVideoKey: initialValues?.mrVideoKey ?? null,
      lyricsLink: initialValues?.lyricsLink ?? "",
      bpm: initialValues?.bpm ?? undefined,
      difficulty: initialValues?.difficulty ?? 1,
      proficiency: initialValues?.proficiency ?? undefined,
      songKey: initialValues?.songKey ?? "",
      lyricsText: initialValues?.lyricsText ?? "",
      description: initialValues?.description ?? "",
      price: initialValues?.price ?? undefined,
      currencyPrices: sanitizeCurrencyPriceMap(initialValues?.currencyPrices) ?? null,
    },
  });

  // 제목과 아티스트로 실행하는 연관 이미지 검색 상태
  const [imageSearchBody, setImageSearchBody] = useState<
    ImageSearchRequest | undefined
  >(undefined);
  // 이미지 로딩 에러 추적
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(
    new Set()
  );
  const [showTitleSuggestions, setShowTitleSuggestions] = useState(false);

  // 클립 추가 상태
  const [clipPendingData, setClipPendingData] = useState<ClipPendingData | null>(null);
  const [isResolvingClipUrl, setIsResolvingClipUrl] = useState(false);
  const [mrVideoUrl, setMrVideoUrl] = useState<string | null>(
    initialValues?.mrVideoUrl ?? null
  );
  const [isMrVideoUploading, setIsMrVideoUploading] = useState(false);
  const [isMrVideoDeleting, setIsMrVideoDeleting] = useState(false);
  const [mrVideoUploadProgress, setMrVideoUploadProgress] = useState<number | null>(null);

  useEffect(() => {
    setMrVideoUrl(initialValues?.mrVideoUrl ?? null);
  }, [initialValues?.mrVideoUrl]);

  // 악보 (Round 2 migration):
  // 업로드/삭제는 SheetMusicSection 이 새 channel-scoped endpoint 를 직접 호출.
  // form state 에서 관리하지 않고, PATCH body 에도 포함하지 않는다. parent 는
  // invalidateQueries 만 담당.

  // 채널 이름 (커버 URL 검색어 prefix 로 사용. identifier 기반 조회이므로
  // 부모가 channel 정보를 미리 로드했다면 React Query 캐시 히트)
  const { data: channelData } = useChannel(identifier);
  const channelName = channelData?.name ?? "";
  const imageSearchQuery = useImageSearch(imageSearchBody, {
    enabled: Boolean(imageSearchBody),
    staleTime: 30 * 1000,
  });
  // 깨진 이미지와 중복 URL을 제외한 공개 이미지 검색 결과
  const searchResults = useMemo(() => {
    const imageItems = (imageSearchQuery.data?.images ?? []).map((img) => ({
      title: img.title,
      artist: "",
      album: "",
      albumArt: img.imageUrl,
      displayArtist: "",
      displayAlbum: "",
    }));
    const combined = [...imageItems];
    const seen = new Set<string>();
    const unique: typeof combined = [];
    for (const item of combined) {
      const key = item.albumArt || "";
      if (!key) continue;
      if (seen.has(key)) continue;
      // 에러난 이미지 제외
      if (failedImageUrls.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }, [imageSearchQuery.data, failedImageUrls]);

  const selectedAlbumArt = form.watch("albumArt") ?? "";
  const difficulty = form.watch("difficulty") ?? 1;
  const proficiency = form.watch("proficiency");
  const coverUrlValue = form.watch("coverUrl") ?? "";
  const priceValue = form.watch("price");
  const currencyPricesValue = form.watch("currencyPrices");
  const titleField = form.register("title");
  const [title, artistName, categoryNames] = form.watch([
    "title",
    "artistName",
    "categoryNames",
  ]);
  const normalizedCurrencyPricesValue = useMemo(
    () => sanitizeCurrencyPriceMap(currencyPricesValue),
    [currencyPricesValue]
  );

  const selectedCurrencyConfigs = useMemo(
    () => normalizeCurrencyConfigs(pricingSettings?.currencyConfigs),
    [pricingSettings?.currencyConfigs]
  );

  // 예상 금액 계산
  const expectedPrice = useMemo(() => {
    const selectedCategories =
      categories?.filter((category) =>
        (categoryNames ?? []).includes(category.name)
      ) ?? [];
    return calculateSongPrice(
      {
        price: typeof priceValue === "number" ? priceValue : null,
        currencyPrices: normalizedCurrencyPricesValue,
        difficulty,
        categories: selectedCategories,
      },
      pricingSettings
    );
  }, [
    difficulty,
    categoryNames,
    categories,
    pricingSettings,
    priceValue,
    normalizedCurrencyPricesValue,
  ]);

  const expectedPriceByCurrency = useMemo(() => {
    if (!pricingSettings?.pricingEnabled || selectedCurrencyConfigs.length === 0) {
      return [];
    }

    const selectedCategories =
      categories?.filter((category) =>
        (categoryNames ?? []).includes(category.name)
      ) ?? [];
    return selectedCurrencyConfigs.map((config) => {
      const result = calculateSongPrice(
        {
          price: typeof priceValue === "number" ? priceValue : null,
          currencyPrices: normalizedCurrencyPricesValue,
          difficulty,
          categories: selectedCategories,
        },
        pricingSettings,
        config.key
      );
      return { ...result, unit: config.unit };
    });
  }, [
    pricingSettings,
    selectedCurrencyConfigs,
    categories,
    categoryNames,
    normalizedCurrencyPricesValue,
    difficulty,
    priceValue,
  ]);
  const debouncedTitle = useDebounce(title ?? "", 250);

  const titleAutocompleteQuery = useSongTitleAutocomplete(
    identifier,
    { query: debouncedTitle || undefined, limit: 8, scope: "global" },
    {
      enabled:
        identifier.length > 0 && debouncedTitle.trim().length > 0,
    }
  );

  const artistSuggestQuery = useSongArtistSuggestions(
    identifier,
    { title: debouncedTitle, limit: 5, scope: "global" },
    {
      enabled:
        identifier.length > 0 &&
        debouncedTitle.trim().length > 0 &&
        !(artistName || "").trim(),
    }
  );

  const titleSuggestions = useMemo(() => {
    const items = titleAutocompleteQuery.data?.suggestions ?? [];
    const seen = new Set<string>();
    const unique: typeof items = [];
    for (const item of items) {
      const key = item.title.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }, [titleAutocompleteQuery.data]);

  const artistSuggestions = useMemo(() => {
    const items = artistSuggestQuery.data?.suggestions ?? [];
    const map = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      const key = item.artistName.toLowerCase().replace(/\s+/g, "");
      const existing = map.get(key);
      if (!existing) {
        map.set(key, item);
        continue;
      }
      if ((item.matchCount ?? 0) > (existing.matchCount ?? 0)) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  }, [artistSuggestQuery.data]);

  const artistNameSet = useMemo(
    () =>
      new Set(
        (artists ?? []).map((a: { name: string }) =>
          a.name.toLowerCase().replace(/\s+/g, "")
        )
      ),
    [artists]
  );

  const handleArtistSuggestionSelect = async (name: string) => {
    form.setValue("artistName", name, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (requestMode || !channelId) return;
    const key = name.toLowerCase().replace(/\s+/g, "");
    if (artistNameSet.has(key)) return;
    try {
      const res = await createArtist.mutateAsync({ name });
      await queryClient.invalidateQueries({
        queryKey: artistsKeys.user(identifier),
      });
      form.setValue("artistName", res.name, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } catch {
      toast.error("아티스트 추가에 실패했습니다.");
    }
  };

  // 폼 값 변경 시 부모에게 알림 (subscription 방식)
  useEffect(() => {
    if (!onValuesChange) return;

    const subscription = form.watch((values) => {
      onValuesChange(values as SongFormValues);
    });

    return () => subscription.unsubscribe();
  }, [form, onValuesChange]);

  // M3: form dirty 상태를 부모에게 알림 (unsaved guard 용)
  // formState 가 변경될 때마다 트리거되도록 form.formState.isDirty 를 deps 에 포함.
  const formIsDirty = form.formState.isDirty;
  useEffect(() => {
    onDirtyChange?.(formIsDirty);
  }, [formIsDirty, onDirtyChange]);

  // coverUrl 변경 시 clipPendingData 초기화
  useEffect(() => {
    if (clipPendingData && coverUrlValue !== clipPendingData.url) {
      setClipPendingData(null);
      onClipPendingChange?.(null);
    }
  }, [coverUrlValue, clipPendingData, onClipPendingChange]);

  // duration 포맷 유틸리티
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // 클립 URL resolve 함수
  const handleResolveClipUrl = async () => {
    const coverUrl = form.getValues("coverUrl");
    if (!coverUrl) return;

    setIsResolvingClipUrl(true);
    try {
      const result = await resolveClipUrl({ url: coverUrl });
      const pendingData: ClipPendingData = {
        resolvedData: result,
        url: coverUrl,
        publishToHotClip: true,
      };
      setClipPendingData(pendingData);
      onClipPendingChange?.(pendingData);
      toast.success("영상 정보 확인 완료! 노래 저장 시 클립도 함께 추가됩니다.");
    } catch {
      toast.error("영상 정보를 불러오는데 실패했습니다. URL을 확인해주세요.");
      setClipPendingData(null);
      onClipPendingChange?.(null);
    } finally {
      setIsResolvingClipUrl(false);
    }
  };

  // 클립 추가 취소
  const handleCancelClipAdd = () => {
    setClipPendingData(null);
    onClipPendingChange?.(null);
  };

  const handleClipPublishToHotClipChange = (checked: boolean) => {
    setClipPendingData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, publishToHotClip: checked };
      onClipPendingChange?.(next);
      return next;
    });
  };
  // const canSubmit = (() => {
  //   const hasTitle = (title?.trim()?.length ?? 0) > 0;
  //   if (validationMode === "relaxed") {
  //     return hasTitle;
  //   }
  //   const hasArtist = (artistName?.trim()?.length ?? 0) > 0;
  //   const hasCategory = (categoryNames?.length ?? 0) > 0;
  //   return hasTitle && hasArtist && hasCategory;
  // })();

  const queryClient = useQueryClient();

  // 이미지 업로드 hook
  const {
    uploadImage,
    isUploading: isImageUploading,
    uploadedData,
    reset: resetUpload,
  } = useImageUpload({
    onSuccess: (data) => {
      form.setValue("albumArt", data.imageUrl, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
  });
  // 카테고리 추가 모달 상태
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor] = useState<string>(DEFAULT_CATEGORY_COLORS[0]);

  // 선택 항목 토글 상태 (수정 시 초기값이 있으면 자동 선택)
  const defaultEnabled = useMemo(() => {
    const iv = initialValues ?? {};
    const enabled = new Set<OptionalFieldKey>();
    if (
      requireProficiency ||
      (typeof iv.proficiency === "number" && !Number.isNaN(iv.proficiency))
    ) {
      enabled.add("proficiency");
    }
    if ((iv.songKey ?? "").toString().trim().length > 0) enabled.add("songKey");
    if (typeof iv.bpm === "number" && !Number.isNaN(iv.bpm)) enabled.add("bpm");
    if ((iv.karaokeUrl ?? "").toString().trim().length > 0)
      enabled.add("karaokeUrl");
    if ((iv.originalUrl ?? "").toString().trim().length > 0)
      enabled.add("originalUrl");
    if ((iv.mrVideoUrl ?? "").toString().trim().length > 0)
      enabled.add("mrVideo");
    if ((iv.coverUrl ?? "").toString().trim().length > 0)
      enabled.add("coverUrl");
    if ((iv.lyricsLink ?? "").toString().trim().length > 0)
      enabled.add("lyricsLink");
    if ((iv.lyricsText ?? "").toString().trim().length > 0)
      enabled.add("lyricsText");
    if ((iv.description ?? "").toString().trim().length > 0)
      enabled.add("description");
    // 수정 모드: 기존 악보가 있으면 토글 자동 on
    // 신규 모드: 부모가 보관 중인 pending file 이 있으면 토글 자동 on
    if ((iv.sheetMusicUrl ?? "").toString().trim().length > 0)
      enabled.add("sheetMusic");
    if (pendingSheetMusicFile) enabled.add("sheetMusic");
    return enabled;
  }, [initialValues, pendingSheetMusicFile, requireProficiency]);

  const [enabledOptionalFields, setEnabledOptionalFields] =
    useState<Set<OptionalFieldKey>>(defaultEnabled);

  useEffect(() => {
    setEnabledOptionalFields(defaultEnabled);
  }, [defaultEnabled]);

  const toggleOptionalField = (
    key: OptionalFieldKey,
    nextPressed?: boolean
  ) => {
    if (key === "proficiency" && requireProficiency) {
      return;
    }
    setEnabledOptionalFields((prev) => {
      const next = new Set(prev);
      const shouldEnable =
        typeof nextPressed === "boolean" ? nextPressed : !next.has(key);
      if (shouldEnable) {
        next.add(key);
      } else {
        next.delete(key);
        // 값 초기화 (토글 해제 시 저장되지 않도록)
        if (key === "bpm" || key === "proficiency") {
          form.setValue(key, undefined as unknown as number, {
            shouldDirty: true,
            shouldValidate: true,
          });
        } else if (key === "sheetMusic" || key === "mrVideo") {
          // 악보 토글 off 는 visibility 만 담당. pending file / 기존 악보는 모두 유지.
          // - 신규 흐름(pending): off → 다시 on 했을 때 같은 file 그대로 복원되어야 함.
          //   pending file 의 명시적 삭제는 SheetMusicSection 내부 "선택 취소" 버튼으로만 가능.
          // - 수정 흐름(immediate): off → 단순 hide. 기존 악보 데이터는 보존.
          //   명시적 삭제는 SheetMusicSection 내부 "악보 삭제" 버튼으로만 가능.
          // (다른 optional field 들은 off=clear 의도가 명확하지만 악보는 파일 손실 위험이 커서 분리.)
        } else {
          form.setValue(key as keyof SongFormValues, "" as never, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
      }
      return next;
    });
  };

  const showSongKey = enabledOptionalFields.has("songKey");
  const showProficiency =
    requireProficiency || enabledOptionalFields.has("proficiency");
  const showBpm = enabledOptionalFields.has("bpm");
  const showKaraoke = enabledOptionalFields.has("karaokeUrl");
  const showOriginal = enabledOptionalFields.has("originalUrl");
  const showMrVideo = enabledOptionalFields.has("mrVideo");
  const showCover = enabledOptionalFields.has("coverUrl");
  const showLyricsLink = enabledOptionalFields.has("lyricsLink");
  const showLyricsText = enabledOptionalFields.has("lyricsText");
  const showDescription = enabledOptionalFields.has("description");
  const sheetMusicFlagEnabled = useFeatureFlag("songbookSheetMusic");
  const showSheetMusic =
    enabledOptionalFields.has("sheetMusic") && sheetMusicFlagEnabled;
  // 토글 노출도 flag 로 게이트. flag OFF 환경에선 "악보" 토글 자체가 보이지 않는다.
  const visibleOptionalFields = OPTIONAL_FIELDS.filter((field) => {
    if (requireProficiency && field.key === "proficiency") return false;
    if (!sheetMusicFlagEnabled && field.key === "sheetMusic") return false;
    return true;
  });

  const handleMrVideoFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!editingSongId) {
      toast.error("MR 영상은 노래 저장 후 수정 화면에서 업로드할 수 있습니다.");
      return;
    }
    if (!file.type.startsWith("video/")) {
      toast.error("영상 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > SONG_MR_VIDEO_MAX_BYTES) {
      toast.error("MR 영상은 최대 5GB까지 업로드할 수 있습니다.");
      return;
    }

    setIsMrVideoUploading(true);
    setMrVideoUploadProgress(0);
    try {
      const result = await uploadSongMrVideo(identifier, editingSongId, file, {
        onProgress: setMrVideoUploadProgress,
      });
      setMrVideoUrl(result.mrVideoUrl);
      form.setValue("mrVideoUrl", result.mrVideoUrl, { shouldDirty: false });
      form.setValue("mrVideoKey", result.mrVideoKey, { shouldDirty: false });
      await queryClient.invalidateQueries({
        queryKey: songsKeys.detail(identifier, editingSongId),
      });
      await queryClient.invalidateQueries({ queryKey: songsKeys.publicUser(identifier) });
      toast.success("MR 영상이 업로드되었습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "MR 영상 업로드에 실패했습니다.");
    } finally {
      setIsMrVideoUploading(false);
      setMrVideoUploadProgress(null);
    }
  };

  const handleDeleteMrVideo = async () => {
    if (!editingSongId || !mrVideoUrl) return;
    setIsMrVideoDeleting(true);
    try {
      const result = await deleteSongMrVideo(identifier, editingSongId);
      setMrVideoUrl(result.mrVideoUrl);
      form.setValue("mrVideoUrl", result.mrVideoUrl, { shouldDirty: false });
      form.setValue("mrVideoKey", result.mrVideoKey, { shouldDirty: false });
      await queryClient.invalidateQueries({
        queryKey: songsKeys.detail(identifier, editingSongId),
      });
      await queryClient.invalidateQueries({ queryKey: songsKeys.publicUser(identifier) });
      toast.success("MR 영상이 삭제되었습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "MR 영상 삭제에 실패했습니다.");
    } finally {
      setIsMrVideoDeleting(false);
    }
  };

  // 팬 대상 참고 가격 표시 활성화 여부
  const isPricingEnabled = pricingSettings?.pricingEnabled ?? false;
  const currencyUnit = pricingSettings?.currencyUnit ?? "";
  const hasMultiCurrency = selectedCurrencyConfigs.length > 0;

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        if (!onSubmit) return;
        await onSubmit({
          ...values,
          title: values.title.trim(),
          artistName: values.artistName.trim(),
          categoryNames: (values.categoryNames ?? []).map((v: string) =>
            v.trim()
          ),
        });
      })}
      className="space-y-4"
    >
      <section
        id="add-song-section1"
        className="grid grid-cols-1 lg:grid-cols-4 xl:grid-cols-5 gap-4"
      >
        <Card className="lg:col-span-2 xl:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg font-bold paperlogy">
              필수 항목
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* 1) 제목/가수 */}

            <div className="space-y-5">
              <div className="relative">
                <SongFormLabel htmlFor="title" name="노래 제목" isRequired />
                <Input
                  id="title"
                  placeholder="제목"
                  {...titleField}
                  onFocus={() => setShowTitleSuggestions(true)}
                  onBlur={(e) => {
                    titleField.onBlur(e);
                    setTimeout(() => setShowTitleSuggestions(false), 150);
                  }}
                />
                {showTitleSuggestions &&
                  title?.trim().length > 0 &&
                  titleSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border bg-popover shadow-sm">
                    {titleSuggestions.map((suggestion) => (
                      <button
                        key={`${suggestion.id}-${suggestion.artistId}-${suggestion.title}`}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          form.setValue("title", suggestion.title, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          setShowTitleSuggestions(false);
                        }}
                      >
                        <span className="font-medium truncate min-w-0">{suggestion.title}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {suggestion.artistName}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {form.formState.errors.title && (
                  <p className="text-xs text-red-500 mt-1">
                    {form.formState.errors.title.message}
                  </p>
                )}
              </div>

              <div>
                <SongFormLabel
                  htmlFor="artistName"
                  name="아티스트"
                  isRequired
                />
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <SearchableCombobox
                      value={artistName || ""}
                      onValueChange={(v) =>
                        form.setValue("artistName", v, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                      options={(artists ?? []).map(
                        (a: { name: string }) => a.name
                      )}
                      placeholder="아티스트명을 입력 또는 검색"
                      emptyCreatePrefix={
                        requestMode ? "아티스트 입력" : "아티스트 추가"
                      }
                      onCreate={async (name) => {
                        // requestMode일 때는 API 호출 없이 이름만 반환
                        if (requestMode) return name;
                        if (!channelId) return name;
                        const res = await createArtist.mutateAsync({ name });
                        await queryClient.invalidateQueries({
                          queryKey: artistsKeys.user(identifier),
                        });
                        return res.name;
                      }}
                    />
                  </div>
                  {(artistName || "").trim().length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() =>
                        form.setValue("artistName", "", {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                {!(artistName || "").trim() && artistSuggestions.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <span className="text-xs text-muted-foreground">추천</span>
                    <div className="flex flex-wrap gap-2">
                      {artistSuggestions.map((suggestion) => (
                        <button
                          key={`${suggestion.artistId ?? "new"}-${suggestion.artistName}`}
                          type="button"
                          className="rounded-full border px-2 py-1 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                          onClick={() =>
                            handleArtistSuggestionSelect(
                              suggestion.artistName
                            )
                          }
                        >
                          {suggestion.artistName}
                          {typeof suggestion.matchCount === "number"
                            ? ` (${suggestion.matchCount})`
                            : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* requestMode: 기존 아티스트에 없으면 "(추가예정)" 표시 */}
                {requestMode &&
                  artistName &&
                  !(artists ?? []).some(
                    (a: { name: string }) => a.name === artistName
                  ) && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⏳ 새 아티스트 (승인 시 추가예정)
                    </p>
                  )}
                {form.formState.errors.artistName && (
                  <p className="text-xs text-red-500 mt-1">
                    {form.formState.errors.artistName.message}
                  </p>
                )}
              </div>

              <div>
                <SongFormLabel
                  htmlFor="categoryNames"
                  name="카테고리"
                  description="카테고리는 여러개 선택할 수 있어요"
                  isRequired
                />
                <div className="flex flex-wrap gap-1.5">
                  {/* 기존 카테고리 목록 */}
                  {(categories ?? []).map(
                    (c: { name: string; color?: string }) => {
                      const isSelected = (categoryNames || []).includes(c.name);
                      const color = c.color || "#3B82F6";
                      const textColor = getContrastingTextColor(color);
                      return (
                        <Toggle
                          key={c.name}
                          pressed={isSelected}
                          onPressedChange={(pressed) => {
                            const current = new Set<string>(
                              categoryNames || []
                            );
                            if (pressed) {
                              current.add(c.name);
                            } else {
                              current.delete(c.name);
                            }
                            form.setValue(
                              "categoryNames",
                              Array.from(current),
                              {
                                shouldDirty: true,
                                shouldValidate: true,
                              }
                            );
                          }}
                          variant="outline"
                          size="sm"
                          className="px-2 py-0.5 text-xs"
                          style={{
                            borderColor: color,
                            ...(isSelected && {
                              backgroundColor: color,
                              borderColor: color,
                              color: textColor,
                            }),
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full mr-1"
                            style={{
                              backgroundColor: isSelected
                                ? textColor === "white"
                                  ? "rgba(255,255,255,0.8)"
                                  : "rgba(0,0,0,0.8)"
                                : color,
                            }}
                          />
                          {c.name}
                        </Toggle>
                      );
                    }
                  )}
                  {/* requestMode가 아닐 때만 카테고리 추가 버튼 표시 */}
                  {!requestMode && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsAddCategoryOpen(true)}
                      className="h-7 text-xs"
                    >
                      카테고리 추가
                    </Button>
                  )}
                </div>
                {form.formState.errors.categoryNames && (
                  <p className="text-xs text-red-500 mt-1">
                    {form.formState.errors.categoryNames.message as string}
                  </p>
                )}
              </div>

              <div>
                <SongFormLabel htmlFor="difficulty" name="난이도" isRequired />
                <div className="flex gap-1">
                  {DIFFICULTY_LEVELS.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() =>
                        form.setValue("difficulty", s, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                      className={`text-2xl transition-colors ${
                        s <= difficulty
                          ? "text-yellow-400 hover:text-yellow-500"
                          : "text-gray-300 hover:text-yellow-400"
                      }`}
                    >
                      <Star
                        className={`w-6 h-6 ${
                          s <= difficulty ? "fill-current" : ""
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {requireProficiency && (
                <div>
                  <SongFormLabel
                    htmlFor="proficiency"
                    name="숙련도"
                    isRequired
                  />
                  <div className="flex gap-1">
                    {DIFFICULTY_LEVELS.map((level) => (
                      <button
                        type="button"
                        key={level}
                        onClick={() =>
                          form.setValue("proficiency", level, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className={`text-2xl transition-colors ${
                          proficiency && level <= proficiency
                            ? "text-emerald-500 hover:text-emerald-600"
                            : "text-gray-300 hover:text-emerald-500"
                        }`}
                      >
                        <Star
                          className={`w-6 h-6 ${
                            proficiency && level <= proficiency
                              ? "fill-current"
                              : ""
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  {form.formState.errors.proficiency && (
                    <p className="text-xs text-red-500 mt-1">
                      {form.formState.errors.proficiency.message as string}
                    </p>
                  )}
                </div>
              )}

              {/* 금액 섹션 */}
              <div className="pt-4 border-t">
                <SongFormLabel
                  htmlFor="price-section"
                  name="참고 가격"
                  isRequired={false}
                  hideRequired
                />

                {isPricingEnabled ? (
                  <>
                    {/* 팬에게 표시할 참고 가격 */}
                    <div className="mb-3 p-3 bg-muted/50 rounded-lg">
                      <div className="text-sm">
                        {hasMultiCurrency ? (
                          <div className="space-y-2">
                            <div className="text-muted-foreground">표시될 참고 가격:</div>
                            {expectedPriceByCurrency.map((result) => (
                              <div
                                key={`${result.currencyKey ?? result.unit}-${result.source}`}
                                className="flex items-center gap-2 flex-wrap"
                              >
                                <span className="text-sm min-w-14 text-muted-foreground">
                                  {result.unit}
                                </span>
                                <span className="font-semibold text-base">
                                  {result.price != null
                                    ? `${result.price.toLocaleString()} ${result.unit}`
                                    : "무료"}
                                </span>
                                <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                  {PRICE_SOURCE_LABELS[result.source]}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : expectedPrice.price !== null ? (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              표시될 참고 가격:
                            </span>
                            <span className="font-semibold text-lg">
                              {expectedPrice.price.toLocaleString()}
                              {currencyUnit ? ` ${currencyUnit}` : ""}
                            </span>
                            <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                              {PRICE_SOURCE_LABELS[expectedPrice.source]}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              표시될 참고 가격:
                            </span>
                            <span className="font-semibold">무료</span>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          난이도와 카테고리 설정에 따라 자동 계산됩니다
                        </p>
                      </div>
                    </div>

                    {/* 직접 금액 설정 */}
                    {hasMultiCurrency ? (
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground whitespace-nowrap">
                          직접 가격 입력:
                        </label>
                        {selectedCurrencyConfigs.map((config) => {
                          const value =
                            normalizedCurrencyPricesValue?.[config.key] ?? "";
                          return (
                            <div
                              key={config.key}
                              className="flex items-center gap-2"
                            >
                              <span className="text-sm min-w-14 text-muted-foreground">
                                {config.unit}
                              </span>
                              <Input
                                id={`price-${config.key}`}
                                type="number"
                                min={0}
                                placeholder="미설정 (자동 계산)"
                                className="max-w-[180px]"
                                value={value ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const next: Record<string, number | null> = {
                                    ...(normalizedCurrencyPricesValue ?? {}),
                                    [config.key]:
                                      val === "" ? null : Number(val),
                                  };
                                  form.setValue("currencyPrices", next, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  });
                                  form.setValue("price", undefined, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  });
                                }}
                              />
                              <span className="text-sm text-muted-foreground">
                                {config.unit}
                              </span>
                            </div>
                          );
                        })}
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              form.setValue("currencyPrices", null, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                              form.setValue("price", undefined, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }}
                          >
                            직접 가격 초기화
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <label className="text-sm text-muted-foreground whitespace-nowrap">
                            직접 가격 입력:
                          </label>
                          <Input
                            id="price"
                            type="number"
                            min={0}
                            placeholder="미설정 (자동 계산)"
                            className="max-w-[180px]"
                            value={typeof priceValue === "number" ? priceValue : ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              form.setValue(
                                "price",
                                val === "" ? undefined : Number(val),
                                { shouldDirty: true, shouldValidate: true }
                              );
                            }}
                          />
                          {currencyUnit && (
                            <span className="text-sm text-muted-foreground">
                              {currencyUnit}
                            </span>
                          )}
                          {typeof priceValue === "number" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                form.setValue("price", undefined, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                });
                              }}
                            >
                              초기화
                            </Button>
                          )}
                        </div>
                        {typeof priceValue === "number" && (
                          <p className="text-xs text-muted-foreground mt-1">
                            직접 설정한 금액이 적용됩니다
                          </p>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="p-3 bg-muted/30 rounded-lg border border-dashed space-y-2">
                    <p className="text-sm text-muted-foreground">
                      참고 가격 표시가 비활성화되어 있습니다
                    </p>
                    <p className="text-xs text-muted-foreground">
                      신청곡 설정에서 참고 가격 표시를 켜면 금액을 설정할 수 있습니다
                    </p>
                    <Link
                      href={`/channel/${identifier}/manage/song-request-settings#pricing`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      참고 가격 설정으로 이동
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg font-bold paperlogy">
              이미지 (선택)
            </CardTitle>
            <CardDescription>
              노래를 더 명확하게 식별할 수 있도록 이미지를 추가해보세요
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 flex flex-col justify-between h-full">
            <div className="space-y-4">
              <div>
                <SongFormLabel
                  htmlFor="albumArt"
                  name="이미지 검색"
                  description="제목과 아티스트를 입력한 뒤 버튼을 눌러 연관 이미지를 검색하세요"
                  isRequired={false}
                  hideRequired={true}
                />
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !title?.trim() ||
                      !artistName?.trim() ||
                      imageSearchQuery.isFetching
                    }
                    onClick={() => {
                      const newBody: ImageSearchRequest = {
                        title: (title || "").trim(),
                        artist: (artistName || "").trim(),
                      };
                      // 새로운 검색 시 에러 이미지 목록 초기화
                      setFailedImageUrls(new Set());
                      if (
                        imageSearchBody?.title === newBody.title &&
                        imageSearchBody?.artist === newBody.artist
                      ) {
                        void imageSearchQuery.refetch();
                        return;
                      }
                      setImageSearchBody(newBody);
                    }}
                  >
                    <Search className="w-4 h-4 mr-1" /> 이미지 검색
                  </Button>
                  {imageSearchQuery.isFetching && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> 검색 중
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2 xl:col-span-1">
                  {imageSearchQuery.isLoading ? (
                    <div className="py-8 text-center text-muted-foreground">
                      검색 중...
                    </div>
                  ) : imageSearchQuery.error ? (
                    <div className="py-8 text-center text-red-500 text-sm">
                      검색에 실패했습니다. {imageSearchQuery.error.message}
                    </div>
                  ) : searchResults.length ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto">
                      {searchResults.map((r) => (
                        <button
                          key={`${r.title}-${r.albumArt}`}
                          type="button"
                          className={`relative flex flex-col gap-2 p-2 border rounded-lg transition-colors ${
                            selectedAlbumArt === r.albumArt
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => {
                            const isSameAlbumArt =
                              selectedAlbumArt === r.albumArt;
                            form.setValue(
                              "albumArt",
                              isSameAlbumArt ? "" : r.albumArt,
                              {
                                shouldDirty: true,
                                shouldValidate: true,
                              }
                            );

                            if (!title) {
                              form.setValue("title", r.title, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }
                            if (!artistName) {
                              form.setValue("artistName", r.artist, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }
                          }}
                        >
                          <div className="relative w-full aspect-square">
                            <img
                              src={r.albumArt}
                              alt={`이미지 ${r.title} - ${r.displayArtist} - ${r.displayAlbum}`}
                              className="w-full h-full object-cover rounded aspect-square"
                              onError={() => {
                                // 이미지 로딩 실패 시 상태 업데이트하여 필터링
                                setFailedImageUrls((prev) => {
                                  const next = new Set(prev);
                                  next.add(r.albumArt);
                                  return next;
                                });
                              }}
                            />
                            {selectedAlbumArt === r.albumArt && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white rounded">
                                <Check className="w-6 h-6" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <div className="font-medium text-xs line-clamp-1 break-all">
                              {r.title}
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-1 break-all">
                              {r.displayArtist}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-muted-foreground text-sm">
                      이미지 검색 결과가 여기에 표시됩니다
                    </div>
                  )}
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-sidebar px-2 text-muted-foreground">
                    또는
                  </span>
                </div>
              </div>

              <div>
                <SongFormLabel
                  htmlFor="image-upload"
                  name="이미지 직접 업로드"
                  isRequired={false}
                  hideRequired={true}
                />
                <ImageDropzone
                  onFileSelected={async (file) => {
                    await uploadImage(file);
                  }}
                  isUploading={isImageUploading}
                  uploadedImageUrl={uploadedData?.imageUrl}
                  onRemove={() => {
                    form.setValue("albumArt", "", {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    resetUpload();
                  }}
                  maxSizeMB={10}
                />
              </div>
            </div>

            <div>
              <SongFormLabel
                htmlFor="albumArt"
                name="이미지 URL"
                description="이미지 URL을 직접 입력할 수도 있어요 (이미지 URL만 가능)"
                isRequired={false}
                hideRequired={true}
              />
              <Input
                id="albumArt"
                className="text-xs text-muted-foreground border border-transparent hover:border-border rounded-md px-2 py-1 min-h-9 flex items-center cursor-text shadow-none"
                placeholder="https://..."
                {...form.register("albumArt")}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 공통 카테고리 추가 다이얼로그 */}
      <CategoryEditDialog
        open={isAddCategoryOpen}
        onOpenChange={setIsAddCategoryOpen}
        title={requestMode ? "카테고리 입력" : "카테고리 추가"}
        initialValues={{ name: newCategoryName, color: newCategoryColor }}
        onSubmit={async (values) => {
          const name = values.name.trim();
          const color = values.color;
          if (!name) return;
          // requestMode이거나 channelId 없으면 API 호출 없이 로컬 상태만 업데이트
          if (requestMode || !channelId) {
            const next = new Set<string>(form.getValues("categoryNames") || []);
            next.add(name);
            form.setValue("categoryNames", Array.from(next), {
              shouldDirty: true,
              shouldValidate: true,
            });
            setIsAddCategoryOpen(false);
            setNewCategoryName("");
            return;
          }
          const created = await createCategory.mutateAsync({ name, color });
          await queryClient.invalidateQueries({
            queryKey: categoriesKeys.user(identifier),
          });
          const next = new Set<string>(form.getValues("categoryNames") || []);
          next.add(created.name);
          form.setValue("categoryNames", Array.from(next), {
            shouldDirty: true,
            shouldValidate: true,
          });
          setIsAddCategoryOpen(false);
          setNewCategoryName("");
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold paperlogy">
            선택 항목
          </CardTitle>
          <CardDescription>
            추가 항목을 선택하면 세부 정보를 입력할 수 있어요
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* 선택 항목 토글 */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {visibleOptionalFields.map((f) => (
                <Toggle
                  key={f.key}
                  pressed={enabledOptionalFields.has(f.key)}
                  onPressedChange={(v) =>
                    toggleOptionalField(f.key, Boolean(v))
                  }
                  variant="outline"
                  size="default"
                >
                  {f.label}
                </Toggle>
              ))}
            </div>
            {/* 악보 토글 동작은 다른 선택 항목과 다름 — 혼동을 줄이기 위한 짧은 안내 */}
            {enabledOptionalFields.has("sheetMusic") && (
              <p className="text-xs text-muted-foreground">
                악보 토글을 끄면 섹션이 숨겨집니다. 선택한/저장된 악보 파일은
                유지되며, 삭제하려면 아래 &ldquo;선택 취소&rdquo; 또는
                &ldquo;악보 삭제&rdquo; 버튼을 사용하세요.
              </p>
            )}
          </div>

          {/* 이후 필드 */}
          {showProficiency && !requireProficiency && (
            <div>
              <SongFormLabel
                htmlFor="proficiency"
                name="숙련도"
                isRequired={false}
              />
              <div className="flex gap-1">
                {DIFFICULTY_LEVELS.map((level) => (
                  <button
                    type="button"
                    key={level}
                    onClick={() =>
                      form.setValue("proficiency", level, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    className={`text-2xl transition-colors ${
                      proficiency && level <= proficiency
                        ? "text-emerald-500 hover:text-emerald-600"
                        : "text-gray-300 hover:text-emerald-500"
                    }`}
                  >
                    <Star
                      className={`w-6 h-6 ${
                        proficiency && level <= proficiency ? "fill-current" : ""
                      }`}
                    />
                  </button>
                ))}
                {proficiency && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      form.setValue("proficiency", undefined, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    className="h-8 px-2 text-xs text-muted-foreground"
                  >
                    해제
                  </Button>
                )}
              </div>
            </div>
          )}

          {(showSongKey || showBpm) && (
            <div
              className={`grid grid-cols-1 ${
                showSongKey && showBpm ? "md:grid-cols-2" : "md:grid-cols-1"
              } gap-4`}
            >
              {showSongKey && (
                <div>
                  <SongFormLabel
                    htmlFor="songKey"
                    name="키"
                    isRequired={false}
                  />
                  <Input
                    id="songKey"
                    placeholder="예: C#"
                    {...form.register("songKey")}
                  />
                </div>
              )}
              {showBpm && (
                <div>
                  <SongFormLabel htmlFor="bpm" name="BPM" isRequired={false} />
                  <Input
                    id="bpm"
                    type="number"
                    placeholder="예: 120"
                    {...form.register("bpm")}
                  />
                </div>
              )}
            </div>
          )}

          {(showKaraoke || showOriginal || showCover || showLyricsLink) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {showKaraoke && (
                <div>
                  <SongFormLabel
                    htmlFor="karaokeUrl"
                    name="노래방 주소"
                    isRequired={false}
                  />
                  <Input
                    id="karaokeUrl"
                    type="url"
                    placeholder="https://..."
                    {...form.register("karaokeUrl")}
                  />
                  <InlineYoutubeSearch
                    query={buildYoutubeQuery(
                      "karaokeUrl",
                      title,
                      artistName,
                      channelName
                    )}
                    currentUrl={form.watch("karaokeUrl") ?? ""}
                    onSelect={(url) =>
                      form.setValue("karaokeUrl", url, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                </div>
              )}

              {showOriginal && (
                <div>
                  <SongFormLabel
                    htmlFor="originalUrl"
                    name="원곡 유튜브 링크"
                    isRequired={false}
                  />
                  <Input
                    id="originalUrl"
                    type="url"
                    placeholder="https://..."
                    {...form.register("originalUrl")}
                  />
                  <InlineYoutubeSearch
                    query={buildYoutubeQuery(
                      "originalUrl",
                      title,
                      artistName,
                      channelName
                    )}
                    currentUrl={form.watch("originalUrl") ?? ""}
                    onSelect={(url) =>
                      form.setValue("originalUrl", url, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                </div>
              )}
              {showCover && (
                <div>
                  <SongFormLabel
                    htmlFor="coverUrl"
                    name="본인 커버 링크"
                    isRequired={false}
                  />
                  <div className="flex gap-2">
                    <Input
                      id="coverUrl"
                      type="url"
                      placeholder="https://..."
                      className="flex-1"
                      {...form.register("coverUrl")}
                    />
                    {enableClipAdd && !requestMode && (
                      <Button
                        type="button"
                        variant={clipPendingData ? "default" : "outline"}
                        size="sm"
                        className={clipPendingData ? "bg-green-600 hover:bg-green-700" : ""}
                        disabled={!coverUrlValue || isResolvingClipUrl}
                        onClick={clipPendingData ? handleCancelClipAdd : handleResolveClipUrl}
                      >
                        {isResolvingClipUrl ? (
                          <>
                            <Loader2 className="size-4 mr-1 animate-spin" />
                            확인 중
                          </>
                        ) : clipPendingData ? (
                          <>
                            <Check className="size-4 mr-1" />
                            추가 예정
                          </>
                        ) : (
                          <>
                            <Film className="size-4 mr-1" />
                            클립에도 추가
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  <InlineYoutubeSearch
                    query={buildYoutubeQuery(
                      "coverUrl",
                      title,
                      artistName,
                      channelName
                    )}
                    currentUrl={form.watch("coverUrl") ?? ""}
                    onSelect={(url) =>
                      form.setValue("coverUrl", url, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                  {/* 클립 미리보기 카드 */}
                  {clipPendingData && !requestMode && (
                    <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-2">
                      <div className="flex items-start gap-3">
                        {/* 썸네일 */}
                        {clipPendingData.resolvedData.thumbnailUrl && (
                          <div className="relative w-24 aspect-video rounded overflow-hidden shrink-0">
                            <img
                              src={clipPendingData.resolvedData.thumbnailUrl}
                              alt="클립 썸네일"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        {/* 정보 */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm line-clamp-2">
                            {clipPendingData.resolvedData.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span className="px-1.5 py-0.5 bg-muted rounded">
                              {clipPendingData.resolvedData.platform}
                            </span>
                            {clipPendingData.resolvedData.duration && (
                              <span>{formatDuration(clipPendingData.resolvedData.duration)}</span>
                            )}
                          </div>
                        </div>
                        {/* 취소 버튼 */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0"
                          onClick={handleCancelClipAdd}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <Check className="size-3" />
                        노래 저장 시 클립도 함께 추가됩니다
                      </p>
                      <div className="rounded-md border bg-background px-4">
                        <SettingsRow
                          title="핫클립에 게시"
                          description="끄면 채널 클립에만 등록됩니다"
                          controlClassName="flex justify-start sm:justify-end"
                        >
                        <Switch
                          id="song-form-clip-publish-to-hotclip"
                          checked={clipPendingData.publishToHotClip}
                          onCheckedChange={handleClipPublishToHotClipChange}
                          aria-label="핫클립 게시 여부"
                        />
                        </SettingsRow>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {showLyricsLink && (
                <div>
                  <SongFormLabel
                    htmlFor="lyricsLink"
                    name="가사 링크"
                    isRequired={false}
                  />
                  <Input
                    id="lyricsLink"
                    type="url"
                    placeholder="https://..."
                    {...form.register("lyricsLink")}
                  />
                  <InlineWebSearch
                    query={buildLyricsQuery(title, artistName)}
                    currentUrl={form.watch("lyricsLink") ?? ""}
                    onSelect={(url) =>
                      form.setValue("lyricsLink", url, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                </div>
              )}
            </div>
          )}

          {showDescription && (
            <div>
              <SongFormLabel
                htmlFor="description"
                name="설명"
                description="모든 유저에게 공개되는 곡 설명입니다."
                isRequired={false}
              />
              <Textarea
                id="description"
                rows={4}
                className="max-h-[200px]"
                placeholder="노래 소개나 참고할 내용을 입력하세요"
                {...form.register("description")}
              />
            </div>
          )}

          {showLyricsText && (
            <div>
              <SongFormLabel
                htmlFor="lyricsText"
                name="메모 (가사)"
                description="채널 소유자나 매니저만 볼 수 있는 메모입니다."
                isRequired={false}
              />
              <Textarea
                id="lyricsText"
                rows={6}
                className="max-h-[200px]"
                placeholder="메모 입력 (가사 텍스트 등) 입력한 메모는 채널 소유자나 매니저만 볼 수 있어요"
                {...form.register("lyricsText")}
              />
            </div>
          )}

          {showMrVideo && (
            <div>
              <SongFormLabel
                htmlFor="mrVideo"
                name="MR 영상"
                description="리모컨 재생에서 노래방 주소와 원곡 주소보다 우선 재생됩니다. 영상 파일만 업로드할 수 있습니다."
                isRequired={false}
              />
              <div className="rounded-md border bg-muted/20 p-4">
                {mrVideoUrl ? (
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <a
                      href={mrVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <Film className="size-4 shrink-0" />
                      <span className="truncate">업로드된 MR 영상</span>
                    </a>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteMrVideo}
                      disabled={isMrVideoUploading || isMrVideoDeleting}
                    >
                      {isMrVideoDeleting ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <X className="mr-1.5 size-3.5" />
                      )}
                      삭제
                    </Button>
                  </div>
                ) : (
                  <p className="mb-3 text-sm text-muted-foreground">
                    업로드된 MR 영상이 없습니다.
                  </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="mrVideo"
                    type="file"
                    accept="video/*"
                    onChange={handleMrVideoFileChange}
                    disabled={!editingSongId || isMrVideoUploading || isMrVideoDeleting}
                  />
                  {isMrVideoUploading && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {mrVideoUploadProgress ?? 0}%
                    </span>
                  )}
                </div>
                {!editingSongId && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    노래를 먼저 저장한 뒤 수정 화면에서 업로드할 수 있습니다.
                  </p>
                )}
              </div>
            </div>
          )}

          {/*
            악보 섹션. 다른 선택 항목과 동일하게 카드 내부 inline 렌더.
            - editingSongId 있음 → immediate 모드 (즉시 server endpoint 호출)
            - editingSongId 없음 → pending 모드 (file 만 부모에 보관, song POST 후 부모가 업로드)
            Section 내부에서 useFeatureFlag('songbookSheetMusic') 로 한 번 더 게이트.
          */}
          {showSheetMusic && (
            <div>
              <SongFormLabel
                htmlFor="sheetMusic"
                name="악보"
                description="매니저만 볼 수 있는 악보 (PDF / 이미지 / MusicXML, 30MB 이하)"
                isRequired={false}
              />
              <SheetMusicSection
                channelIdentifier={identifier}
                songId={editingSongId ?? 0}
                initialSlots={initialValues?.sheetMusics ?? null}
                initialUrl={initialValues?.sheetMusicUrl ?? null}
                initialType={initialValues?.sheetMusicType ?? null}
                canManage={true}
                mode={editingSongId !== undefined ? "immediate" : "pending"}
                pendingFile={pendingSheetMusicFile ?? null}
                onPendingFileChange={onPendingSheetMusicFileChange}
                songTitle={initialValues?.title ?? null}
                // I3: 편집(immediate) 모드에서 악보 업로드/삭제 후 부모(편집 모달)
                // 의 song detail / 목록 cache 가 stale 해지지 않도록 invalidate.
                // music-modal.tsx 의 onChange 패턴과 동일.
                onChange={
                  editingSongId !== undefined
                    ? async () => {
                        await queryClient.invalidateQueries({
                          queryKey: songsKeys.detail(
                            identifier,
                            editingSongId
                          ),
                        });
                        await queryClient.invalidateQueries({
                          queryKey: songsKeys.publicUser(identifier),
                        });
                      }
                    : undefined
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      {!hideSubmitButton && (
        <div className="flex justify-end gap-2 pt-2">
          {onSaveAndContinue && (
            <Button
              type="button"
              variant="secondary"
              // I1: 재진입 가드. react-hook-form isSubmitting 은 핸들러가 await 중인 동안
              // true 를 유지하므로 더블클릭/Enter 연타 시 중복 song POST + sheet upload +
              // 클립 생성을 막는다.
              disabled={form.formState.isSubmitting}
              onClick={() =>
                form.handleSubmit(async (values) => {
                  // 부분 실패(예: song 성공 + sheet 실패) 시 부모가 { skipReset: true } 를
                  // 반환하면 form.reset 을 건너뛰고 사용자가 같은 화면에서 재시도할 수 있게 한다.
                  const result = await onSaveAndContinue({
                    ...values,
                    title: values.title.trim(),
                    artistName: values.artistName.trim(),
                    categoryNames: (values.categoryNames ?? []).map((v) =>
                      v.trim()
                    ),
                  });
                  if (result?.skipReset) return;
                  form.reset({
                    title: "",
                    artistName: "",
                    categoryNames: [],
                    albumArt: "",
                    karaokeUrl: "",
                    coverUrl: "",
                    originalUrl: "",
                    difficulty: 1,
                    proficiency: undefined,
                    songKey: "",
                    lyricsText: "",
                    description: "",
                    price: undefined,
                    currencyPrices: null,
                  });
                })()
              }
            >
              저장하고 계속
            </Button>
          )}
          {/* I1: submit 도 동일 가드. submit 중에는 비활성화. */}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      )}

    </form>
  );
}

/**
 * YouTube 영상 검색용 기본 쿼리 빌더.
 * - 포맷: `{artist} - {title} {suffix}` (필요 시 channelName prefix)
 * - karaokeUrl: "노래방" suffix
 * - originalUrl: "MR" suffix
 * - coverUrl: `{channelName} {artist} - {title} 커버` (채널명이 있을 때만 prefix)
 */
function buildYoutubeQuery(
  field: "karaokeUrl" | "originalUrl" | "coverUrl" | null,
  title: string,
  artist: string,
  channelName: string
): string {
  const t = title?.trim() ?? "";
  const a = artist?.trim() ?? "";
  if (!t && !a) return "";
  const core = a && t ? `${a} - ${t}` : a || t;

  switch (field) {
    case "karaokeUrl":
      return `${core} 노래방 (MR)`;
    case "originalUrl":
      return core;
    case "coverUrl": {
      const cn = channelName?.trim();
      return cn ? `${cn} ${core} 커버` : `${core} 커버`;
    }
    default:
      return core;
  }
}

/**
 * 가사 페이지(웹) 검색용 기본 쿼리 빌더.
 * 포맷: `{artist} - {title} 가사`
 */
function buildLyricsQuery(title: string, artist: string): string {
  const t = title?.trim() ?? "";
  const a = artist?.trim() ?? "";
  if (!t && !a) return "";
  const core = a && t ? `${a} - ${t}` : a || t;
  return `${core} 가사`;
}
