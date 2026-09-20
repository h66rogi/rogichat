import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject, ParameterObject } from '@nestjs/swagger';
export type Schema = SchemaObject;
export const text: Schema = { type: 'string' };
export const uuid: Schema = { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
export const boolean: Schema = { type: 'boolean' };
export const integer: Schema = { type: 'integer' };
export const decimal: Schema = { type: 'string', pattern: '^[0-9]+$', example: '1', description: '정밀도를 보존하는 정수 문자열' };
export const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
export const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
export const array = (items: Schema): Schema => ({ type: 'array', items });
export const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
export const empty = object({});
export const afterQuery = { name: 'after', required: false, schema: uuid, description: '이전 페이지의 next/nextCursor UUID. 최대 50개 반환.' };
export const errorSchema = object({ error: object({ code: { type: 'string', description: '안전한 오류 코드. 내부 예외/개인정보는 반환하지 않습니다.' } }) });
const errorDescriptions: Record<number, string> = {
  400: '입력 또는 커서 형식 오류', 401: '유효한 세션이 없음', 403: '권한·Origin·CSRF 또는 SOOP 연동 조건 불충족',
  404: '대상이 없거나 현재 사용자에게 보이지 않음', 409: '현재 상태 또는 멱등 요청 내용 충돌',
  413: '요청 본문 크기 초과', 429: '요청 빈도 또는 처리 용량 초과', 500: '내부 처리 실패', 503: '일시적 의존성 장애 또는 종료 중',
};
interface Operation {
  id: string; summary: string; description?: string; auth?: 'read' | 'write' | 'none';
  params?: string[]; query?: Omit<ParameterObject, 'in'>[]; body?: Schema; bodyRequired?: boolean;
  response?: Schema; status?: number; errors?: number[]; binary?: boolean;
}
/** Documentation only. Authorization and validation remain in the existing application services. */
export function contract(options: Operation): MethodDecorator {
  const auth = options.auth ?? 'read';
  const security = auth === 'none' ? [] : [...(auth === 'write' ? [{ browserSession: [], csrf: [] }] : [{ browserSession: [] }]), { nativeBearer: [], nativeClient: [] }];
  return applyDecorators(
    ApiOperation({ operationId: options.id, summary: options.summary, description: options.description ?? options.summary, security }),
    ...((options.params ?? []).map(name => ApiParam({ name, schema: uuid }))),
    ...((options.query ?? []).map(query => ApiQuery(query))),
    ...(auth === 'write' ? [ApiHeader({ name: 'Origin', required: false, description: '웹 쿠키 요청에서는 필수이며 허용 웹 Origin과 일치해야 합니다. 네이티브 요청에는 필수가 아닙니다.', schema: text })] : []),
    ...(auth !== 'none' ? [ApiHeader({ name: 'X-Rogi-Client', required: false, schema: enumeration('ios', 'android'), description: '네이티브 Bearer 요청에서는 필수입니다. 토큰에 바인딩된 클라이언트와 일치해야 하며 웹 쿠키/CSRF와 혼용할 수 없습니다.' })] : []),
    ...(options.binary ? [ApiConsumes('application/octet-stream')] : []),
    ...(options.body ? [ApiBody({ required: options.bodyRequired ?? true, schema: options.body })] : []),
    ApiResponse({ status: options.status ?? 200, description: options.status === 204 ? '처리 완료. 본문 없음.' : '처리 결과', ...(options.response ? { schema: options.response } : {}) }),
    ...[...new Set([...(options.errors ?? [400, 401, 403, 404]), ...(auth === 'none' ? [] : [400]), 500, 503])].map(status => ApiResponse({ status, description: errorDescriptions[status]!, schema: errorSchema })),
  );
}
