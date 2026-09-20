import { Controller, Delete, Inject, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { contract, empty, enumeration, object as schemaObject, uuid } from '../../common/openapi/schema.js';
import { object } from '../auth/auth-primitives.js';
import { readCommandCredentials } from '../auth/auth-context.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { AccountDeletionService } from './account-deletion.service.js';

export const accountDeletionReceipt = schemaObject({ requestId: { ...uuid, pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }, status: enumeration('blocked') });

@ApiTags('Account')
@Controller('v1/me')
export class AccountDeletionController {
  constructor(@Inject(AccountDeletionService) private readonly deletion: AccountDeletionService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Delete('account')
  @contract({ id: 'deleteAccount', summary: '내 계정 탈퇴 요청', auth: 'write', body: empty, response: accountDeletionReceipt,
    description: '현재 본인 인증과 15분 이내 재인증이 필요합니다. 외부 삭제 원장 기록 후 계정 접근 차단이 커밋되어야 blocked를 반환합니다. 물리 삭제는 미완료이며 별도 작업 의무로 유지합니다. 원장 실패 또는 guard 증거 부족은 503입니다. 접수 후 세션은 사용할 수 없으며 응답 유실 시에도 독립 원장 재처리가 진행됩니다.',
    errors: [400, 401, 403, 413, 429, 503] })
  remove(@Req() request: Request) {
    object(request.body ?? {}, []);
    return this.deletion.remove(readCommandCredentials(request, this.config));
  }
}
