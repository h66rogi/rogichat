import { BadRequestException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ScheduleTemplatesController } from './schedule-templates.controller';
import { ScheduleTemplatesService } from './schedule-templates.service';
import { PsdParserService } from './services/psd-parser.service';
import { UploadService } from '../upload/upload.service';

/**
 * Controller-level guard tests for `POST /schedule-templates/psd-parse`.
 *
 * The full pipeline (multer → header magic check → ag-psd → sharp → S3) is
 * exercised by `psd-parse.worker.spec.ts` and `psd-parser.service.spec.ts`.
 * This file only covers the cheap extension hint guard at the top of
 * `parsePsd`, since that's the gate that produced a user-visible reject in
 * the wild (`.psb` files reported as "PSD 파일(.psd)만 업로드할 수 있습니다.").
 */

type ServiceMocks = {
  scheduleTemplatesService?: Partial<ScheduleTemplatesService>;
  psdParserService?: Partial<PsdParserService>;
  uploadService?: Partial<UploadService>;
};

function createController(mocks: ServiceMocks = {}): ScheduleTemplatesController {
  return new ScheduleTemplatesController(
    (mocks.scheduleTemplatesService ?? {}) as ScheduleTemplatesService,
    (mocks.psdParserService ?? {}) as PsdParserService,
    (mocks.uploadService ?? {}) as UploadService,
  );
}

function makeFakeFile(originalname: string): Express.Multer.File {
  // 1-byte buffer is enough; we never reach the worker in extension-guard tests.
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: 1,
    buffer: Buffer.from([0]),
    destination: '',
    filename: originalname,
    path: '',
    stream: null as never,
  };
}

function makeFakeResponse(): Response {
  return {
    setHeader: jest.fn(),
  } as unknown as Response;
}

// Minimal Request stub for the diagnostic-log path. Only the headers / body /
// file / files surface is read by the controller's no-file branch — the rest
// of the Express Request API never gets touched, so casting via `unknown` is
// the cheapest and most accurate fake.
function makeFakeRequest(overrides: {
  headers?: Record<string, string | undefined>;
  body?: unknown;
  file?: unknown;
  files?: unknown;
} = {}): Request {
  return {
    headers: overrides.headers ?? {},
    body: overrides.body ?? {},
    file: overrides.file,
    files: overrides.files,
  } as unknown as Request;
}

describe('ScheduleTemplatesController.parsePsd extension guard', () => {
  it('rejects files without .psd / .psb extension as INVALID_FILE_TYPE', async () => {
    const controller = createController({
      // Worker should never be invoked when extension fails. If it is, the
      // mock blowing up surfaces the regression.
      psdParserService: {
        parsePsd: jest.fn(() => {
          throw new Error('worker must not be called for bad extension');
        }) as unknown as PsdParserService['parsePsd'],
      },
    });

    await expect(
      controller.parsePsd(
        makeFakeFile('schedule.png'),
        makeFakeRequest(),
        makeFakeResponse(),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_FILE_TYPE',
        message: expect.stringContaining('.psd'),
      },
    });
  });

  it('accepts .psb (Large Document Format) extension and forwards to worker', async () => {
    // PSB files are designers' "large document" exports. ag-psd treats them
    // identically to PSD via the version-2 header, so the controller must let
    // them through to the worker.
    const parsePsdMock = jest.fn().mockResolvedValue({
      baseImageW: 100,
      baseImageH: 100,
      flattenPngBuffer: Buffer.from([0]),
      templateSpec: { version: 1, slots: [] },
      warnings: [],
    });
    const uploadFileMock = jest.fn().mockResolvedValue({
      fileUrl: 'https://cdn.example/x.psb',
      fileName: 'x.psb',
    });
    const uploadBufferMock = jest.fn().mockResolvedValue({
      fileUrl: 'https://cdn.example/x.png',
      fileName: 'x.png',
    });

    const controller = createController({
      psdParserService: {
        parsePsd: parsePsdMock as unknown as PsdParserService['parsePsd'],
      },
      uploadService: {
        uploadFile: uploadFileMock as unknown as UploadService['uploadFile'],
        uploadBuffer: uploadBufferMock as unknown as UploadService['uploadBuffer'],
      },
    });

    const result = await controller.parsePsd(
      makeFakeFile('schedule.psb'),
      makeFakeRequest(),
      makeFakeResponse(),
    );

    expect(parsePsdMock).toHaveBeenCalledTimes(1);
    expect(result.originalPsdUrl).toBe('https://cdn.example/x.psb');
    expect(result.baseImageUrl).toBe('https://cdn.example/x.png');
  });

  it('accepts uppercase .PSD extension (case-insensitive compare)', async () => {
    // macOS Finder / Windows Explorer can preserve mixed-case filenames. Our
    // guard lowercases first, so .PSD must pass — regression guard for the
    // toLowerCase() in the controller.
    const parsePsdMock = jest.fn().mockResolvedValue({
      baseImageW: 50,
      baseImageH: 50,
      flattenPngBuffer: Buffer.from([0]),
      templateSpec: { version: 1, slots: [] },
      warnings: [],
    });
    const controller = createController({
      psdParserService: {
        parsePsd: parsePsdMock as unknown as PsdParserService['parsePsd'],
      },
      uploadService: {
        uploadFile: jest.fn().mockResolvedValue({
          fileUrl: 'u',
          fileName: 'f',
        }) as unknown as UploadService['uploadFile'],
        uploadBuffer: jest.fn().mockResolvedValue({
          fileUrl: 'u',
          fileName: 'f',
        }) as unknown as UploadService['uploadBuffer'],
      },
    });

    await expect(
      controller.parsePsd(
        makeFakeFile('SCHEDULE.PSD'),
        makeFakeRequest(),
        makeFakeResponse(),
      ),
    ).resolves.toBeDefined();

    expect(parsePsdMock).toHaveBeenCalledTimes(1);
  });

  it('throws INVALID_FILE_TYPE when buffer is missing (multer parse failure)', async () => {
    const controller = createController();
    const noBufferFile = {
      ...makeFakeFile('foo.psd'),
      buffer: undefined as unknown as Buffer,
    };
    await expect(
      controller.parsePsd(
        noBufferFile as Express.Multer.File,
        makeFakeRequest(),
        makeFakeResponse(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // The diagnostic warn at the top of `parsePsd` is the only signal we have
  // for "user uploaded a PSD but multer never gave us the file". The bug class
  // is upstream — wrong content-type, wrong field name, gateway stripping the
  // part — and without the log we cannot tell which of those happened. Lock
  // the log shape with a test so the diagnostic doesn't silently rot.
  describe('diagnostic log when multer file is undefined', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('logs contentType, contentLength, bodyKeys, and file/files shape, then throws INVALID_FILE_TYPE', async () => {
      const controller = createController();
      const fakeReq = makeFakeRequest({
        headers: {
          'content-type': 'application/json',
          'content-length': '128',
        },
        body: { name: 'foo', extra: 'bar' },
        // file/files absent — this is the "multer received nothing" case.
      });

      await expect(
        controller.parsePsd(
          undefined as unknown as Express.Multer.File,
          fakeReq,
          makeFakeResponse(),
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'INVALID_FILE_TYPE',
          message: expect.stringContaining('PSD'),
        },
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls[0][0] as string;
      // Contract: every diagnostic field must be present so future failed
      // uploads produce actionable telemetry without code changes.
      expect(logged).toContain('psd-parse no-file-received');
      expect(logged).toContain('contentType=application/json');
      expect(logged).toContain('contentLength=128');
      expect(logged).toContain('bodyKeys=[name,extra]');
      expect(logged).toContain('file:absent');
      expect(logged).toContain('files:absent');
    });

    it('reports <missing> for absent headers and indicates files-as-array shape', async () => {
      const controller = createController();
      const fakeReq = makeFakeRequest({
        headers: {}, // no content-type / content-length at all
        body: {},
        files: [
          // Two entries — verifies the array branch reports the count, not
          // individual filenames (PII / payload safety).
          { fieldname: 'wrongname', originalname: 'x.psd' },
          { fieldname: 'wrongname2', originalname: 'y.psd' },
        ],
      });

      await expect(
        controller.parsePsd(
          undefined as unknown as Express.Multer.File,
          fakeReq,
          makeFakeResponse(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const logged = warnSpy.mock.calls[0][0] as string;
      expect(logged).toContain('contentType=<missing>');
      expect(logged).toContain('contentLength=<missing>');
      expect(logged).toContain('files:array(2)');
      // Critically — must NOT leak the filename/fieldname into the log.
      expect(logged).not.toContain('x.psd');
      expect(logged).not.toContain('wrongname');
    });

    it('reports files-as-object shape with field-name keys when multer .fields() is used', async () => {
      const controller = createController();
      const fakeReq = makeFakeRequest({
        headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
        body: {},
        files: {
          // Object form: `req.files['attachment']` is the multer .fields() shape.
          // Field NAMES are server-defined (not user data), so we log the keys
          // — that's the whole signal we need to diagnose "wrong field name".
          attachment: [{ originalname: 'x.psd' }],
        },
      });

      await expect(
        controller.parsePsd(
          undefined as unknown as Express.Multer.File,
          fakeReq,
          makeFakeResponse(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const logged = warnSpy.mock.calls[0][0] as string;
      expect(logged).toContain('files:object(keys=attachment)');
      // Filename inside the attachment record must NOT be logged.
      expect(logged).not.toContain('x.psd');
    });
  });
});
