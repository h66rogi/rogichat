import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MelomingOverlayService } from './meloming-overlay.service.js';

@ApiTags('Overlay/Meloming compatibility')
@Controller('v1/overlay')
export class MelomingOverlayController {
  constructor(
    @Inject(MelomingOverlayService) private readonly service: MelomingOverlayService,
  ) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store, must-revalidate')
  get(@Param('token') token: string) {
    return this.service.get(token);
  }
}
