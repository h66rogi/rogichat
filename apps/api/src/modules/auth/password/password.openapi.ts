import { contract, enumeration, object, text } from '../../../common/openapi/schema.js';
import { nativeSession, webSession } from '../dto/auth.openapi.js';
const clientId = enumeration('web', 'ios', 'android');
const password = { ...text, minLength: 12, maxLength: 256, writeOnly: true, description: '12자 이상, UTF-8 256바이트 이하. 제어 문자는 금지하며 공백 제거·정규화하지 않습니다.' };
const response = { oneOf: [webSession, object({ tokenType: enumeration('Bearer'), accessToken: { ...text, minLength: 43, maxLength: 43 }, expiresAt: { ...text, format: 'date-time' }, session: nativeSession })] };
export const passwordDocs = {
  login: () => contract({ id: 'passwordLogin', summary: '계정 ID와 비밀번호로 로그인', auth: 'none', body: object({ clientId,
    loginId: { ...text, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$', description: '대소문자를 구분하지 않는 계정 ID' }, password, termsVersion: enumeration('2026-09-20') }, ['clientId', 'loginId', 'password']), response,
    errors: [400, 401, 403, 429], description: 'JSON 필수. 웹은 허용 Origin, 기존 세션이 있으면 CSRF 필요. 네이티브는 X-Rogi-Client가 clientId와 일치해야 하며 쿠키/Origin/CSRF 금지. 임의 가입 및 기본 비밀번호 없음. 잘못된 계정/비밀번호는 동일한 AUTH_FAILED. SOOP REQUIRED와 채팅 READY는 양립할 수 있으며 capabilities.chat을 별도로 확인합니다.' }),
  change: () => contract({ id: 'changePassword', summary: '본인 비밀번호 변경 및 세션 회전', auth: 'write', body: object({ clientId, currentPassword: password, newPassword: password }), response,
    errors: [400, 401, 403, 429], description: '현재 비밀번호와 정상 세션 증명 필요. 모든 이전 세션/푸시 바인딩을 회수한 뒤 동일 계정에 새 세션을 발급합니다. 신규 비밀번호를 로그나 클라이언트 영속 저장소에 저장하지 않습니다.' }),
};
