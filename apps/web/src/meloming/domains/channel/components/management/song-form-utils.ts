import type {
  PatchSongsChannelIdentifierSongIdRequestBody,
  Song,
} from "@/meloming/domains/channel/types/song";
import type { SongFormValues } from "./song-form.schema";

export function sanitizeCurrencyPriceMap(
  value: unknown
): Record<string, number | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const out: Record<string, number | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (rawValue == null || rawValue === "") {
      out[key] = null;
      continue;
    }
    const amount =
      typeof rawValue === "number" ? rawValue : Number(rawValue);
    out[key] = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : null;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function isEqualCurrencyPriceMap(
  a: Record<string, number | null> | null,
  b: Record<string, number | null> | null
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return !a && !b;
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
}

export function getSongFormInitialValues(song: Song): Partial<SongFormValues> {
  return {
    title: song.title,
    artistName: song.artist?.name ?? "",
    categoryNames: (song.categories ?? []).map((category) => category.name),
    bpm: song.bpm ?? undefined,
    albumArt: song.albumArt ?? "",
    karaokeUrl: song.karaokeUrl ?? "",
    coverUrl: song.coverUrl ?? "",
    originalUrl: song.originalUrl ?? "",
    mrVideoUrl: song.mrVideoUrl ?? null,
    mrVideoKey: song.mrVideoKey ?? null,
    lyricsLink: song.lyricsLink ?? "",
    lyricsText: song.lyricsText ?? "",
    description: song.description ?? "",
    difficulty: song.difficulty ?? 1,
    proficiency: song.proficiency ?? undefined,
    songKey: song.songKey ?? "",
    price: song.price ?? undefined,
    currencyPrices: sanitizeCurrencyPriceMap(song.currencyPrices),
    sheetMusics: song.sheetMusics ?? undefined,
    sheetMusicUrl: song.sheetMusicUrl ?? null,
    sheetMusicType: song.sheetMusicType ?? null,
  };
}

export function buildSongPatchBody(
  initial: Partial<SongFormValues> | undefined,
  current: SongFormValues
): PatchSongsChannelIdentifierSongIdRequestBody {
  if (!initial) {
    throw new Error("Initial values are missing");
  }

  const body: PatchSongsChannelIdentifierSongIdRequestBody = {
    title: current.title,
    artistName: current.artistName,
    categoryNames: current.categoryNames,
    difficulty: current.difficulty,
  };

  const optionalStringFields = [
    "albumArt",
    "karaokeUrl",
    "coverUrl",
    "originalUrl",
    "lyricsLink",
    "lyricsText",
    "description",
    "songKey",
  ] as const;

  for (const field of optionalStringFields) {
    const initialValue = (initial[field] as string | undefined) || "";
    const currentValue = (current[field] as string | undefined) || "";

    if (initialValue !== currentValue) {
      if (currentValue === "") {
        body[field] = null as never;
      } else {
        body[field] = currentValue as never;
      }
    }
  }

  const initialBpm = initial.bpm ?? null;
  const currentBpm = typeof current.bpm === "number" ? current.bpm : null;
  if (initialBpm !== currentBpm) {
    body.bpm = currentBpm;
  }

  const initialProficiency = initial.proficiency ?? null;
  const currentProficiency =
    typeof current.proficiency === "number" ? current.proficiency : null;
  if (initialProficiency !== currentProficiency) {
    body.proficiency = currentProficiency;
  }

  const initialPrice =
    typeof initial.price === "number" ? initial.price : null;
  const currentPrice =
    typeof current.price === "number" ? current.price : null;
  if (initialPrice !== currentPrice) {
    body.price = currentPrice;
  }

  const initialCurrencyPrices = sanitizeCurrencyPriceMap(initial.currencyPrices);
  const currentCurrencyPrices = sanitizeCurrencyPriceMap(current.currencyPrices);
  if (!isEqualCurrencyPriceMap(initialCurrencyPrices, currentCurrencyPrices)) {
    body.currencyPrices = currentCurrencyPrices;
  }

  return body;
}
