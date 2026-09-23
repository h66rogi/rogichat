import { Prisma } from '@prisma/client';

/**
 * ScheduleTemplate 조회/생성 결과 기본 페이로드 타입.
 * 응답 매핑에 필요한 필드만 반환하므로 include 없이 스칼라 필드만 사용.
 */
export type ScheduleTemplateEntity = Prisma.ScheduleTemplateGetPayload<
  Record<string, never>
>;
