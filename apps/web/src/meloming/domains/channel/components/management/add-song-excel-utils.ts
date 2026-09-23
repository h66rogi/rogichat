import type { PostSongsChannelIdentifierBulkRequestBody } from "@/meloming/domains/channel/types/song";
import type { SongFormValues } from "./song-form.schema";

export const EXCEL_BULK_SONG_LIMIT = 500;

export const ADD_SONG_EXCEL_COLUMN_LABELS = [
  "*노래 제목",
  "*아티스트",
  "*카테고리",
  "난이도 (1-5)",
  "숙련도 (1-5)",
  "음정(키)",
  "BPM",
  "가사 링크",
  "설명",
  "앨범아트",
  "노래방 URL",
  "커버 URL",
  "원곡 URL",
] as const;

export type SheetRow = {
  title: string;
  artist: string;
  category: string;
  difficulty?: string;
  proficiency?: string;
  songKey?: string;
  bpm?: string;
  lyricsLink?: string;
  description?: string;
  albumArt?: string;
  karaokeUrl?: string;
  coverUrl?: string;
  originalUrl?: string;
  rowNumber?: number;
};

type SheetRowKey = Exclude<keyof SheetRow, "rowNumber">;

export type ExcelValidationIssue = {
  rowNumber: number | null;
  field: string;
  message: string;
};

export type ExcelSkippedRow = {
  rowNumber: number;
  title: string;
  artistName: string;
  reason: "duplicate_in_sheet";
  firstRowNumber: number;
};

export type ParsedExcelRowsResult =
  | {
      ok: true;
      rows: SheetRow[];
      headerRowIndex: number;
    }
  | {
      ok: false;
      rows: SheetRow[];
      headerRowIndex: number;
      message: string;
    };

export type BulkCreateValidationResult = {
  issues: ExcelValidationIssue[];
  songs: PostSongsChannelIdentifierBulkRequestBody["songs"];
  skippedRows: ExcelSkippedRow[];
};

export type AlbumArtMappingRequest = {
  rowIndex: number;
  key: string;
  title: string;
  artist: string;
  albumArtAtRequest: string;
};

export type ApplyAlbumArtMappingsResult = {
  rows: SheetRow[];
  albumArtByKey: Record<string, string>;
  appliedCount: number;
};

type AlbumArtBulkResult = {
  success?: boolean;
  requestIndex: number;
  result?: {
    albumArt?: string | null;
  } | null;
};

const COLUMN_ALIASES: Record<SheetRowKey, string[]> = {
  title: ["*노래 제목", "노래 제목"],
  artist: ["*아티스트", "아티스트"],
  category: ["*카테고리", "카테고리"],
  difficulty: ["난이도 (1-5)", "난이도"],
  proficiency: ["숙련도 (1-5)", "숙련도"],
  songKey: ["음정(키)", "음정", "키"],
  bpm: ["BPM"],
  lyricsLink: ["가사 링크"],
  description: ["설명"],
  albumArt: ["앨범아트", "앨범 아트"],
  karaokeUrl: ["노래방 URL", "노래방 url"],
  coverUrl: ["커버 URL", "커버 url"],
  originalUrl: ["원곡 URL", "원곡 url"],
};

const REQUIRED_KEYS: SheetRowKey[] = ["title", "artist", "category"];

export function getSheetRowKeyByColumnLabel(
  label: string
): SheetRowKey | undefined {
  const normalizedLabel = normalizeHeaderLabel(label);
  return (Object.keys(COLUMN_ALIASES) as SheetRowKey[]).find((key) =>
    COLUMN_ALIASES[key].some(
      (candidate) => normalizeHeaderLabel(candidate) === normalizedLabel
    )
  );
}

export function getSheetRowKeyByColumnIndex(
  columnLabels: readonly string[],
  columnIndex: number
): SheetRowKey | undefined {
  const label = columnLabels[columnIndex];
  return label ? getSheetRowKeyByColumnLabel(label) : undefined;
}

export function parseFortuneSheetRows(
  sheetDataArray: unknown[],
  columnLabels: readonly string[]
): SheetRow[] {
  const sheet = sheetDataArray[0];
  if (!isRecord(sheet)) return [];

  // FortuneSheet keeps `celldata` for some operations, but `data` is the
  // current matrix after row delete / cell clear. Prefer it when available.
  const dataMatrix = sheet.data;
  if (Array.isArray(dataMatrix)) {
    return parseFortuneSheetDataMatrix(dataMatrix, columnLabels);
  }

  const celldata = sheet.celldata;
  if (Array.isArray(celldata)) {
    return parseFortuneSheetCelldata(celldata, columnLabels);
  }

  return [];
}

export function parseExcelRows(rawRows: unknown[][]): ParsedExcelRowsResult {
  const headerRowIndex = findHeaderRowIndex(rawRows);
  if (headerRowIndex < 0) {
    return {
      ok: false,
      rows: [],
      headerRowIndex: -1,
      message:
        "엑셀 파일에서 필수 헤더(*노래 제목, *아티스트, *카테고리)를 찾을 수 없습니다.",
    };
  }

  const headerRow = rawRows[headerRowIndex] ?? [];
  const indexByKey = buildHeaderIndexMap(headerRow);
  const missingRequired = REQUIRED_KEYS.filter(
    (key) => indexByKey[key] === undefined
  );

  if (missingRequired.length > 0) {
    return {
      ok: false,
      rows: [],
      headerRowIndex,
      message: `필수 헤더가 누락되었습니다: ${missingRequired
        .map((key) => COLUMN_ALIASES[key][0])
        .join(", ")}`,
    };
  }

  const rows: SheetRow[] = [];
  rawRows.slice(headerRowIndex + 1).forEach((rawRow, index) => {
    if (!Array.isArray(rawRow)) return;
    const row: SheetRow = {
      title: readCell(rawRow, indexByKey.title),
      artist: readCell(rawRow, indexByKey.artist),
      category: readCell(rawRow, indexByKey.category),
      difficulty: readCell(rawRow, indexByKey.difficulty),
      proficiency: readCell(rawRow, indexByKey.proficiency),
      songKey: readCell(rawRow, indexByKey.songKey),
      bpm: readCell(rawRow, indexByKey.bpm),
      lyricsLink: readCell(rawRow, indexByKey.lyricsLink),
      description: readCell(rawRow, indexByKey.description),
      albumArt: readCell(rawRow, indexByKey.albumArt),
      karaokeUrl: readCell(rawRow, indexByKey.karaokeUrl),
      coverUrl: readCell(rawRow, indexByKey.coverUrl),
      originalUrl: readCell(rawRow, indexByKey.originalUrl),
      rowNumber: headerRowIndex + index + 2,
    };
    if (isMeaningfulSheetRow(row)) rows.push(row);
  });

  return { ok: true, rows, headerRowIndex };
}

export function isMeaningfulSheetRow(row: SheetRow): boolean {
  return (Object.keys(COLUMN_ALIASES) as SheetRowKey[]).some((key) => {
    const value = row[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function getSongKey(title: string, artistName: string): string {
  return `${title.trim()}::${artistName.trim()}`;
}

export function toPreviewSongs(
  rows: SheetRow[],
  albumArtByKey: Record<string, string | undefined>
): SongFormValues[] {
  return rows.filter(isMeaningfulSheetRow).map((row) => {
    const title = row.title.trim();
    const artistName = row.artist.trim();
    const albumArt = resolveAlbumArt(row, albumArtByKey);

    return {
      title,
      artistName,
      categoryNames: splitCategoryNames(row.category),
      albumArt,
      karaokeUrl: row.karaokeUrl?.trim() || "",
      coverUrl: row.coverUrl?.trim() || "",
      originalUrl: row.originalUrl?.trim() || "",
      lyricsLink: row.lyricsLink?.trim() || "",
      description: row.description?.trim() || "",
      difficulty: parseIntegerInRange(row.difficulty, 1, 5) ?? 1,
      proficiency: parseIntegerInRange(row.proficiency, 1, 5),
      songKey: row.songKey?.trim() || "",
      bpm: parseIntegerInRange(row.bpm, 40, 300),
      lyricsText: "",
    };
  });
}

export function buildBulkCreateSongs(
  rows: SheetRow[],
  albumArtByKey: Record<string, string | undefined>
): BulkCreateValidationResult {
  const meaningfulRows = rows.filter(isMeaningfulSheetRow);
  const issues: ExcelValidationIssue[] = [];
  const songs: PostSongsChannelIdentifierBulkRequestBody["songs"] = [];
  const skippedRows: ExcelSkippedRow[] = [];

  const seen = new Map<string, number>();

  meaningfulRows.forEach((row, rowIndex) => {
    const rowNumber = row.rowNumber ?? rowIndex + 1;
    const issueCountBeforeRow = issues.length;
    const title = row.title.trim();
    const artistName = row.artist.trim();
    const categoryNames = splitCategoryNames(row.category);
    const difficulty = parseIntegerInRange(row.difficulty, 1, 5);
    const proficiency = parseIntegerInRange(row.proficiency, 1, 5);
    const bpm = parseIntegerInRange(row.bpm, 40, 300);
    const resolvedAlbumArt = resolveAlbumArt(row, albumArtByKey);

    if (!title) {
      issues.push({
        rowNumber,
        field: "노래 제목",
        message: "노래 제목을 입력해주세요.",
      });
    }
    if (!artistName) {
      issues.push({
        rowNumber,
        field: "아티스트",
        message: "아티스트를 입력해주세요.",
      });
    }
    if (categoryNames.length === 0) {
      issues.push({
        rowNumber,
        field: "카테고리",
        message: "카테고리를 하나 이상 입력해주세요.",
      });
    }

    if (row.difficulty?.trim() && difficulty === undefined) {
      issues.push({
        rowNumber,
        field: "난이도",
        message: "난이도는 1부터 5까지의 정수로 입력해주세요.",
      });
    }
    if (row.proficiency?.trim() && proficiency === undefined) {
      issues.push({
        rowNumber,
        field: "숙련도",
        message: "숙련도는 1부터 5까지의 정수로 입력해주세요.",
      });
    }
    if (row.bpm?.trim() && bpm === undefined) {
      issues.push({
        rowNumber,
        field: "BPM",
        message: "BPM은 40부터 300까지의 정수로 입력해주세요.",
      });
    }

    validateOptionalHttpUrl(issues, rowNumber, "앨범아트", resolvedAlbumArt);
    validateOptionalHttpUrl(issues, rowNumber, "노래방 URL", row.karaokeUrl);
    validateOptionalHttpUrl(issues, rowNumber, "커버 URL", row.coverUrl);
    validateOptionalHttpUrl(issues, rowNumber, "원곡 URL", row.originalUrl);
    validateOptionalHttpUrl(issues, rowNumber, "가사 링크", row.lyricsLink);

    if (title && artistName) {
      const duplicateKey = normalizeDuplicateKey(title, artistName);
      const firstRowNumber = seen.get(duplicateKey);
      if (firstRowNumber !== undefined) {
        skippedRows.push({
          rowNumber,
          title,
          artistName,
          reason: "duplicate_in_sheet",
          firstRowNumber,
        });
        return;
      } else {
        seen.set(duplicateKey, rowNumber);
      }
    }

    if (issues.length > issueCountBeforeRow) return;

    songs.push({
      title,
      artistName,
      categoryNames,
      ...(resolvedAlbumArt ? { albumArt: resolvedAlbumArt } : {}),
      ...(row.karaokeUrl?.trim() ? { karaokeUrl: row.karaokeUrl.trim() } : {}),
      ...(row.coverUrl?.trim() ? { coverUrl: row.coverUrl.trim() } : {}),
      ...(row.originalUrl?.trim() ? { originalUrl: row.originalUrl.trim() } : {}),
      ...(difficulty !== undefined ? { difficulty } : {}),
      ...(proficiency !== undefined ? { proficiency } : {}),
      ...(row.songKey?.trim() ? { songKey: row.songKey.trim() } : {}),
      ...(bpm !== undefined ? { bpm } : {}),
      ...(row.lyricsLink?.trim() ? { lyricsLink: row.lyricsLink.trim() } : {}),
      ...(row.description?.trim() ? { description: row.description.trim() } : {}),
    });
  });

  if (songs.length > EXCEL_BULK_SONG_LIMIT) {
    issues.push({
      rowNumber: null,
      field: "곡 수",
      message: `한 번에 최대 ${EXCEL_BULK_SONG_LIMIT}곡까지만 등록할 수 있습니다.`,
    });
  }

  if (
    meaningfulRows.length > 0 &&
    songs.length + skippedRows.length !== meaningfulRows.length
  ) {
    return { issues, songs: [], skippedRows };
  }

  return { issues, songs: issues.length === 0 ? songs : [], skippedRows };
}

export function getSuccessfulAlbumArtResults<T extends AlbumArtBulkResult>(
  results: T[]
): T[] {
  return results.filter(
    (result) => result.success === true && !!result.result?.albumArt?.trim()
  );
}

export function buildAlbumArtMappingRequests(
  rows: SheetRow[]
): AlbumArtMappingRequest[] {
  return rows
    .map((row, rowIndex) => {
      const title = row.title.trim();
      const artist = row.artist.trim();
      return {
        rowIndex,
        key: getSongKey(title, artist),
        title,
        artist,
        albumArtAtRequest: row.albumArt?.trim() ?? "",
      };
    })
    .filter(
      (request) => request.title.length > 0 && request.artist.length > 0
    );
}

export function applyAlbumArtMappings<T extends AlbumArtBulkResult>(
  rows: SheetRow[],
  requests: AlbumArtMappingRequest[],
  results: T[]
): ApplyAlbumArtMappingsResult {
  let changed = false;
  let appliedCount = 0;
  const nextRows = rows.map((row) => ({ ...row }));
  const albumArtByKey: Record<string, string> = {};

  for (const result of getSuccessfulAlbumArtResults(results)) {
    const request = requests[result.requestIndex];
    const newAlbumArt = result.result?.albumArt?.trim();
    if (!request || !newAlbumArt) continue;

    const currentRow = nextRows[request.rowIndex];
    if (!currentRow) continue;
    if (getSongKey(currentRow.title, currentRow.artist) !== request.key) {
      continue;
    }
    if ((currentRow.albumArt?.trim() ?? "") !== request.albumArtAtRequest) {
      continue;
    }

    appliedCount++;
    albumArtByKey[request.key] = newAlbumArt;
    if ((currentRow.albumArt?.trim() ?? "") === newAlbumArt) continue;

    nextRows[request.rowIndex] = {
      ...currentRow,
      albumArt: newAlbumArt,
    };
    changed = true;
  }

  return {
    rows: changed ? nextRows : rows,
    albumArtByKey,
    appliedCount,
  };
}

export function formatValidationIssue(issue: ExcelValidationIssue): string {
  const prefix = issue.rowNumber ? `${issue.rowNumber}행 ${issue.field}` : issue.field;
  return `${prefix}: ${issue.message}`;
}

function findHeaderRowIndex(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    if (!Array.isArray(row)) return false;
    const indexMap = buildHeaderIndexMap(row);
    return REQUIRED_KEYS.every((key) => indexMap[key] !== undefined);
  });
}

function buildHeaderIndexMap(row: unknown[]): Partial<Record<SheetRowKey, number>> {
  const indexMap: Partial<Record<SheetRowKey, number>> = {};
  row.forEach((cell, index) => {
    const key = getSheetRowKeyByColumnLabel(readUnknownCell(cell));
    if (key && indexMap[key] === undefined) indexMap[key] = index;
  });
  return indexMap;
}

function readCell(row: unknown[], index: number | undefined): string {
  return index === undefined ? "" : readUnknownCell(row[index]);
}

function parseFortuneSheetDataMatrix(
  dataMatrix: unknown[],
  columnLabels: readonly string[]
): SheetRow[] {
  const rows: SheetRow[] = [];
  for (let r = 1; r < dataMatrix.length; r++) {
    const rowCells = dataMatrix[r];
    if (!Array.isArray(rowCells)) continue;

    const row = createEmptySheetRow(r + 1);
    for (let c = 0; c < columnLabels.length; c++) {
      const key = getSheetRowKeyByColumnIndex(columnLabels, c);
      if (!key) continue;
      row[key] = readFortuneSheetCellValue(rowCells[c]);
    }
    if (isMeaningfulSheetRow(row)) rows.push(row);
  }
  return rows;
}

function parseFortuneSheetCelldata(
  celldata: unknown[],
  columnLabels: readonly string[]
): SheetRow[] {
  const rows = new Map<number, SheetRow>();
  celldata.forEach((cell) => {
    if (!isRecord(cell)) return;
    const r = cell.r;
    const c = cell.c;
    if (typeof r !== "number" || typeof c !== "number") return;
    if (r === 0) return;

    const key = getSheetRowKeyByColumnIndex(columnLabels, c);
    if (!key) return;

    if (!rows.has(r)) rows.set(r, createEmptySheetRow(r + 1));
    const row = rows.get(r)!;
    row[key] = readFortuneSheetCellValue(cell.v);
  });

  return Array.from(rows.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row)
    .filter(isMeaningfulSheetRow);
}

function createEmptySheetRow(rowNumber: number): SheetRow {
  return {
    title: "",
    artist: "",
    category: "",
    rowNumber,
  };
}

function readFortuneSheetCellValue(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  if (!isRecord(cell)) return String(cell).trim();

  const raw = cell.v ?? cell.m ?? cell.text;
  if (raw === undefined || raw === null) return "";
  if (raw instanceof Date) return raw.toISOString();
  if (isRecord(raw)) return readFortuneSheetCellValue(raw);
  return String(raw).trim();
}

function readUnknownCell(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "object") {
    const record = cell as Record<string, unknown>;
    const raw = record.v ?? record.m ?? record.text ?? "";
    if (isRecord(raw)) return readUnknownCell(raw);
    return String(raw ?? "").trim();
  }
  return String(cell).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeHeaderLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function splitCategoryNames(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,/|]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveAlbumArt(
  row: SheetRow,
  albumArtByKey: Record<string, string | undefined>
): string {
  if (row.albumArt !== undefined) return row.albumArt.trim();
  return (albumArtByKey[getSongKey(row.title, row.artist)] ?? "").trim();
}

function parseIntegerInRange(
  value: string | undefined,
  min: number,
  max: number
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const numberValue = Number(trimmed);
  if (!Number.isInteger(numberValue)) return undefined;
  return numberValue >= min && numberValue <= max ? numberValue : undefined;
}

function validateOptionalHttpUrl(
  issues: ExcelValidationIssue[],
  rowNumber: number | null,
  field: string,
  value: string | undefined
): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (isHttpUrl(trimmed)) return;
  issues.push({
    rowNumber,
    field,
    message: "https:// 또는 http:// 로 시작하는 올바른 URL을 입력해주세요.",
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeDuplicateKey(title: string, artistName: string): string {
  return `${normalizeComparable(title)}::${normalizeComparable(artistName)}`;
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
