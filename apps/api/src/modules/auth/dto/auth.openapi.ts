import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { boolean, contract, empty, enumeration, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
const opaque = { ...text, minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' };
const startRequest = { oneOf: [object({ intent: enumeration('login'), termsVersion: enumeration('2026-09-20') }, ['intent']), object({ intent: enumeration('link') })] };
export const webSession = object({ authenticated: { ...boolean, enum: [true] }, soopLinkStatus: enumeration('VERIFIED', 'REQUIRED'), csrfToken: opaque, accountPartition: opaque, onboardingState: enumeration('READY', 'SOOP_LINK_REQUIRED'), capabilities: object({ chat: boolean }) });
export const nativeSession = object({ authenticated: { ...boolean, enum: [true] }, account: object({ userId: uuid, nickname: text, avatarAssetId: nullable(uuid) }), soopLinkStatus: enumeration('VERIFIED', 'REQUIRED'), onboardingState: enumeration('READY', 'SOOP_LINK_REQUIRED'), expiresAt: { ...text, format: 'date-time' }, accountGeneration: opaque, accountPartition: opaque, capabilities: object({ chat: boolean }) });
export const authDocs = {
  session: () => contract({ id: 'getSession', summary: '현재 웹·네이티브 세션 조회', response: { oneOf: [webSession, nativeSession] }, description: '웹 세션은 CSRF 토큰을 반환합니다. 네이티브 세션은 본인 계정·고정 만료 시각·onboarding 상태를 반환하며 CSRF 토큰은 없습니다. accountPartition은 같은 환경·키·계정에서 세션/기기/연동 변경과 무관하게 유지되는 불투명한 로컬 저장소 구분자이며 인증·방 참여·재전송 권한이 아닙니다. 키 회전 시 달라지므로 과거 대기 명령을 자동 이관하지 않습니다. accountGeneration은 별도의 무효화 힌트이며 권한 증명이 아닙니다. chat=true는 SOOP 연동 조건 충족이며 모든 방 접근 권한을 뜻하지 않습니다.', errors: [400, 401, 403] }),
  logout: () => contract({ id: 'logout', summary: '현재 세션 폐기', auth: 'write', body: empty, status: 204, errors: [400, 401, 403, 413] }),
  start: () => applyDecorators(contract({ id: 'startSoopAuthentication', summary: 'SOOP 로그인·연동 시작', auth: 'none', body: startRequest,
    response: object({ authorizeUrl: { type: 'string', format: 'uri', description: '이동할 일회성 인증 URL. 로그/저장 금지.' } }), errors: [400, 401, 403, 413, 429],
    description: '허용 웹 Origin과 application/json이 필요합니다. login은 기존 세션이 없어도 가능합니다. link는 기존 쿠키 세션과 X-CSRF-Token이 추가로 필요합니다. 응답은 인증 트랜잭션 쿠키를 설정합니다. 외부 broker가 준비되지 않으면 503입니다.' }),
    ApiHeader({ name: 'Origin', required: true, schema: text }), ApiHeader({ name: 'X-CSRF-Token', required: false, schema: opaque, description: 'intent=link일 때 필수' }),
    ApiResponse({ status: 200, headers: { 'Set-Cookie': { description: 'HttpOnly 트랜잭션 바인딩 쿠키. hosted에서는 Secure/__Host- 접두사.', schema: text } } })),
  callback: () => applyDecorators(contract({ id: 'finishSoopAuthentication', summary: 'SOOP 인증 결과 callback', auth: 'none', status: 303, errors: [400, 401, 403, 429],
    query: [{ name: 'state', required: true, schema: opaque }, { name: 'code', required: false, schema: opaque }, { name: 'error', required: false, schema: enumeration('PROVIDER_DENIED', 'PROVIDER_AUTH_FAILED') }],
    description: 'code 또는 error 중 하나와 시작 단계의 트랜잭션 쿠키가 필요합니다. 저장된 채널에 따라 웹은 성공 시 세션 쿠키를 설정하고, native는 세션 쿠키 없이 일회성 completion code 또는 안전한 error와 returnState를 고정 HTTPS handoff로 보냅니다. 채널·리다이렉트 주소는 호출자가 선택할 수 없습니다. 이 endpoint는 Swagger에서 수동 실행하지 않습니다.' }),
    ApiResponse({ status: 303, description: '저장된 채널의 고정 웹 경로로 이동', headers: { Location: { schema: text, description: '웹 홈/실패 화면 또는 native HTTPS completion handoff' }, 'Set-Cookie': { schema: text, description: '트랜잭션 쿠키 제거. 웹 성공 시에만 세션 쿠키 설정.' } } })),
};
