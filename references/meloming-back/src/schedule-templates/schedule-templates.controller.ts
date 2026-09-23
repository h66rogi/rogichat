import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { ScheduleTemplatesService } from './schedule-templates.service';
import { PsdParserService } from './services/psd-parser.service';
import { UploadService } from '../upload/upload.service';
import { CreateScheduleTemplateRequestDto } from './dto/request/create-schedule-template.request.dto';
import { UpdateScheduleTemplateRequestDto } from './dto/request/update-schedule-template.request.dto';
import { ListScheduleTemplatesQueryDto } from './dto/request/list-schedule-templates.query.dto';
import { ScheduleTemplateResponseDto } from './dto/response/schedule-template.response.dto';
import { PsdParseResponseDto } from './dto/response/psd-parse.response.dto';
import { toScheduleTemplateResponse } from './mappers/schedule-template.mapper';

// Multer hard cap. PSDs with high-res content easily exceed 50MB; 300MB is a
// realistic upper bound (Photoshop default page size + several adjustment
// layers + smart objects). Worker-side header validation rejects PSDs with
// any side > 20000px or total pixel count > 100M independent of file size,
// so this is just a transport-level guard against absurd uploads.
const PSD_MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

// Photoshop exports two related formats from the same lineage:
//   .psd — standard Photoshop document (header version 1, 2GB / 30000px max)
//   .psb — Large Document Format (header version 2, 4EB / 300000px max)
// ag-psd's `readPsd` accepts both transparently, and our worker's 8BPS magic
// + version-1-or-2 header check is the real defense. The extension hint is
// just a quick reject for obviously-wrong uploads (e.g. .png, .jpg), so we
// accept either suffix and let the magic-number check do the binary-level
// validation.
const PSD_ACCEPTED_EXTS = ['.psd', '.psb'] as const;

type RequiredAuthRequest = Request & {
  user: {
    id: number;
    nickname: string;
    profileImageUrl: string | null;
    isAdmin?: boolean;
  };
};

@ApiTags('ScheduleTemplates')
@Controller('schedule-templates')
export class ScheduleTemplatesController {
  private readonly logger = new Logger(ScheduleTemplatesController.name);

  constructor(
    private readonly service: ScheduleTemplatesService,
    private readonly psdParserService: PsdParserService,
    private readonly uploadService: UploadService,
  ) {}

  @Post()
  @ApiOperation({
    summary: '주간 방송 시간표 템플릿 생성(소유자/매니저)',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiBody({ type: CreateScheduleTemplateRequestDto })
  @ApiResponse({ status: 201, type: ScheduleTemplateResponseDto })
  async create(
    @Body() dto: CreateScheduleTemplateRequestDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleTemplateResponseDto> {
    const row = await this.service.create(Number(req.user.id), dto);
    return toScheduleTemplateResponse(row);
  }

  @Post('psd-parse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'PSD 업로드 + flatten PNG 생성 + 텍스트 레이어 자동 슬롯 매핑. 편집 후 POST /schedule-templates 로 저장.',
    description:
      '8-bit/channel PSD/PSB만 지원합니다 (16/32-bit는 PSD_UNSUPPORTED_DEPTH 로 거부). ' +
      '캔버스 픽셀 수는 1억 (예: 10000×10000) 이하여야 하고, 단일 변 길이는 20000px 이하, ' +
      '파일 크기는 300MB 이하로 제한됩니다. 파싱은 worker thread 풀(최대 2 thread, 큐 4)에서 ' +
      '실행되어 30초 안에 끝나지 않으면 PSD_PARSE_TIMEOUT 으로 응답하며, 큐가 꽉 차면 ' +
      'PSD_QUEUE_FULL (HTTP 503, Retry-After: 5) 로 거절됩니다.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'PSD/PSB 파일 업로드 (field name: file, max 300MB)',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 200, type: PsdParseResponseDto })
  @ApiResponse({
    status: 400,
    description: 'INVALID_FILE_TYPE / PSD_INVALID / PSD_UNSUPPORTED_DEPTH',
  })
  @ApiResponse({ status: 413, description: 'PSD_OVERSIZED' })
  @ApiResponse({
    status: 500,
    description:
      'PSD_WORKER_INIT_ERROR (worker artifact missing — permanent infra error, no Retry-After)',
  })
  @ApiResponse({
    status: 503,
    description: 'PSD_QUEUE_FULL (queue full, Retry-After: 5)',
  })
  @ApiResponse({ status: 504, description: 'PSD_PARSE_TIMEOUT' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PSD_MAX_FILE_SIZE },
    }),
  )
  async parsePsd(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PsdParseResponseDto> {
    if (!file || !file.buffer) {
      // Diagnostic: when the user reports "I uploaded a .psd but got
      // INVALID_FILE_TYPE" we have three suspect classes — request was not
      // multipart at all / it was multipart but the field name wasn't `file`
      // / a gateway or middleware stripped the part. The pre-existing
      // extension-reject log doesn't fire for this branch (file is undefined
      // before we can read originalname), so we capture *shape only* of the
      // request here. Strictly server-side; never returned to the client.
      // PII-safe — no header values besides Content-Type/Content-Length, no
      // body values, no filenames.
      const contentType = req.headers['content-type'] ?? '<missing>';
      const contentLength = req.headers['content-length'] ?? '<missing>';
      // multer routes non-file fields into req.body and files into req.file
      // (single) or req.files (array / fields-object). We only read keys, not
      // values, so an attacker-controlled body can never leak via the log.
      const bodyKeys =
        req.body && typeof req.body === 'object'
          ? Object.keys(req.body as Record<string, unknown>)
          : [];
      const filesShape = (() => {
        const r = req as unknown as { file?: unknown; files?: unknown };
        const single = r.file ? 'file:present' : 'file:absent';
        let many: string;
        if (Array.isArray(r.files)) {
          many = `files:array(${r.files.length})`;
        } else if (r.files && typeof r.files === 'object') {
          many = `files:object(keys=${Object.keys(
            r.files as Record<string, unknown>,
          ).join(',')})`;
        } else {
          many = 'files:absent';
        }
        return `${single}; ${many}`;
      })();
      this.logger.warn(
        `psd-parse no-file-received: contentType=${String(contentType)} contentLength=${String(contentLength)} bodyKeys=[${bodyKeys.join(',')}] ${filesShape}`,
      );
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'file 필드에 PSD/PSB 파일이 필요합니다.',
      });
    }

    // `originalname` is an attacker-influenced field — but we only trust it
    // for two things here: (1) extension hint (.psd / .psb check below) and
    // (2) its extension passed to uploadBuffer/uploadFile which each build
    // the S3 key from a server-generated UUID + extension. Path traversal is
    // impossible because the key never embeds the filename itself.
    //
    // We accept both .psd and .psb because designers frequently export larger
    // templates as PSB (Large Document Format), and ag-psd + our worker
    // header check both handle PSB transparently (version=2 in the 8BPS
    // header). The magic-number check inside the worker is the real binary
    // defense; this extension guard is just a fast rejection for clearly-wrong
    // uploads. Reject case is logged with originalname/mime/size so we can
    // diagnose future "I uploaded .psd but rejected" reports.
    const lowered = (file.originalname ?? '').toLowerCase();
    const extensionAllowed = PSD_ACCEPTED_EXTS.some((ext) =>
      lowered.endsWith(ext),
    );
    if (!extensionAllowed) {
      this.logger.warn(
        `psd-parse extension reject: name=${file.originalname} mime=${file.mimetype} size=${file.size}`,
      );
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'PSD/PSB 파일(.psd, .psb)만 업로드할 수 있습니다.',
      });
    }

    let parsed;
    try {
      parsed = await this.psdParserService.parsePsd(file.buffer);
    } catch (err) {
      // The service already threw BadRequestException / PayloadTooLargeException
      // for typed parse errors. PsdParseTimeoutError / PsdQueueFullError /
      // PsdWorkerInitError need HTTP translation here.
      const mapped = PsdParserService.toHttpException(err);
      // Retry-After is ONLY set on the queue-full path (transient
      // backpressure). PsdWorkerInitError is mapped to 500 by toHttpException
      // because it's a permanent infra failure (worker artifact missing on
      // disk) — retrying does not help, so we deliberately omit Retry-After.
      if (mapped instanceof ServiceUnavailableException) {
        // Signal the client to back off. Static 5s hint; no jitter here
        // because any sane client adds its own.
        res.setHeader('Retry-After', '5');
      }
      throw mapped;
    }

    // PSD 원본은 그대로 보관 (편집 UX 를 위해), flatten PNG 는 baseImage 로 사용.
    const [psdUpload, flattenUpload] = await Promise.all([
      this.uploadService.uploadFile({
        ...file,
        mimetype: 'image/vnd.adobe.photoshop',
      }),
      this.uploadService.uploadBuffer({
        buffer: parsed.flattenPngBuffer,
        mimetype: 'image/png',
        originalname: `schedule-template-flatten-${Date.now()}.png`,
      }),
    ]);

    return {
      originalPsdUrl: psdUpload.fileUrl,
      baseImageUrl: flattenUpload.fileUrl,
      baseImageW: parsed.baseImageW,
      baseImageH: parsed.baseImageH,
      templateSpec: parsed.templateSpec as unknown as Record<string, unknown>,
      warnings: parsed.warnings,
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '채널별 템플릿 목록(소유자/매니저, 기본값 우선 최신순)',
  })
  @ApiQuery({ name: 'channelId', type: 'number', required: true })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiResponse({ status: 200, type: [ScheduleTemplateResponseDto] })
  async list(
    @Query() query: ListScheduleTemplatesQueryDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleTemplateResponseDto[]> {
    const rows = await this.service.list(query.channelId, Number(req.user.id));
    return rows.map((row) => toScheduleTemplateResponse(row));
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '템플릿 상세 조회(소유자/매니저, 편집용)',
  })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiResponse({ status: 200, type: ScheduleTemplateResponseDto })
  async getOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleTemplateResponseDto> {
    const row = await this.service.getOne(id, Number(req.user.id));
    return toScheduleTemplateResponse(row);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '템플릿 수정(소유자/매니저)' })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiBody({ type: UpdateScheduleTemplateRequestDto })
  @ApiResponse({ status: 200, type: ScheduleTemplateResponseDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScheduleTemplateRequestDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleTemplateResponseDto> {
    const row = await this.service.update(id, Number(req.user.id), dto);
    return toScheduleTemplateResponse(row);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '템플릿 삭제(소유자/매니저, soft delete)',
  })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiResponse({ status: 200 })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequiredAuthRequest,
  ): Promise<{ success: true }> {
    await this.service.remove(id, Number(req.user.id));
    return { success: true };
  }
}
