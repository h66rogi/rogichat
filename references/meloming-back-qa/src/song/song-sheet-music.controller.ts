import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsArray, IsInt, ArrayNotEmpty } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ChannelService } from '../channel/channel.service';
import { ChannelPermission } from '../channel/guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';
import { UploadFileDto } from '../upload/dto/upload.request.dto';
import { SheetMusicUploadResult } from '../upload/sheet-music-upload.service';
import { SongSheetMusicService, SheetMusicSlot } from './song-sheet-music.service';

// Phase 2 — reorder request body
class ReorderSheetMusicDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  orderedIds!: number[];
}

/**
 * Round 2 C1/C2/C6 — channel-scoped sheet music endpoints.
 *
 * Replaces the combination of:
 *   - POST /upload/sheet-music (auth only, anyone could upload)
 *   - PATCH /songs/channel/:identifier/:songId { sheetMusicUrl, sheetMusicType }
 *     (accepted arbitrary URLs, not atomic with title/category changes)
 *
 * With a single atomic endpoint protected by ChannelPermissionGuard('content').
 * The URL is produced server-side, so clients can no longer submit arbitrary
 * external or tokenized URLs.
 */
@ApiTags('Songs / Sheet Music')
@Controller('songs')
export class SongSheetMusicController {
  constructor(
    private readonly sheetMusicService: SongSheetMusicService,
    private readonly channelService: ChannelService,
  ) {}

  private async resolveChannelId(identifier: string): Promise<number> {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return channelId;
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:identifier/:songId/sheet-music')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '악보 업로드 (채널 매니저 전용)',
    description:
      '악보 파일을 업로드하고 해당 노래의 primary 악보로 저장합니다. 업로드와 DB 반영은 단일 트랜잭션으로 원자적으로 처리됩니다. 기존 primary 악보가 있으면 교체됩니다.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiParam({ name: 'songId', type: Number, description: '노래 ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '악보 파일 업로드 (PDF / MusicXML / Image, 최대 30MB)',
    type: UploadFileDto,
  })
  @ApiResponse({
    status: 200,
    description: '악보 업로드 및 DB 반영 성공',
  })
  @ApiResponse({
    status: 400,
    description: '지원하지 않는 형식, MIME/magic 불일치, 크기 초과 등',
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널 또는 노래를 찾을 수 없음' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadSheetMusic(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 30 * 1024 * 1024 }), // 30MB
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<SheetMusicUploadResult> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const channelId = await this.resolveChannelId(identifier);
    return this.sheetMusicService.replaceSheetMusic({
      songId,
      channelId,
      file: {
        buffer: file.buffer,
        mime: file.mimetype,
        fileName: file.originalname,
        fileSize: file.size,
      },
    });
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete('/channel/:identifier/:songId/sheet-music')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '악보 삭제 (채널 매니저 전용)',
    description:
      '해당 노래의 primary 악보를 삭제합니다. 이미 없으면 idempotent하게 성공합니다.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiParam({ name: 'songId', type: Number, description: '노래 ID' })
  @ApiResponse({ status: 200, description: '악보 삭제 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널 또는 노래를 찾을 수 없음' })
  async deleteSheetMusic(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
  ): Promise<{ deleted: boolean }> {
    const channelId = await this.resolveChannelId(identifier);
    return this.sheetMusicService.deleteSheetMusic({ songId, channelId });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Phase 2 — multi-slot endpoints
  // ──────────────────────────────────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  @Get('/channel/:identifier/:songId/sheet-music')
  @ApiOperation({
    summary: '악보 슬롯 목록 (채널 매니저 전용)',
    description:
      'sortOrder 오름차순으로 곡의 모든 악보 슬롯을 반환합니다. song detail 의 sheetMusics 필드와 동일하지만 슬롯 단위 작업 후 명시 refetch 용.',
  })
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiParam({ name: 'songId', type: Number })
  async listSheetMusic(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
  ): Promise<SheetMusicSlot[]> {
    await this.resolveChannelId(identifier);
    return this.sheetMusicService.listSheetMusic(songId);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:identifier/:songId/sheet-music/append')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '악보 슬롯 추가 (채널 매니저 전용)',
    description:
      '새 슬롯을 곡 끝에 추가합니다. 곡당 최대 10개. MUSICXML 은 단일 강제 — 기존 MUSICXML 슬롯이 있으면 교체됩니다. PDF / Image 는 다중 가능 (한 곡에 PDF + Image 혼용 OK).',
  })
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiParam({ name: 'songId', type: Number })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '악보 파일 (PDF / MusicXML / Image, 최대 30MB)',
    type: UploadFileDto,
  })
  @ApiResponse({ status: 200, description: '슬롯 추가 성공' })
  @ApiResponse({
    status: 400,
    description: '곡당 슬롯 캡 초과 / 형식 거부 / 크기 초과',
  })
  @UseInterceptors(FileInterceptor('file'))
  async appendSheetMusic(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 30 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ): Promise<SheetMusicSlot> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const channelId = await this.resolveChannelId(identifier);
    return this.sheetMusicService.addSheetMusic({
      songId,
      channelId,
      file: {
        buffer: file.buffer,
        mime: file.mimetype,
        fileName: file.originalname,
        fileSize: file.size,
      },
    });
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete('/channel/:identifier/:songId/sheet-music/:sheetMusicId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '악보 슬롯 개별 삭제 (채널 매니저 전용)',
    description: '특정 슬롯 1개를 삭제합니다. 남은 슬롯의 sortOrder 는 그대로 유지 (gap 허용).',
  })
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiParam({ name: 'songId', type: Number })
  @ApiParam({ name: 'sheetMusicId', type: Number })
  async deleteSheetMusicById(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Param('sheetMusicId', ParseIntPipe) sheetMusicId: number,
  ): Promise<{ deleted: boolean }> {
    const channelId = await this.resolveChannelId(identifier);
    return this.sheetMusicService.deleteSheetMusicById({
      songId,
      channelId,
      sheetMusicId,
    });
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  @Patch('/channel/:identifier/:songId/sheet-music/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '악보 슬롯 순서 변경 (채널 매니저 전용)',
    description:
      'orderedIds 배열에 따라 sortOrder 를 0..N-1 로 일괄 갱신합니다. 입력 집합이 곡의 슬롯과 정확히 일치해야 합니다 (개수/멤버).',
  })
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiParam({ name: 'songId', type: Number })
  async reorderSheetMusic(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Body() body: ReorderSheetMusicDto,
  ): Promise<SheetMusicSlot[]> {
    const channelId = await this.resolveChannelId(identifier);
    return this.sheetMusicService.reorderSheetMusic({
      songId,
      channelId,
      orderedIds: body.orderedIds,
    });
  }
}
