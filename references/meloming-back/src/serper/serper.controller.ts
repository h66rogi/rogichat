import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SerperService } from './serper.service';
import { SerperRequestDto } from './dto/serper.request.dto';
import { SerperResponseDto } from './dto/serper.response.dto';
import { SerperVideoRequestDto } from './dto/serper-video.request.dto';
import { SerperVideoResponseDto } from './dto/serper-video.response.dto';
import { SerperWebRequestDto } from './dto/serper-web.request.dto';
import { SerperWebResponseDto } from './dto/serper-web.response.dto';

@ApiTags('Serper')
@Controller('serper')
export class SerperController {
  constructor(private readonly serperService: SerperService) {}

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DuckDuckGo 일반 이미지 검색' })
  @ApiBody({ type: SerperRequestDto })
  @ApiResponse({
    status: 200,
    description: 'DuckDuckGo 이미지 검색 결과 반환',
    type: SerperResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async search(@Body() dto: SerperRequestDto) {
    return this.serperService.searchImages(dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Post('search-video')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Serper YouTube 영상 검색 (원곡/MR/커버 URL 자동 채우기 용)',
  })
  @ApiBody({ type: SerperVideoRequestDto })
  @ApiResponse({
    status: 200,
    description: 'YouTube 도메인으로 필터링된 영상 목록',
    type: SerperVideoResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async searchVideo(@Body() dto: SerperVideoRequestDto) {
    return this.serperService.searchVideos(dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Post('search-web')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Serper 일반 웹 검색 (가사 링크 등 텍스트 검색 용)',
  })
  @ApiBody({ type: SerperWebRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Google 검색의 organic 결과 목록',
    type: SerperWebResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async searchWeb(@Body() dto: SerperWebRequestDto) {
    return this.serperService.searchWeb(dto);
  }
}
