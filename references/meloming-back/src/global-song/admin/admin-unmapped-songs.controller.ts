import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { AdminUnmappedSongsService } from './admin-unmapped-songs.service';
import {
  AdminUnmappedLinkRequestDto,
  AdminUnmappedSongsListQueryDto,
} from './dto/admin-unmapped.dto';

@ApiTags('Admin Global Songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/global-songs/unmapped')
export class AdminUnmappedSongsController {
  constructor(private readonly service: AdminUnmappedSongsService) {}

  @Get()
  list(@Query() query: AdminUnmappedSongsListQueryDto) {
    return this.service.list(query);
  }

  @Post(':songId/link')
  link(
    @Param('songId', ParseIntPipe) songId: number,
    @Body() body: AdminUnmappedLinkRequestDto,
  ) {
    return this.service.link(songId, body.globalSongId);
  }
}
