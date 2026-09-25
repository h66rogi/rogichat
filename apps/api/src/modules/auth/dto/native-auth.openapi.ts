import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { contract, enumeration, integer, object, text, uuid } from '../../../common/openapi/schema.js';
import { nativeSession } from './auth.openapi.js';

const opaque = { ...text, minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' };
const clientId = enumeration('ios', 'android');
const startFields = { clientId, codeChallenge: opaque, codeChallengeMethod: enumeration('S256'), returnState: opaque };
export const nativeStartRequest = { oneOf: [
  object({ ...startFields, intent: enumeration('login'), termsVersion: enumeration('2026-09-20') }, ['clientId', 'codeChallenge', 'codeChallengeMethod', 'returnState', 'intent']),
  object({ ...startFields, intent: enumeration('link') }),
] };
export const nativeExchangeRequest = object({ clientId, transactionId: uuid, code: opaque,
  codeVerifier: { ...text, minLength: 43, maxLength: 128, pattern: '^[A-Za-z0-9._~-]{43,128}$' } });
// OpenAPI cannot condition a header on a JSON intent. Document both alternatives
// and the strict runtime rule; neither allows browser session/CSRF credentials.
const nativeAdmission = () => applyDecorators(
  ApiHeader({ name: 'X-Rogi-Client', required: true, schema: clientId, description: 'JSON clientId 및 기존 link 토큰의 클라이언트와 일치해야 합니다.' }),
  ApiHeader({ name: 'Authorization', required: false, schema: text, description: 'login에서는 금지. link는 시작에 사용한 최근 인증 native Bearer 세션이 시작·교환 모두 필수입니다.' }),
);
const security: Record<string, string[]>[] = [{ nativeClient: [] }, { nativeBearer: [], nativeClient: [] }];
const admission = 'application/json과 X-Rogi-Client가 필수입니다. Origin, 웹 세션 쿠키, X-CSRF-Token 및 중복 인증 헤더는 허용하지 않습니다. login은 Authorization 없이, link는 동일한 기존 native Bearer로 요청합니다. ';
export const nativeAuthDocs = {
  start: () => applyDecorators(contract({ id: 'startNativeSoopAuthentication', summary: '네이티브 SOOP 인증 트랜잭션 시작', auth: 'none', security,
    body: nativeStartRequest, response: object({ transactionId: uuid, authorizeUrl: { ...text, format: 'uri' }, expiresIn: { ...integer, enum: [600] } }),
    errors: [400, 401, 403, 413, 429], description: admission + '앱이 생성한 S256 challenge와 returnState를 바인딩합니다. 전체 트랜잭션은 600초, 반환된 일회성 launch URL은 60초입니다. 앱이 시스템 브라우저로 URL을 열어야 하며 URL·코드·토큰은 로그에 남기지 않습니다. broker 미설정은 503이며 세션 쿠키를 발급하지 않습니다.' }), nativeAdmission()),
  launch: () => applyDecorators(contract({ id: 'launchNativeSoopAuthentication', summary: '시스템 브라우저에서 네이티브 인증 시작', auth: 'none', status: 303,
    query: [{ name: 'request', required: true, schema: opaque }], errors: [400, 401, 403, 429],
    description: '60초 일회성 launch ticket을 소비하고 HttpOnly 트랜잭션 쿠키를 설정한 뒤 서버가 검증한 인증 주소로 이동합니다. URL 내 ticket은 세션 토큰이 아니며 로그·저장·재사용을 금지합니다. 모바일 앱의 Bearer를 브라우저에 전달하지 않습니다.' }),
    ApiResponse({ status: 303, description: '인증 브라우저 이동', headers: { Location: { schema: text }, 'Set-Cookie': { schema: text, description: '해당 트랜잭션에만 바인딩된 HttpOnly 쿠키' } } })),
  exchange: () => applyDecorators(contract({ id: 'exchangeNativeSoopCompletion', summary: '네이티브 일회성 완료 코드 교환', auth: 'none', security, body: nativeExchangeRequest,
    response: object({ tokenType: enumeration('Bearer'), accessToken: opaque, expiresAt: { ...text, format: 'date-time' }, session: nativeSession }),
    errors: [400, 401, 403, 409, 413, 429], description: admission + '앱이 handoff의 state를 자체 보관한 returnState와 먼저 비교한 뒤 120초 일회성 code와 원래 PKCE verifier를 제출합니다. 새 opaque credential은 고정 7일 만료이며 자동 갱신되지 않습니다. 성공 응답의 토큰은 OS 보안 저장소에만 보관합니다. 서버는 평문 토큰을 보관하지 않아 성공 ACK 유실 시 동일 코드로 복구할 수 없으며 다시 인증해야 합니다. 본인 계정만 반환하고 세션 쿠키를 발급하지 않습니다.' }), nativeAdmission()),
};
