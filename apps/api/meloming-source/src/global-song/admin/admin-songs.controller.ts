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
import { AdminSongsService } from './admin-songs.service';
import {
  AdminLocalSongMergeRequestDto,
  AdminSongChannelsQueryDto,
  AdminSongSiblingsQueryDto,
  AdminSongsListQueryDto,
  AdminSongsMergeRequestDto,
} from './dto/admin-songs.dto';

@ApiTags('Admin Global Songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/global-songs/songs')
export class AdminSongsController {
  constructor(private readonly service: AdminSongsService) {}

  @Get()
  list(@Query() query: AdminSongsListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post('merge')
  merge(@Body() body: AdminSongsMergeRequestDto) {
    return this.service.merge(body);
  }

  @Post('local-merge')
  localMerge(@Body() body: AdminLocalSongMergeRequestDto) {
    return this.service.localMerge(body);
  }

  @Get(':id/channels')
  channels(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminSongChannelsQueryDto,
  ) {
    return this.service.listChannels(id, query.page ?? 1, query.limit ?? 30);
  }

  @Get(':id/siblings')
  siblings(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminSongSiblingsQueryDto,
  ) {
    return this.service.listSiblings(id, query.page ?? 1, query.limit ?? 30);
  }
}
