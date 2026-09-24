import { Injectable, NotFoundException } from '@nestjs/common';
import {
  THEME_CATALOG_LIST,
  getThemeCatalogEntry,
} from './theme-manifest/index.js';
import type { ThemeCatalogEntry } from './theme-manifest/index.js';
import {
  ThemeCatalogDetailResponseDto,
  ThemeCatalogResponseDto,
} from './dto/response/overlay-theme.response.dto.js';

@Injectable()
export class OverlayThemeCatalogService {
  /**
   * 카탈로그에 등록된 14개 신규 테마 메타데이터를 반환합니다.
   *
   * `THEME_CATALOG_LIST`는 `THEME_IDS` 선언 순서를 따르므로 안정적인 정렬을 보장합니다.
   * 카탈로그는 모듈 로드 시점에 deep-freeze되어 있으므로 spread 없이 참조를 그대로
   * 반환해도 안전합니다(돌연변이는 strict mode에서 throw).
   */
  listThemes(): ThemeCatalogResponseDto {
    return { themes: THEME_CATALOG_LIST as ThemeCatalogEntry[] };
  }

  /**
   * 단일 테마 카탈로그 항목을 반환합니다.
   *
   * 카탈로그에 존재하지 않는 themeId의 경우 NotFoundException을 던집니다.
   * (레거시 themeId는 카탈로그에 포함되지 않음)
   */
  getTheme(themeId: string): ThemeCatalogDetailResponseDto {
    const theme = getThemeCatalogEntry(themeId);
    if (!theme) {
      throw new NotFoundException(`theme not found: ${themeId}`);
    }
    return { theme };
  }
}
