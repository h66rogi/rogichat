import { ScheduleTemplateResponseDto } from '../dto/response/schedule-template.response.dto';
import { ScheduleTemplateEntity } from '../types/schedule-template-with-relations.type';

function toTemplateSpec(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // 배열/원시값 등 예외 케이스는 그대로 감싸 반환
  return { value } as Record<string, unknown>;
}

export function toScheduleTemplateResponse(
  row: ScheduleTemplateEntity,
): ScheduleTemplateResponseDto {
  return {
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    isDefault: row.isDefault,
    baseImageUrl: row.baseImageUrl,
    baseImageW: row.baseImageW,
    baseImageH: row.baseImageH,
    templateSpec: toTemplateSpec(row.templateSpec as unknown),
    originalPsdUrl: row.originalPsdUrl ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
