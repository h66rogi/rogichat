import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  ThemeCatalogDetailResponseDto,
  ThemeCatalogResponseDto,
} from './upstream/dto/response/overlay-theme.response.dto.js';
import { OverlayThemeCatalogService } from './upstream/overlay-theme-catalog.service.js';

/**
 * 14개 신규 테마 카탈로그 공개 API.
 *
 * 인증 없이 접근 가능하며, 프론트엔드(meloming-front)와 오버레이 렌더러
 * (meloming-overlay)가 테마 메타데이터를 가져갈 때 사용합니다.
 */
@ApiTags('Overlay Theme Catalog')
@Controller('v1/overlay-themes')
export class MelomingOverlayThemeCatalogController {
  constructor(private readonly catalogService: OverlayThemeCatalogService) {}

  @ApiOperation({
    summary: '카탈로그에 등록된 14개 테마 목록 조회',
    description: 'THEME_IDS 선언 순서를 따르는 안정적인 정렬을 보장합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '카탈로그 조회 성공',
    schema: {
      type: 'object',
      properties: {
        themes: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      required: ['themes'],
      additionalProperties: false,
    },
  })
  @Get()
  listThemes(): ThemeCatalogResponseDto {
    return this.catalogService.listThemes();
  }

  @ApiOperation({
    summary: '단일 테마 카탈로그 항목 조회',
    description: '카탈로그에 없는 themeId의 경우 404를 반환합니다.',
  })
  @ApiParam({
    name: 'themeId',
    type: 'string',
    description: '카탈로그 themeId (예: glassmorphism)',
  })
  @ApiResponse({
    status: 200,
    description: '단일 테마 조회 성공',
    schema: {
      type: 'object',
      properties: { theme: { type: 'object', additionalProperties: true } },
      required: ['theme'],
      additionalProperties: false,
    },
  })
  @ApiResponse({ status: 404, description: '테마를 찾을 수 없음' })
  @Get(':themeId')
  getTheme(@Param('themeId') themeId: string): ThemeCatalogDetailResponseDto {
    return this.catalogService.getTheme(themeId);
  }
}
