import { ApiTags } from '@nestjs/swagger';
import { healthDocs } from './dto/health.openapi.js';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '../../infrastructure/database/database.js';
import { DATABASE } from '../../infrastructure/database/database.tokens.js';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: Database, private readonly lifecycle: LifecycleState) {}

  @Get('live')
  @healthDocs.live()
  live(): { status: 'ok' } { return { status: 'ok' }; }

  @Get('ready')
  @healthDocs.ready()
  async ready(): Promise<{ status: 'ready' }> {
    if (this.lifecycle.draining) throw new ServiceUnavailableException();
    const result = await this.database.check();
    if (!result.ready || this.lifecycle.draining) throw new ServiceUnavailableException();
    return { status: 'ready' };
  }
}
