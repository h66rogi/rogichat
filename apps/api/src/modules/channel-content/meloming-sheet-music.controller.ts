import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingSheetMusicService } from './meloming-sheet-music.service.js';

function channel(identifier:string) { if (identifier !== 'hurogi' && identifier !== '1') throw new ApiError('NOT_FOUND',404); }
function id(value:string) { if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST',400); return Number(value); }
type File = {buffer:Buffer;size:number;mimetype:string;originalname:string};

/** The original Meloming sheet-music routes, with Rogichat authorization and storage. */
@ApiTags('Songs/Sheet Music')
@Controller('v1/songs/channel/:identifier/:songId/sheet-music')
export class MelomingSheetMusicController {
  constructor(@Inject(MelomingSheetMusicService) private readonly service:MelomingSheetMusicService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig) {}

  @Post() @UseInterceptors(FileInterceptor('file',{limits:{files:1,fileSize:30*1024*1024}}))
  @channelDoc('melomingSheetMusicReplace','원본 악보 교체','write')
  replace(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request,@UploadedFile() file:File) {
    channel(identifier); return this.service.replace(readCommandCredentials(request,this.config),id(songId),file);
  }
  @Post('append') @UseInterceptors(FileInterceptor('file',{limits:{files:1,fileSize:30*1024*1024}}))
  @channelDoc('melomingSheetMusicAppend','원본 악보 슬롯 추가','write')
  append(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request,@UploadedFile() file:File) {
    channel(identifier); return this.service.append(readCommandCredentials(request,this.config),id(songId),file);
  }
  @Get() @channelDoc('melomingSheetMusicList','원본 악보 슬롯 조회','read')
  list(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request) {
    channel(identifier); return this.service.list(readSessionCredentials(request,this.config),id(songId));
  }
  @Delete() @channelDoc('melomingSheetMusicDelete','원본 악보 전체 삭제','write')
  remove(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request) {
    channel(identifier); return this.service.remove(readCommandCredentials(request,this.config),id(songId));
  }
  @Delete(':slotId') @channelDoc('melomingSheetMusicSlotDelete','원본 악보 슬롯 삭제','write')
  removeSlot(@Param('identifier') identifier:string,@Param('songId') songId:string,@Param('slotId') slotId:string,@Req() request:Request) {
    channel(identifier); return this.service.remove(readCommandCredentials(request,this.config),id(songId),id(slotId));
  }
  @Patch('reorder') @channelDoc('melomingSheetMusicReorder','원본 악보 슬롯 정렬','write')
  reorder(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request) {
    channel(identifier); return this.service.reorder(readCommandCredentials(request,this.config),id(songId),request.body);
  }
}

@ApiTags('Upload/Sheet Music')
@Controller('v1/upload/sheet-music')
export class MelomingSheetMusicReadController {
  constructor(@Inject(MelomingSheetMusicService) private readonly service:MelomingSheetMusicService) {}
  @Get(':fileName') @channelDoc('melomingSheetMusicRead','원본 악보 파일 공개 조회')
  async read(@Param('fileName') fileName:string) {
    const {stream,bytes,contentType}=await this.service.read(fileName);
    return new StreamableFile(stream,{type:contentType,length:bytes,disposition:'inline'});
  }
}
