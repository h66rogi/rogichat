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
import { AdminArtistsService } from './admin-artists.service';
import {
  AdminArtistsListQueryDto,
  AdminArtistsMergeRequestDto,
  AdminArtistSongsQueryDto,
} from './dto/admin-artists.dto';

@ApiTags('Admin Global Songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/global-songs/artists')
export class AdminArtistsController {
  constructor(private readonly service: AdminArtistsService) {}

  @Get()
  list(@Query() query: AdminArtistsListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post('merge')
  merge(@Body() body: AdminArtistsMergeRequestDto) {
    return this.service.merge(body);
  }

  @Get(':id/songs')
  songs(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminArtistSongsQueryDto,
  ) {
    return this.service.listSongs(id, query.page ?? 1, query.limit ?? 30);
  }
}
