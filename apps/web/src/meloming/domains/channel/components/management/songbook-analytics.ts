import type { MatchResult, RecommendationItem } from "@/meloming/domains/channel/apis/global-songs";
import type { Artist } from "@/meloming/domains/channel/types/artist";
import type { ClipPendingData } from "@/meloming/domains/clip/types/clip";
import type { Category } from "@/meloming/domains/channel/types/category";
import type {
  ApproveSongAddRequestBody,
  SongAddRequest,
  SongAddRequestStatus,
} from "@/meloming/domains/channel/types/song-request";
import type {
  PatchSongsChannelIdentifierSongIdRequestBody,
  Song,
} from "@/meloming/domains/channel/types/song";
import { DEFAULT_CATEGORY_COLORS } from "@/meloming/shared/constants/category";
import type { SongFormValues } from "./song-form.schema";
import type { ExcelValidationIssue, SheetRow } from "./add-song-excel-utils";

type AnalyticsValue = string | number | boolean | null | undefined;
export type SongbookAnalyticsProperties = Record<
  string,
  AnalyticsValue | AnalyticsValue[]
>;

export function countBucket(count: number | null | undefined): string {
  if (count == null || Number.isNaN(count)) return "unknown";
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 3) return "2_3";
  if (count <= 5) return "4_5";
  if (count <= 10) return "6_10";
  if (count <= 25) return "11_25";
  if (count <= 50) return "26_50";
  if (count <= 100) return "51_100";
  if (count <= 300) return "101_300";
  if (count <= 500) return "301_500";
  return "501_plus";
}

export function textLengthBucket(value: unknown): string {
  if (typeof value !== "string") return "0";
  const length = value.trim().length;
  if (length <= 0) return "0";
  if (length <= 5) return "1_5";
  if (length <= 15) return "6_15";
  if (length <= 30) return "16_30";
  if (length <= 60) return "31_60";
  if (length <= 120) return "61_120";
  if (length <= 300) return "121_300";
  if (length <= 1000) return "301_1000";
  return "1001_plus";
}

export function fileSizeBucket(size: number | null | undefined): string {
  if (size == null || Number.isNaN(size)) return "unknown";
  if (size <= 0) return "0";
  if (size < 100 * 1024) return "lt_100kb";
  if (size < 1024 * 1024) return "100kb_1mb";
  if (size < 5 * 1024 * 1024) return "1mb_5mb";
  if (size < 10 * 1024 * 1024) return "5mb_10mb";
  if (size < 30 * 1024 * 1024) return "10mb_30mb";
  return "30mb_plus";
}

export function durationBucket(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "unknown";
  if (seconds <= 0) return "0";
  if (seconds <= 30) return "1_30s";
  if (seconds <= 60) return "31_60s";
  if (seconds <= 180) return "1_3m";
  if (seconds <= 300) return "3_5m";
  if (seconds <= 600) return "5_10m";
  return "10m_plus";
}

export function numericValueBucket(value: unknown): string {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : null;
  if (numberValue == null || Number.isNaN(numberValue)) return "unset";
  if (numberValue <= 0) return "0";
  if (numberValue <= 1000) return "1_1000";
  if (numberValue <= 5000) return "1001_5000";
  if (numberValue <= 10000) return "5001_10000";
  if (numberValue <= 50000) return "10001_50000";
  if (numberValue <= 100000) return "50001_100000";
  return "100001_plus";
}

export function bpmBucket(value: unknown): string {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : null;
  if (numberValue == null || Number.isNaN(numberValue)) return "unset";
  if (numberValue < 80) return "lt_80";
  if (numberValue < 100) return "80_99";
  if (numberValue < 120) return "100_119";
  if (numberValue < 140) return "120_139";
  if (numberValue < 180) return "140_179";
  return "180_plus";
}

export function getApiErrorStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === "number" ? status : null;
}

export function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function getFileSummary(file: File | null | undefined): SongbookAnalyticsProperties {
  if (!file) {
    return {
      file_selected: false,
      file_extension: null,
      file_size_bucket: "unset",
      file_mime_type: null,
    };
  }

  const extension = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase() ?? "unknown"
    : "none";

  return {
    file_selected: true,
    file_extension: extension,
    file_size_bucket: fileSizeBucket(file.size),
    file_mime_type: file.type || "unknown",
  };
}

export function getSongFormSummary(
  values: Partial<SongFormValues>
): SongbookAnalyticsProperties {
  const categoryCount = Array.isArray(values.categoryNames)
    ? values.categoryNames.filter((name) => name.trim().length > 0).length
    : 0;
  const currencyPrices =
    values.currencyPrices && typeof values.currencyPrices === "object"
      ? values.currencyPrices
      : null;
  const currencyPriceCount = currencyPrices
    ? Object.values(currencyPrices).filter(
        (value) => typeof value === "number" && !Number.isNaN(value)
      ).length
    : 0;
  const requiredFieldCount = [
    values.title,
    values.artistName,
    categoryCount > 0 ? "category" : "",
  ].filter((value) => typeof value === "string" && value.trim().length > 0)
    .length;
  const optionalFieldFlags = [
    values.albumArt,
    values.karaokeUrl,
    values.coverUrl,
    values.originalUrl,
    values.lyricsLink,
    values.lyricsText,
    values.description,
    values.proficiency,
    values.songKey,
    values.bpm,
    values.price,
    currencyPriceCount > 0 ? "currency_price" : "",
  ];
  const optionalFieldCount = optionalFieldFlags.filter((value) => {
    if (typeof value === "number") return !Number.isNaN(value);
    if (typeof value === "string") return value.trim().length > 0;
    return Boolean(value);
  }).length;

  return {
    title_length_bucket: textLengthBucket(values.title),
    artist_name_length_bucket: textLengthBucket(values.artistName),
    category_count: categoryCount,
    category_count_bucket: countBucket(categoryCount),
    required_field_count: requiredFieldCount,
    required_field_completion:
      requiredFieldCount === 3
        ? "complete"
        : requiredFieldCount === 0
          ? "empty"
          : "partial",
    has_album_art: hasText(values.albumArt),
    has_karaoke_url: hasText(values.karaokeUrl),
    has_cover_url: hasText(values.coverUrl),
    has_original_url: hasText(values.originalUrl),
    has_lyrics_link: hasText(values.lyricsLink),
    has_lyrics_text: hasText(values.lyricsText),
    lyrics_text_length_bucket: textLengthBucket(values.lyricsText),
    has_description: hasText(values.description),
    description_length_bucket: textLengthBucket(values.description),
    difficulty: typeof values.difficulty === "number" ? values.difficulty : null,
    proficiency:
      typeof values.proficiency === "number" ? values.proficiency : null,
    has_song_key: hasText(values.songKey),
    has_bpm: values.bpm !== undefined && values.bpm !== "",
    bpm_bucket: bpmBucket(values.bpm),
    has_direct_price: values.price !== undefined && values.price !== "",
    direct_price_bucket: numericValueBucket(values.price),
    currency_price_count: currencyPriceCount,
    currency_price_count_bucket: countBucket(currencyPriceCount),
    has_any_custom_price:
      (values.price !== undefined && values.price !== "") || currencyPriceCount > 0,
    optional_field_count: optionalFieldCount,
    optional_field_count_bucket: countBucket(optionalFieldCount),
    media_field_count: [
      values.albumArt,
      values.karaokeUrl,
      values.coverUrl,
      values.originalUrl,
    ].filter(hasText).length,
    reference_field_count: [
      values.lyricsLink,
      values.lyricsText,
      values.description,
    ].filter(hasText).length,
  };
}

export function getClipPendingSummary(
  pendingData: ClipPendingData | null | undefined
): SongbookAnalyticsProperties {
  if (!pendingData) {
    return {
      clip_pending: false,
      clip_platform: null,
      clip_duration_bucket: "unset",
      clip_publish_to_hot_clip: null,
    };
  }

  return {
    clip_pending: true,
    clip_platform: pendingData.resolvedData.platform,
    clip_duration_bucket: durationBucket(pendingData.resolvedData.duration),
    clip_publish_to_hot_clip: pendingData.publishToHotClip,
    clip_has_thumbnail: Boolean(pendingData.resolvedData.thumbnailUrl),
    clip_has_description: Boolean(pendingData.resolvedData.description),
    clip_has_video_id: Boolean(pendingData.resolvedData.videoId),
  };
}

export function getQuickMatchSummary(
  result: MatchResult,
  source: string
): SongbookAnalyticsProperties {
  return {
    quick_add_source: source,
    global_song_id: result.globalSongId,
    already_in_channel: result.alreadyInChannel,
    match_confidence: result.matchConfidence,
    channel_count: result.channelCount,
    channel_count_bucket: countBucket(result.channelCount),
    top_category_count: result.topCategories.length,
    top_category_count_bucket: countBucket(result.topCategories.length),
    has_album_art: Boolean(result.albumArt),
  };
}

export function getRecommendationSummary(
  rec: RecommendationItem,
  source: string
): SongbookAnalyticsProperties {
  return {
    quick_add_source: source,
    global_song_id: rec.globalSongId,
    channel_count: rec.channelCount,
    channel_count_bucket: countBucket(rec.channelCount),
    top_category_count: rec.topCategories.length,
    top_category_count_bucket: countBucket(rec.topCategories.length),
    has_album_art: Boolean(rec.albumArt),
  };
}

export function getQuickSearchSummary(
  results: MatchResult[] | null | undefined,
  query: string
): SongbookAnalyticsProperties {
  const items = results ?? [];
  return {
    query_length_bucket: textLengthBucket(query),
    result_count: items.length,
    result_count_bucket: countBucket(items.length),
    already_in_channel_count: items.filter((item) => item.alreadyInChannel).length,
    addable_result_count: items.filter((item) => !item.alreadyInChannel).length,
    high_confidence_count: items.filter(
      (item) => item.matchConfidence === "HIGH"
    ).length,
    medium_confidence_count: items.filter(
      (item) => item.matchConfidence === "MEDIUM"
    ).length,
    low_confidence_count: items.filter((item) => item.matchConfidence === "LOW")
      .length,
    result_with_album_art_count: items.filter((item) => Boolean(item.albumArt))
      .length,
  };
}

export function getExcelRowsSummary(
  rows: SheetRow[],
  albumArtByKey: Record<string, string | undefined> = {}
): SongbookAnalyticsProperties {
  const meaningfulRows = rows.filter((row) =>
    [
      row.title,
      row.artist,
      row.category,
      row.albumArt,
      row.karaokeUrl,
      row.coverUrl,
      row.originalUrl,
      row.lyricsLink,
      row.description,
      row.songKey,
      row.bpm,
      row.difficulty,
    ].some(hasText)
  );
  const rowsWithRequiredTriplet = meaningfulRows.filter(
    (row) => hasText(row.title) && hasText(row.artist) && hasText(row.category)
  ).length;

  return {
    row_count: meaningfulRows.length,
    row_count_bucket: countBucket(meaningfulRows.length),
    rows_with_title_count: meaningfulRows.filter((row) => hasText(row.title))
      .length,
    rows_with_artist_count: meaningfulRows.filter((row) => hasText(row.artist))
      .length,
    rows_with_category_count: meaningfulRows.filter((row) => hasText(row.category))
      .length,
    rows_with_required_triplet_count: rowsWithRequiredTriplet,
    rows_with_required_triplet_bucket: countBucket(rowsWithRequiredTriplet),
    rows_with_album_art_count: meaningfulRows.filter((row) => {
      const key = `${row.title.trim()}::${row.artist.trim()}`;
      return hasText(row.albumArt) || Boolean(albumArtByKey[key]);
    }).length,
    rows_with_karaoke_url_count: meaningfulRows.filter((row) =>
      hasText(row.karaokeUrl)
    ).length,
    rows_with_cover_url_count: meaningfulRows.filter((row) => hasText(row.coverUrl))
      .length,
    rows_with_original_url_count: meaningfulRows.filter((row) =>
      hasText(row.originalUrl)
    ).length,
    rows_with_lyrics_link_count: meaningfulRows.filter((row) =>
      hasText(row.lyricsLink)
    ).length,
    rows_with_description_count: meaningfulRows.filter((row) =>
      hasText(row.description)
    ).length,
    rows_with_song_key_count: meaningfulRows.filter((row) => hasText(row.songKey))
      .length,
    rows_with_bpm_count: meaningfulRows.filter((row) => hasText(row.bpm)).length,
    rows_with_difficulty_count: meaningfulRows.filter((row) =>
      hasText(row.difficulty)
    ).length,
  };
}

export function getExcelValidationSummary(
  issues: ExcelValidationIssue[]
): SongbookAnalyticsProperties {
  return {
    validation_issue_count: issues.length,
    validation_issue_count_bucket: countBucket(issues.length),
    validation_issue_fields: Array.from(new Set(issues.map((issue) => issue.field)))
      .slice(0, 20),
    validation_global_issue_count: issues.filter((issue) => issue.rowNumber == null)
      .length,
    validation_row_issue_count: issues.filter((issue) => issue.rowNumber != null)
      .length,
  };
}

export function daysAgeBucket(value: string | Date | null | undefined): string {
  if (!value) return "unknown";
  const timestamp = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days <= 1) return "0_1d";
  if (days <= 7) return "2_7d";
  if (days <= 30) return "8_30d";
  if (days <= 90) return "31_90d";
  if (days <= 180) return "91_180d";
  if (days <= 365) return "181_365d";
  return "365d_plus";
}

export function getManagedSongSummary(
  song: Partial<Song> | null | undefined,
  prefix = "song"
): SongbookAnalyticsProperties {
  if (!song) {
    return {
      [`${prefix}_id`]: null,
      [`${prefix}_loaded`]: false,
    };
  }

  const categories = Array.isArray(song.categories) ? song.categories : [];
  const currencyPrices =
    song.currencyPrices && typeof song.currencyPrices === "object"
      ? song.currencyPrices
      : null;
  const currencyPriceCount = currencyPrices
    ? Object.values(currencyPrices).filter(
        (value) => typeof value === "number" && !Number.isNaN(value)
      ).length
    : 0;

  return {
    [`${prefix}_id`]: typeof song.id === "number" ? song.id : null,
    [`${prefix}_loaded`]: true,
    [`${prefix}_has_artist`]: Boolean(song.artist?.id),
    [`${prefix}_artist_id`]: song.artist?.id ?? null,
    [`${prefix}_category_count`]: categories.length,
    [`${prefix}_category_count_bucket`]: countBucket(categories.length),
    [`${prefix}_difficulty`]:
      typeof song.difficulty === "number" ? song.difficulty : null,
    [`${prefix}_proficiency`]:
      typeof song.proficiency === "number" ? song.proficiency : null,
    [`${prefix}_has_album_art`]: Boolean(song.albumArt),
    [`${prefix}_has_karaoke_url`]: Boolean(song.karaokeUrl),
    [`${prefix}_has_cover_url`]: Boolean(song.coverUrl),
    [`${prefix}_has_original_url`]: Boolean(song.originalUrl),
    [`${prefix}_has_lyrics_link`]: Boolean(song.lyricsLink),
    [`${prefix}_has_lyrics_text`]: Boolean(song.lyricsText),
    [`${prefix}_has_description`]: Boolean(song.description),
    [`${prefix}_has_song_key`]: Boolean(song.songKey),
    [`${prefix}_has_bpm`]: typeof song.bpm === "number",
    [`${prefix}_bpm_bucket`]: bpmBucket(song.bpm),
    [`${prefix}_has_direct_price`]: typeof song.price === "number",
    [`${prefix}_direct_price_bucket`]: numericValueBucket(song.price),
    [`${prefix}_currency_price_count`]: currencyPriceCount,
    [`${prefix}_currency_price_count_bucket`]: countBucket(currencyPriceCount),
    [`${prefix}_has_sheet_music`]: Boolean(song.sheetMusicUrl),
    [`${prefix}_sheet_music_type`]: song.sheetMusicType ?? null,
    [`${prefix}_created_age_bucket`]: daysAgeBucket(song.createdAt),
  };
}

export function getSongsListSummary(
  songs: Song[],
  totalCount: number
): SongbookAnalyticsProperties {
  return {
    visible_song_count: songs.length,
    visible_song_count_bucket: countBucket(songs.length),
    total_song_count: totalCount,
    total_song_count_bucket: countBucket(totalCount),
    visible_with_artist_count: songs.filter((song) => Boolean(song.artist?.id))
      .length,
    visible_with_album_art_count: songs.filter((song) => Boolean(song.albumArt))
      .length,
    visible_with_sheet_music_count: songs.filter((song) =>
      Boolean(song.sheetMusicUrl)
    ).length,
    visible_with_custom_price_count: songs.filter(
      (song) =>
        typeof song.price === "number" ||
        Boolean(
          song.currencyPrices &&
            typeof song.currencyPrices === "object" &&
            Object.values(song.currencyPrices).some(
              (value) => typeof value === "number" && !Number.isNaN(value)
            )
        )
    ).length,
    visible_with_clip_url_count: songs.filter(
      (song) => Boolean(song.coverUrl) || Boolean(song.karaokeUrl)
    ).length,
  };
}

export function getSongPatchSummary(
  patchBody: PatchSongsChannelIdentifierSongIdRequestBody
): SongbookAnalyticsProperties {
  const changedFields = Object.keys(patchBody).sort();
  return {
    changed_field_count: changedFields.length,
    changed_field_count_bucket: countBucket(changedFields.length),
    changed_fields: changedFields,
    changed_identity_fields: changedFields.filter((field) =>
      ["title", "artistName", "categoryNames"].includes(field)
    ).length,
    changed_media_fields: changedFields.filter((field) =>
      ["albumArt", "karaokeUrl", "coverUrl", "originalUrl"].includes(field)
    ).length,
    changed_reference_fields: changedFields.filter((field) =>
      ["lyricsLink", "lyricsText", "description"].includes(field)
    ).length,
    changed_price_fields: changedFields.filter((field) =>
      ["price", "currencyPrices"].includes(field)
    ).length,
    includes_title_change: changedFields.includes("title"),
    includes_artist_change: changedFields.includes("artistName"),
    includes_category_change: changedFields.includes("categoryNames"),
    includes_difficulty_change: changedFields.includes("difficulty"),
    includes_sheet_music_change: changedFields.some((field) =>
      field.startsWith("sheetMusic")
    ),
  };
}

export function getSelectionSummary(
  selectedIds: number[],
  visibleSongs: Song[]
): SongbookAnalyticsProperties {
  const selectedSet = new Set(selectedIds);
  const selectedVisibleSongs = visibleSongs.filter((song) =>
    selectedSet.has(song.id)
  );
  return {
    selected_count: selectedIds.length,
    selected_count_bucket: countBucket(selectedIds.length),
    selected_visible_count: selectedVisibleSongs.length,
    selected_visible_count_bucket: countBucket(selectedVisibleSongs.length),
    selected_with_sheet_music_count: selectedVisibleSongs.filter((song) =>
      Boolean(song.sheetMusicUrl)
    ).length,
    selected_with_custom_price_count: selectedVisibleSongs.filter(
      (song) =>
        typeof song.price === "number" ||
        Boolean(song.currencyPrices && Object.keys(song.currencyPrices).length > 0)
    ).length,
  };
}

export function colorFamily(value: string | null | undefined): string {
  if (!value || !/^#([0-9a-fA-F]{6})$/.test(value)) return "unknown";

  const red = Number.parseInt(value.slice(1, 3), 16) / 255;
  const green = Number.parseInt(value.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(value.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta < 0.08) {
    if (lightness < 0.2) return "near_black";
    if (lightness > 0.85) return "near_white";
    return "gray";
  }

  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  const degrees = (hue * 60 + 360) % 360;
  if (degrees < 20 || degrees >= 345) return "red";
  if (degrees < 45) return "orange";
  if (degrees < 70) return "yellow";
  if (degrees < 165) return "green";
  if (degrees < 195) return "cyan";
  if (degrees < 255) return "blue";
  if (degrees < 290) return "purple";
  if (degrees < 345) return "pink";
  return "unknown";
}

type CategoryFormAnalyticsValues = {
  name?: string | null;
  color?: string | null;
  price?: number | null;
  currencyPrices?: Record<string, number | null> | null;
};

function currencyPriceCount(
  currencyPrices: Record<string, number | null> | null | undefined
): number {
  if (!currencyPrices || typeof currencyPrices !== "object") return 0;
  return Object.values(currencyPrices).filter(
    (value) => typeof value === "number" && !Number.isNaN(value)
  ).length;
}

function normalizedCurrencyPriceEntries(
  currencyPrices: Record<string, number | null> | null | undefined
): string {
  if (!currencyPrices || typeof currencyPrices !== "object") return "";
  return Object.entries(currencyPrices)
    .filter(([, value]) => typeof value === "number" && !Number.isNaN(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
}

export function getCategoryFormSummary(
  values: CategoryFormAnalyticsValues
): SongbookAnalyticsProperties {
  const currencyPrices = values.currencyPrices ?? null;
  const multiPriceCount = currencyPriceCount(currencyPrices);
  const hasDirectPrice =
    typeof values.price === "number" && !Number.isNaN(values.price);

  return {
    category_name_length_bucket: textLengthBucket(values.name),
    category_color_family: colorFamily(values.color),
    category_color_is_default_palette: Boolean(
      values.color && DEFAULT_CATEGORY_COLORS.includes(values.color)
    ),
    category_has_direct_price: hasDirectPrice,
    category_direct_price_bucket: numericValueBucket(values.price),
    category_currency_price_count: multiPriceCount,
    category_currency_price_count_bucket: countBucket(multiPriceCount),
    category_has_any_price: hasDirectPrice || multiPriceCount > 0,
  };
}

export function getCategorySummary(
  category: Partial<Category> | null | undefined,
  prefix = "category"
): SongbookAnalyticsProperties {
  if (!category) {
    return {
      [`${prefix}_id`]: null,
      [`${prefix}_loaded`]: false,
    };
  }

  const songCount = category.songCount ?? 0;
  const multiPriceCount = currencyPriceCount(category.currencyPrices);
  const hasDirectPrice =
    typeof category.price === "number" && !Number.isNaN(category.price);

  return {
    [`${prefix}_id`]: typeof category.id === "number" ? category.id : null,
    [`${prefix}_loaded`]: true,
    [`${prefix}_song_count`]: songCount,
    [`${prefix}_song_count_bucket`]: countBucket(songCount),
    [`${prefix}_has_songs`]: songCount > 0,
    [`${prefix}_color_family`]: colorFamily(category.color),
    [`${prefix}_color_is_default_palette`]: Boolean(
      category.color && DEFAULT_CATEGORY_COLORS.includes(category.color)
    ),
    [`${prefix}_display_order_bucket`]: numericValueBucket(
      category.displayOrder
    ),
    [`${prefix}_has_direct_price`]: hasDirectPrice,
    [`${prefix}_direct_price_bucket`]: numericValueBucket(category.price),
    [`${prefix}_currency_price_count`]: multiPriceCount,
    [`${prefix}_currency_price_count_bucket`]: countBucket(multiPriceCount),
    [`${prefix}_has_any_price`]: hasDirectPrice || multiPriceCount > 0,
    [`${prefix}_created_age_bucket`]: daysAgeBucket(category.createdAt),
  };
}

export function getCategoryListSummary(
  categories: Category[]
): SongbookAnalyticsProperties {
  const categoriesWithSongs = categories.filter(
    (category) => (category.songCount ?? 0) > 0
  );
  const categoriesWithAnyPrice = categories.filter(
    (category) =>
      (typeof category.price === "number" && !Number.isNaN(category.price)) ||
      currencyPriceCount(category.currencyPrices) > 0
  );

  return {
    category_count: categories.length,
    category_count_bucket: countBucket(categories.length),
    categories_with_songs_count: categoriesWithSongs.length,
    categories_with_songs_count_bucket: countBucket(categoriesWithSongs.length),
    categories_without_songs_count:
      categories.length - categoriesWithSongs.length,
    categories_with_price_count: categoriesWithAnyPrice.length,
    categories_with_price_count_bucket: countBucket(categoriesWithAnyPrice.length),
    categories_with_default_palette_color_count: categories.filter(
      (category) =>
        Boolean(category.color) &&
        DEFAULT_CATEGORY_COLORS.includes(category.color)
    ).length,
    categories_with_custom_color_count: categories.filter(
      (category) =>
        Boolean(category.color) &&
        !DEFAULT_CATEGORY_COLORS.includes(category.color)
    ).length,
  };
}

export function getCategorySelectionSummary(
  selectedIds: number[],
  visibleCategories: Category[]
): SongbookAnalyticsProperties {
  const selectedSet = new Set(selectedIds);
  const selectedVisibleCategories = visibleCategories.filter((category) =>
    selectedSet.has(category.id)
  );
  const selectedSongCount = selectedVisibleCategories.reduce(
    (sum, category) => sum + (category.songCount ?? 0),
    0
  );

  return {
    selected_count: selectedIds.length,
    selected_count_bucket: countBucket(selectedIds.length),
    selected_visible_count: selectedVisibleCategories.length,
    selected_visible_count_bucket: countBucket(selectedVisibleCategories.length),
    selected_with_songs_count: selectedVisibleCategories.filter(
      (category) => (category.songCount ?? 0) > 0
    ).length,
    selected_song_count: selectedSongCount,
    selected_song_count_bucket: countBucket(selectedSongCount),
    selected_with_price_count: selectedVisibleCategories.filter(
      (category) =>
        (typeof category.price === "number" && !Number.isNaN(category.price)) ||
        currencyPriceCount(category.currencyPrices) > 0
    ).length,
  };
}

export function getCategoryChangeSummary(
  initialValues: CategoryFormAnalyticsValues | null | undefined,
  nextValues: CategoryFormAnalyticsValues
): SongbookAnalyticsProperties {
  if (!initialValues) {
    return {
      changed_field_count: 0,
      changed_field_count_bucket: "0",
      changed_fields: [],
      includes_name_change: false,
      includes_color_change: false,
      includes_price_change: false,
    };
  }

  const changedFields = [
    (initialValues.name ?? "").trim() !== (nextValues.name ?? "").trim()
      ? "name"
      : null,
    initialValues.color !== nextValues.color ? "color" : null,
    initialValues.price !== nextValues.price ? "price" : null,
    normalizedCurrencyPriceEntries(initialValues.currencyPrices) !==
    normalizedCurrencyPriceEntries(nextValues.currencyPrices)
      ? "currencyPrices"
      : null,
  ].filter((field): field is string => Boolean(field));

  return {
    changed_field_count: changedFields.length,
    changed_field_count_bucket: countBucket(changedFields.length),
    changed_fields: changedFields,
    includes_name_change: changedFields.includes("name"),
    includes_color_change: changedFields.includes("color"),
    includes_price_change:
      changedFields.includes("price") ||
      changedFields.includes("currencyPrices"),
  };
}

type ArtistFormAnalyticsValues = {
  name?: string | null;
};

export function getArtistFormSummary(
  values: ArtistFormAnalyticsValues
): SongbookAnalyticsProperties {
  return {
    artist_name_length_bucket: textLengthBucket(values.name),
    artist_name_present: hasText(values.name),
  };
}

export function getArtistSummary(
  artist: Partial<Artist> | null | undefined,
  prefix = "artist"
): SongbookAnalyticsProperties {
  if (!artist) {
    return {
      [`${prefix}_id`]: null,
      [`${prefix}_loaded`]: false,
    };
  }

  const songCount = artist.songCount ?? 0;

  return {
    [`${prefix}_id`]: typeof artist.id === "number" ? artist.id : null,
    [`${prefix}_loaded`]: true,
    [`${prefix}_song_count`]: songCount,
    [`${prefix}_song_count_bucket`]: countBucket(songCount),
    [`${prefix}_has_songs`]: songCount > 0,
    [`${prefix}_created_age_bucket`]: daysAgeBucket(artist.createdAt),
  };
}

export function getArtistListSummary(
  artists: Artist[]
): SongbookAnalyticsProperties {
  const artistsWithSongs = artists.filter((artist) => (artist.songCount ?? 0) > 0);
  const totalSongCount = artists.reduce(
    (sum, artist) => sum + (artist.songCount ?? 0),
    0
  );

  return {
    artist_count: artists.length,
    artist_count_bucket: countBucket(artists.length),
    artists_with_songs_count: artistsWithSongs.length,
    artists_with_songs_count_bucket: countBucket(artistsWithSongs.length),
    artists_without_songs_count: artists.length - artistsWithSongs.length,
    artist_total_song_count: totalSongCount,
    artist_total_song_count_bucket: countBucket(totalSongCount),
  };
}

export function getArtistSelectionSummary(
  selectedIds: number[],
  visibleArtists: Artist[]
): SongbookAnalyticsProperties {
  const selectedSet = new Set(selectedIds);
  const selectedVisibleArtists = visibleArtists.filter((artist) =>
    selectedSet.has(artist.id)
  );
  const selectedSongCount = selectedVisibleArtists.reduce(
    (sum, artist) => sum + (artist.songCount ?? 0),
    0
  );

  return {
    selected_count: selectedIds.length,
    selected_count_bucket: countBucket(selectedIds.length),
    selected_visible_count: selectedVisibleArtists.length,
    selected_visible_count_bucket: countBucket(selectedVisibleArtists.length),
    selected_with_songs_count: selectedVisibleArtists.filter(
      (artist) => (artist.songCount ?? 0) > 0
    ).length,
    selected_song_count: selectedSongCount,
    selected_song_count_bucket: countBucket(selectedSongCount),
  };
}

export function getArtistChangeSummary(
  initialValues: ArtistFormAnalyticsValues | null | undefined,
  nextValues: ArtistFormAnalyticsValues
): SongbookAnalyticsProperties {
  if (!initialValues) {
    return {
      changed_field_count: 0,
      changed_field_count_bucket: "0",
      changed_fields: [],
      includes_name_change: false,
    };
  }

  const changedFields = [
    (initialValues.name ?? "").trim() !== (nextValues.name ?? "").trim()
      ? "name"
      : null,
  ].filter((field): field is string => Boolean(field));

  return {
    changed_field_count: changedFields.length,
    changed_field_count_bucket: countBucket(changedFields.length),
    changed_fields: changedFields,
    includes_name_change: changedFields.includes("name"),
  };
}

export function getSongRequestSummary(
  request: Partial<SongAddRequest> | null | undefined,
  prefix = "request"
): SongbookAnalyticsProperties {
  if (!request) {
    return {
      [`${prefix}_id`]: null,
      [`${prefix}_loaded`]: false,
    };
  }

  const categoryCount = request.categoryNames?.length ?? 0;

  return {
    [`${prefix}_id`]: typeof request.id === "number" ? request.id : null,
    [`${prefix}_loaded`]: true,
    [`${prefix}_status`]: request.status ?? null,
    [`${prefix}_category_count`]: categoryCount,
    [`${prefix}_category_count_bucket`]: countBucket(categoryCount),
    [`${prefix}_has_album_art`]: Boolean(request.albumArt),
    [`${prefix}_has_karaoke_url`]: Boolean(request.karaokeUrl),
    [`${prefix}_has_cover_url`]: Boolean(request.coverUrl),
    [`${prefix}_has_original_url`]: Boolean(request.originalUrl),
    [`${prefix}_has_any_reference_url`]: Boolean(
      request.karaokeUrl || request.coverUrl || request.originalUrl
    ),
    [`${prefix}_has_lyrics_link`]: Boolean(request.lyricsLink),
    [`${prefix}_has_lyrics_text`]: Boolean(request.lyricsText),
    [`${prefix}_lyrics_text_length_bucket`]: textLengthBucket(request.lyricsText),
    [`${prefix}_difficulty`]:
      typeof request.difficulty === "number" ? request.difficulty : null,
    [`${prefix}_proficiency`]:
      typeof request.proficiency === "number" ? request.proficiency : null,
    [`${prefix}_has_song_key`]: Boolean(request.songKey),
    [`${prefix}_has_bpm`]: typeof request.bpm === "number",
    [`${prefix}_bpm_bucket`]: bpmBucket(request.bpm),
    [`${prefix}_has_rejection_reason`]: Boolean(request.rejectionReason),
    [`${prefix}_has_approved_song`]: Boolean(request.approvedSong?.id),
    [`${prefix}_approved_song_id`]: request.approvedSong?.id ?? null,
    [`${prefix}_created_age_bucket`]: daysAgeBucket(request.createdAt),
    [`${prefix}_processed_age_bucket`]: daysAgeBucket(request.processedAt),
  };
}

export function getSongRequestListSummary(
  requests: SongAddRequest[],
  pendingCount: number,
  statusFilter: SongAddRequestStatus | "all"
): SongbookAnalyticsProperties {
  return {
    request_status_filter: statusFilter,
    visible_request_count: requests.length,
    visible_request_count_bucket: countBucket(requests.length),
    pending_request_count: pendingCount,
    pending_request_count_bucket: countBucket(pendingCount),
    visible_pending_count: requests.filter((request) => request.status === "PENDING")
      .length,
    visible_approved_count: requests.filter(
      (request) => request.status === "APPROVED"
    ).length,
    visible_rejected_count: requests.filter(
      (request) => request.status === "REJECTED"
    ).length,
    visible_canceled_count: requests.filter(
      (request) => request.status === "CANCELED"
    ).length,
    visible_with_album_art_count: requests.filter((request) =>
      Boolean(request.albumArt)
    ).length,
    visible_with_reference_url_count: requests.filter(
      (request) =>
        Boolean(request.karaokeUrl) ||
        Boolean(request.coverUrl) ||
        Boolean(request.originalUrl)
    ).length,
    visible_with_lyrics_count: requests.filter(
      (request) => Boolean(request.lyricsLink) || Boolean(request.lyricsText)
    ).length,
    visible_with_category_count: requests.filter(
      (request) => (request.categoryNames?.length ?? 0) > 0
    ).length,
  };
}

export function getSongRequestApprovalPatchSummary(
  body: ApproveSongAddRequestBody | undefined
): SongbookAnalyticsProperties {
  const changedFields = Object.keys(body ?? {}).sort();
  return {
    approval_modified: changedFields.length > 0,
    changed_field_count: changedFields.length,
    changed_field_count_bucket: countBucket(changedFields.length),
    changed_fields: changedFields,
    changed_identity_fields: changedFields.filter((field) =>
      ["title", "artistName", "categoryNames"].includes(field)
    ).length,
    changed_media_fields: changedFields.filter((field) =>
      ["albumArt", "karaokeUrl", "coverUrl", "originalUrl"].includes(field)
    ).length,
    changed_reference_fields: changedFields.filter((field) =>
      ["lyricsLink", "lyricsText"].includes(field)
    ).length,
    includes_title_change: changedFields.includes("title"),
    includes_artist_change: changedFields.includes("artistName"),
    includes_category_change: changedFields.includes("categoryNames"),
    includes_difficulty_change: changedFields.includes("difficulty"),
    includes_bpm_change: changedFields.includes("bpm"),
  };
}

export function getRejectReasonSummary(
  reason: string | null | undefined
): SongbookAnalyticsProperties {
  return {
    reject_reason_present: hasText(reason),
    reject_reason_length_bucket: textLengthBucket(reason),
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
