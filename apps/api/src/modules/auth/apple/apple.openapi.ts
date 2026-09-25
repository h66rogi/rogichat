import { applyDecorators } from '@nestjs/common';
import { ApiConsumes } from '@nestjs/swagger';
import { contract, enumeration, integer, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
import { nativeSession, webSession } from '../dto/auth.openapi.js';

const opaque = { ...text, minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' };
const verifier = { ...text, minLength: 43, maxLength: 128, pattern: '^[A-Za-z0-9._~-]{43,128}$' };
const client = enumeration('ios', 'android', 'web');
const fields = { clientId: client, codeChallenge: opaque, returnState: opaque };
const security = [{}, { nativeBearer: [], nativeClient: [] }, { browserSession: [], csrf: [] }];
const description = 'Optional real Apple configuration; absent configuration returns 503. login accepts no existing session; link requires the original recent session, client and generation throughout. Native uses X-Rogi-Client and optional Bearer for link; web uses Origin, cookies and CSRF. No email/name account matching. See docs/apple-auth-client-contract.md.';
export const appleDocs = {
  start: () => contract({ id: 'startAppleAuthentication', summary: 'Apple 로그인 또는 명시적 연결 시작', auth: 'none', security, description,
    body: { oneOf: [object({ ...fields, intent: enumeration('login'), termsVersion: enumeration('2026-09-20') }, ['clientId', 'codeChallenge', 'returnState', 'intent']), object({ ...fields, intent: enumeration('link') })] },
    response: object({ transactionId: uuid, state: opaque, nonce: opaque, authorizeUrl: nullable({ ...text, format: 'uri' }), expiresIn: { ...integer, enum: [600] } }), errors: [400, 401, 403, 413, 429] }),
  nativeComplete: () => contract({ id: 'completeNativeAppleAuthentication', summary: 'iOS Apple 제공자 증명 검증', auth: 'none', security, description: description + ' Assign the exact returned nonce without hashing again. Returns a 120-second one-time completion code after real authorization-code and identity-token verification.',
    body: object({ transactionId: uuid, state: opaque, authorizationCode: { ...text, minLength: 1, maxLength: 4096 }, identityToken: { ...text, minLength: 1, maxLength: 16384 }, codeVerifier: verifier }), response: object({ code: opaque }), errors: [400, 401, 403, 413, 429] }),
  callback: () => applyDecorators(contract({ id: 'appleProviderCallback', summary: 'Apple Services ID 서버 callback', auth: 'none', status: 303,
    body: object({ state: opaque, code: { ...text, maxLength: 4096 }, error: enumeration('user_cancelled_authorize'), user: text }, ['state']), errors: [400, 401, 403, 413, 429],
    description: 'Provider-only form POST. State/nonce/code verified server-side; redirects only one-time completion and caller returnState to an exact environment-specific app/web completion path. Never intercept this API URL with an app link.' }), ApiConsumes('application/x-www-form-urlencoded')),
  exchange: () => contract({ id: 'exchangeAppleCompletion', summary: 'Apple 완료 코드와 원래 S256 증명 교환', auth: 'none', security, description,
    body: object({ clientId: client, transactionId: uuid, code: opaque, codeVerifier: verifier }),
    response: { oneOf: [webSession, object({ tokenType: enumeration('Bearer'), accessToken: opaque, expiresAt: { ...text, format: 'date-time' }, session: nativeSession })] }, errors: [400, 401, 403, 409, 413, 429] }),
  notifications: () => contract({ id: 'receiveAppleAccountNotification', summary: '서명 검증된 Apple 계정 알림', auth: 'none', status: 204,
    body: object({ payload: { ...text, maxLength: 16384 } }), errors: [400, 403, 413, 429], description: 'Apple RS256 signature/JWKS, exact issuer/audience, iat, event_time and durable jti replay verification. Revocation invalidates Apple identity and sessions but never deletes a SOOP account.' }),
};
