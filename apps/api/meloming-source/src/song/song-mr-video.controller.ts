import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ChannelPermission } from '../channel/guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';
import {
  AbortSongMrVideoMultipartDto,
  CompleteSongMrVideoMultipartDto,
  InitiateSongMrVideoMultipartDto,
  SignSongMrVideoMultipartPartDto,
  SongMrVideoMultipartInitResponseDto,
  SongMrVideoMultipartPartUrlResponseDto,
  SongMrVideoResponseDto,
} from './dto/song-mr-video.dto';
import { SongMrVideoService } from './song-mr-video.service';

@ApiTags('Songs / MR Video')
@ApiBearerAuth()
@Controller('songs/channel/:identifier/:songId/mr-video')
@UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
@ChannelPermission('content')
export class SongMrVideoController {
  constructor(private readonly service: SongMrVideoService) {}

  @Post('multipart/init')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'MR 영상 S3 multipart upload 시작' })
  @ApiParam({ name: 'identifier', description: 'channelId 또는 webPath' })
  @ApiParam({ name: 'songId', type: Number })
  @ApiResponse({ status: 200, type: SongMrVideoMultipartInitResponseDto })
  initiateMultipart(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Body() body: InitiateSongMrVideoMultipartDto,
  ) {
    return this.service.initiateMultipart(identifier, songId, body);
  }

  @Post('multipart/part-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'MR 영상 S3 multipart part URL 발급' })
  @ApiResponse({ status: 200, type: SongMrVideoMultipartPartUrlResponseDto })
  signPart(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Body() body: SignSongMrVideoMultipartPartDto,
  ) {
    return this.service.signPart(identifier, songId, body);
  }

  @Post('multipart/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'MR 영상 S3 multipart upload 완료 및 Song 반영' })
  @ApiResponse({ status: 200, type: SongMrVideoResponseDto })
  completeMultipart(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Body() body: CompleteSongMrVideoMultipartDto,
  ) {
    return this.service.completeMultipart(identifier, songId, body);
  }

  @Post('multipart/abort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'MR 영상 S3 multipart upload 중단' })
  abortMultipart(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Body() body: AbortSongMrVideoMultipartDto,
  ) {
    return this.service.abortMultipart(identifier, songId, body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '곡에 연결된 MR 영상 삭제' })
  @ApiResponse({ status: 200, type: SongMrVideoResponseDto })
  deleteMrVideo(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
  ) {
    return this.service.deleteMrVideo(identifier, songId);
  }
}
