import { z } from "zod";

const sheetMusicTypeSchema = z.enum(["PDF", "IMAGE", "MUSICXML"]);

// Phase 2 — 폼 내부에서 SheetMusicSection 이 array 로 관리. 폼 자체는 슬롯
// CRUD 를 직접 다루지 않고 (별도 endpoint 호출), 단순히 backend response 를
// hydrate 용으로 받는다.
const sheetMusicSlotSchema = z.object({
  id: z.number(),
  url: z.string(),
  type: sheetMusicTypeSchema,
  fileName: z.string().nullable(),
  fileSize: z.number().nullable(),
  sortOrder: z.number(),
});

const baseSongFormSchema = z.object({
  title: z.string().min(1, "노래 제목을 입력해주세요"),
  artistName: z.string().min(1, "가수명을 입력해주세요"),
  categoryNames: z
    .array(z.string().min(1))
    .min(1, "카테고리를 하나 이상 선택해주세요"),
  albumArt: z.string().url().optional().or(z.literal("")),
  karaokeUrl: z.string().url().optional().or(z.literal("")),
  coverUrl: z.string().url().optional().or(z.literal("")),
  originalUrl: z.string().url().optional().or(z.literal("")),
  mrVideoUrl: z.string().url().nullable().optional(),
  mrVideoKey: z.string().nullable().optional(),
  lyricsLink: z.string().url().optional().or(z.literal("")),
  difficulty: z.number().min(1).max(5).default(1),
  proficiency: z.number().min(1).max(5).optional(),
  songKey: z.string().optional().or(z.literal("")),
  bpm: z.coerce.number().min(40).max(300).optional().or(z.literal("")),
  lyricsText: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  price: z.coerce.number().min(0).optional().or(z.literal("")).or(z.literal(null)),
  currencyPrices: z
    .record(z.string(), z.number().nullable())
    .optional()
    .or(z.literal(null)),
  // 악보. Phase 2 신 contract = sheetMusics array. Phase 2C 까지 legacy
  // sheetMusicUrl/Type 도 hydrate fallback 으로 유지.
  sheetMusics: z.array(sheetMusicSlotSchema).optional(),
  sheetMusicUrl: z.string().url().nullable().optional(),
  sheetMusicType: sheetMusicTypeSchema.nullable().optional(),
});

// Excel 업로드 모달 등에서 가수/카테고리 없이도 저장할 수 있도록 완화된 스키마
const baseRelaxedSongFormSchema = z.object({
  title: z.string().min(1, "노래 제목을 입력해주세요"),
  artistName: z.string().optional().or(z.literal("")),
  categoryNames: z
    .array(z.string())
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      if (Array.isArray(v)) return v;
      return [] as string[];
    }),
  albumArt: z.string().url().optional().or(z.literal("")),
  karaokeUrl: z.string().url().optional().or(z.literal("")),
  coverUrl: z.string().url().optional().or(z.literal("")),
  originalUrl: z.string().url().optional().or(z.literal("")),
  mrVideoUrl: z.string().url().nullable().optional(),
  mrVideoKey: z.string().nullable().optional(),
  lyricsLink: z.string().url().optional().or(z.literal("")),
  difficulty: z.number().min(1).max(5).default(1),
  proficiency: z.number().min(1).max(5).optional(),
  songKey: z.string().optional().or(z.literal("")),
  bpm: z.coerce.number().min(40).max(300).optional().or(z.literal("")),
  lyricsText: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  price: z.coerce.number().min(0).optional().or(z.literal("")).or(z.literal(null)),
  currencyPrices: z
    .record(z.string(), z.number().nullable())
    .optional()
    .or(z.literal(null)),
  // 악보. Phase 2 신 contract = sheetMusics array. Phase 2C 까지 legacy
  // sheetMusicUrl/Type 도 hydrate fallback 으로 유지.
  sheetMusics: z.array(sheetMusicSlotSchema).optional(),
  sheetMusicUrl: z.string().url().nullable().optional(),
  sheetMusicType: sheetMusicTypeSchema.nullable().optional(),
});

const requireProficiency = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((values, ctx) => {
    const proficiency = (values as { proficiency?: unknown }).proficiency;
    if (
      typeof proficiency !== "number" ||
      !Number.isInteger(proficiency) ||
      proficiency < 1 ||
      proficiency > 5
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proficiency"],
        message: "숙련도를 선택해주세요",
      });
    }
  });

export function createSongFormSchema(options?: {
  relaxed?: boolean;
  requireProficiency?: boolean;
}) {
  const schema = options?.relaxed
    ? baseRelaxedSongFormSchema
    : baseSongFormSchema;
  return options?.requireProficiency ? requireProficiency(schema) : schema;
}

export const songFormSchema = baseSongFormSchema;
export const relaxedSongFormSchema = baseRelaxedSongFormSchema;

export type SongFormValues = z.input<typeof baseSongFormSchema>;
