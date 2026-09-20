import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Config } from '../config/config.js';
import type { AuthConfig } from '../config/auth-config.js';
import { cookieName } from '../../modules/auth/auth-context.js';

export function createOpenApiDocument(app: NestExpressApplication, auth?: AuthConfig): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('로기챗 API').setVersion('1.0')
    .setDescription('로기챗 REST 계약입니다. 실제 등록된 기능만 표시합니다. 문서 조회용이며 브라우저 실행은 제공하지 않습니다.\n\n방별 권한을 매 요청 재검사합니다. 관리자 권한만으로 비공개 대화를 열람할 수 없습니다. 메시지 저장 완료는 상대 전달·읽음 완료가 아닙니다. 소켓은 변경 알림이며 재접속/주기적 REST sync로 복구해야 합니다.\n\nJSON 본문은 최대 64 KiB입니다. 모든 응답은 no-store이며 X-Request-Id는 서버가 생성합니다. 503은 의존성 장애 또는 종료 중 상태입니다.')
    .addServer('/')
    .addCookieAuth(auth ? cookieName(auth, 'session') : 'rogi_session', { type: 'apiKey', in: 'cookie' }, 'browserSession')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: '세션 조회에서 받은 CSRF 토큰. 보호된 쓰기 요청은 쿠키와 이 토큰, 허용 Origin이 모두 필요합니다.' }, 'csrf')
    .build();
  return SwaggerModule.createDocument(app, config, { autoTagControllers: false });
}
export function configureOpenApi(app: NestExpressApplication, environment: Config['environment'], auth?: AuthConfig): void {
  if (environment !== 'qa' && environment !== 'local') return;
  // Create once from the initialized provider graph; do not query any application data.
  const document = createOpenApiDocument(app, auth);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: '/docs/openapi.json', raw: ['json'], ui: true, customSiteTitle: '로기챗 API',
    swaggerOptions: { supportedSubmitMethods: [], tryItOutEnabled: false, persistAuthorization: false,
      validatorUrl: null, queryConfigEnabled: false, filter: true, docExpansion: 'none', deepLinking: true },
  });
}
