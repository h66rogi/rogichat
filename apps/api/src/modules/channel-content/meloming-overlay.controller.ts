import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MelomingOverlayService } from './meloming-overlay.service.js';
import { channelDoc } from './channel-content.openapi.js';

@ApiTags('Overlay/Meloming compatibility')
@Controller('v1/overlay')
export class MelomingOverlayController {
  constructor(
    @Inject(MelomingOverlayService) private readonly service: MelomingOverlayService,
  ) {}

  @Get(':token')
  @channelDoc('melomingOverlayData', '원본 OBS 오버레이 데이터 조회')
  @Header('Cache-Control', 'no-store, must-revalidate')
  get(@Param('token') token: string) {
    return this.service.get(token);
  }
}
