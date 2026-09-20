import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { boolean, contract, empty, enumeration, object, text } from '../../../common/openapi/schema.js';
const opaque = { ...text, minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' };
const startRequest = { oneOf: [object({ intent: enumeration('login'), termsVersion: enumeration('2026-09-20') }), object({ intent: enumeration('link'), termsVersion: text }, ['intent'])] };
export const authDocs = {
  session: () => contract({ id: 'getSession', summary: '현재 세션과 CSRF 토큰 조회', response: object({ authenticated: { ...boolean, enum: [true] }, soopLinkStatus: enumeration('VERIFIED', 'REQUIRED'), csrfToken: opaque }), errors: [401, 403] }),
  logout: () => contract({ id: 'logout', summary: '현재 세션 폐기', auth: 'write', body: empty, status: 204, errors: [400, 401, 403, 413] }),
  start: () => applyDecorators(contract({ id: 'startSoopAuthentication', summary: 'SOOP 로그인·연동 시작', auth: 'none', body: startRequest,
    response: object({ authorizeUrl: { type: 'string', format: 'uri', description: '이동할 일회성 인증 URL. 로그/저장 금지.' } }), errors: [400, 401, 403, 413, 429],
    description: '허용 웹 Origin과 application/json이 필요합니다. login은 약관 버전을 요구하고 기존 세션이 없어도 가능합니다. link는 기존 쿠키 세션과 X-CSRF-Token이 추가로 필요합니다. 응답은 인증 트랜잭션 쿠키를 설정합니다. 외부 broker가 준비되지 않으면 503입니다.' }),
    ApiHeader({ name: 'Origin', required: true, schema: text }), ApiHeader({ name: 'X-CSRF-Token', required: false, schema: opaque, description: 'intent=link일 때 필수' }),
    ApiResponse({ status: 200, headers: { 'Set-Cookie': { description: 'HttpOnly 트랜잭션 바인딩 쿠키. hosted에서는 Secure/__Host- 접두사.', schema: text } } })),
  callback: () => applyDecorators(contract({ id: 'finishSoopAuthentication', summary: 'SOOP 인증 결과 callback', auth: 'none', status: 303, errors: [400, 401, 403, 429],
    query: [{ name: 'state', required: true, schema: opaque }, { name: 'code', required: false, schema: opaque }, { name: 'error', required: false, schema: enumeration('PROVIDER_DENIED', 'PROVIDER_AUTH_FAILED') }],
    description: 'code 또는 error 중 하나와 시작 단계의 트랜잭션 쿠키가 필요합니다. 성공 시 세션 쿠키를 설정하고 웹으로 303 이동합니다. 이 endpoint는 Swagger에서 수동 실행하지 않습니다.' }),
    ApiResponse({ status: 303, description: '웹 앱으로 이동', headers: { Location: { schema: text, description: '웹 홈 또는 인증 실패 화면' }, 'Set-Cookie': { schema: text, description: '트랜잭션 쿠키 제거 및 성공 시 세션 쿠키 설정' } } })),
};
