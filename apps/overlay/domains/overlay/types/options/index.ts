// Layout-specific option types

// Spotify layout options
export interface SpotifyLayoutOptions {
  progressBarColor: string; // 진행바 색상 (기본: #1DB954)
  backgroundColor: string; // 배경색
  backgroundOpacity: number; // 배경 투명도 (0-1)
  albumArtSize: 'small' | 'medium' | 'large'; // 앨범아트 크기
}

// Apple Music layout options
export interface AppleLayoutOptions {
  theme: 'light' | 'dark'; // 라이트/다크 모드
  blurIntensity: number; // 블러 강도 (0-50)
  accentColor: string; // 강조 색상
}

// Billboard layout options
export interface BillboardLayoutOptions {
  titleFontSize: number; // 제목 크기 (px)
  artistFontSize: number; // 아티스트 크기 (px)
  fontWeight: '400' | '500' | '600' | '700' | '800' | '900'; // 제목 폰트 두께
  artistFontWeight?: '400' | '500' | '600' | '700' | '800' | '900'; // 아티스트 폰트 두께
  textColor: string; // 텍스트 색상
  textAlign: 'left' | 'center' | 'right'; // 정렬
  transparentBackground: boolean; // 투명 배경 여부
  titleLineClamp?: number; // 현재 재생 곡 제목 최대 줄 수 (1=ellipsis, 2+=multi-line clamp). 기본 1
}

// Union type for all layout options
export type LayoutOptions =
  | SpotifyLayoutOptions
  | AppleLayoutOptions
  | BillboardLayoutOptions;

// Default options for each layout.
//
// Only the 3 legacy layouts have entries here. The Phase 3 catalog themes
// (retro-pixel, glassmorphism, etc.) source their default options from the
// theme registry instead.
export const DEFAULT_LAYOUT_OPTIONS = {
  spotify: {
    progressBarColor: '#1DB954',
    backgroundColor: '#191414',
    backgroundOpacity: 1,
    albumArtSize: 'medium',
  } as SpotifyLayoutOptions,

  apple: {
    theme: 'dark',
    blurIntensity: 20,
    accentColor: '#FA243C',
  } as AppleLayoutOptions,

  billboard: {
    titleFontSize: 72,
    artistFontSize: 48,
    fontWeight: '800',
    artistFontWeight: '700',
    textColor: '#FFFFFF',
    textAlign: 'left',
    transparentBackground: true,
    titleLineClamp: 1,
  } as BillboardLayoutOptions,
};

/**
 * Type-safe lookup for legacy layout default options keyed by an arbitrary
 * layout id string. Returns an empty object for non-legacy layout ids
 * (the new Phase 3 catalog themes are loaded from the theme registry, not
 * from this constant). Use this from widget pages whose `layoutType` state
 * is the wider `LayoutType` union that may hold catalog theme ids.
 */
export function getDefaultLayoutOptionsFor(
  layoutType: string,
): Record<string, unknown> {
  const legacyOptions = (
    DEFAULT_LAYOUT_OPTIONS as unknown as Record<
      string,
      Record<string, unknown> | undefined
    >
  )[layoutType];
  return legacyOptions ?? {};
}

// Helper type guard functions
export function isSpotifyOptions(options: unknown): options is SpotifyLayoutOptions {
  return (
    typeof options === 'object' &&
    options !== null &&
    'progressBarColor' in options &&
    'albumArtSize' in options
  );
}

export function isAppleOptions(options: unknown): options is AppleLayoutOptions {
  return (
    typeof options === 'object' &&
    options !== null &&
    'blurIntensity' in options &&
    'accentColor' in options
  );
}

export function isBillboardOptions(options: unknown): options is BillboardLayoutOptions {
  return (
    typeof options === 'object' &&
    options !== null &&
    'titleFontSize' in options &&
    'transparentBackground' in options
  );
}
