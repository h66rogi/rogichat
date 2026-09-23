import { ApiProperty } from '@nestjs/swagger';

export class PsdParseResponseDto {
  @ApiProperty({
    example: 'https://upload-dev.meloming.com/20260425/xxxxxxxx.psd',
    description: '업로드된 원본 PSD URL',
  })
  originalPsdUrl!: string;

  @ApiProperty({
    example: 'https://upload-dev.meloming.com/20260425/xxxxxxxx.png',
    description: 'PSD를 flatten 한 PNG 이미지 URL',
  })
  baseImageUrl!: string;

  @ApiProperty({ example: 1920, description: 'PSD 가로 픽셀' })
  baseImageW!: number;

  @ApiProperty({ example: 1080, description: 'PSD 세로 픽셀' })
  baseImageH!: number;

  @ApiProperty({
    description:
      '자동 추출된 TemplateSpecV1. 프론트 에디터에서 슬롯을 편집한 뒤 POST /schedule-templates 로 저장한다.',
    example: { version: 1, slots: [] },
    type: Object,
    additionalProperties: true,
  })
  templateSpec!: Record<string, unknown>;

  @ApiProperty({
    description:
      '파싱 과정에서 발생한 경고(번들되지 않은 폰트, flatten 실패 등). 치명적이지 않은 정보 메시지.',
    example: [
      "Font 'ComicSans' is not in the bundle, will fall back to Pretendard",
    ],
    type: [String],
  })
  warnings!: string[];
}
