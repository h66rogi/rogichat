import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { UploadService } from '../upload.service';

const mockS3Send = jest.fn();
const putObjectCommandSpy = jest.fn((args) => ({ args }));
const deleteObjectCommandSpy = jest.fn((args) => ({ args }));
const headObjectCommandSpy = jest.fn((args) => ({ args }));
const getObjectCommandSpy = jest.fn((args) => ({ args }));
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn(() => ({ send: mockS3Send })),
    PutObjectCommand: jest.fn((args) => putObjectCommandSpy(args)),
    DeleteObjectCommand: jest.fn((args) => deleteObjectCommandSpy(args)),
    GetObjectCommand: jest.fn((args) => getObjectCommandSpy(args)),
    HeadObjectCommand: jest.fn((args) => headObjectCommandSpy(args)),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

describe('UploadService.uploadBuffer', () => {
  let service: UploadService;

  beforeEach(async () => {
    process.env.OBJECT_STORAGE_ENDPOINT =
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';
    process.env.OBJECT_STORAGE_REGION = 'auto';
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'test-r2-key';
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'test-r2-secret';
    process.env.OBJECT_STORAGE_BUCKET = 'test-bucket';
    process.env.UPLOAD_CDN_URL = 'https://cdn.test';
    mockS3Send.mockReset().mockResolvedValue({});
    putObjectCommandSpy.mockClear();
    deleteObjectCommandSpy.mockClear();
    headObjectCommandSpy.mockClear();
    getObjectCommandSpy.mockClear();
    mockGetSignedUrl
      .mockReset()
      .mockResolvedValue('https://s3-signed.example/private-image');

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
      providers: [UploadService],
    }).compile();
    service = moduleRef.get(UploadService);
  });

  it('uploads a raw buffer to YYYYMMDD/<uuid>.<ext> using the provided mime', async () => {
    const buf = Buffer.from('hello-png-bytes');
    const result = await service.uploadBuffer({
      buffer: buf,
      mimetype: 'image/png',
      originalname: 'flatten.png',
    });

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(putObjectCommandSpy).toHaveBeenCalledTimes(1);
    const cmdArgs = putObjectCommandSpy.mock.calls[0][0];
    expect(cmdArgs.Bucket).toBe('test-bucket');
    expect(cmdArgs.Body).toBe(buf);
    expect(cmdArgs.ContentType).toBe('image/png');
    expect(cmdArgs.Key).toMatch(
      /^\d{8}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
    );
    expect(result.fileUrl).toMatch(
      /^https:\/\/cdn\.test\/\d{8}\/[0-9a-f-]+\.png$/,
    );
    expect(result.fileKey).toMatch(
      /^\d{8}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
    );
    expect(result.fileName).toMatch(/\.png$/);
  });

  it('returns the S3 object key for image uploads', async () => {
    const result = await service.uploadImage({
      buffer: Buffer.from('image-bytes'),
      mimetype: 'image/webp',
      originalname: 'reference.webp',
    } as Express.Multer.File);

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    const cmdArgs = putObjectCommandSpy.mock.calls[0][0];
    expect(cmdArgs.ContentType).toBe('image/webp');
    expect(cmdArgs.Key).toMatch(
      /^\d{8}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/,
    );
    expect(result.fileKey).toBe(cmdArgs.Key);
    expect(result.imageUrl).toBe(`https://cdn.test/${cmdArgs.Key}`);
    expect(result.fileName).toMatch(/\.webp$/);
  });

  it('uploads review images to an owned private key and returns a temporary URL', async () => {
    const result = await service.uploadPrivateReviewImage(7, {
      buffer: Buffer.from('private-image'),
      mimetype: 'image/webp',
      originalname: 'review.webp',
      size: 13,
    } as Express.Multer.File);

    const cmdArgs = putObjectCommandSpy.mock.calls[0][0];
    expect(cmdArgs.Key).toMatch(
      /^reviews\/7\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/,
    );
    expect(cmdArgs.ContentType).toBe('image/webp');
    expect(cmdArgs.CacheControl).toBe('private, max-age=300');
    expect(result).toEqual({
      fileKey: cmdArgs.Key,
      previewUrl: 'https://s3-signed.example/private-image',
      expiresIn: 300,
    });
    expect(result.previewUrl).not.toContain('cdn.test');
  });

  it('rejects a review image key that belongs to another user', async () => {
    await expect(
      service.assertPrivateReviewImage(
        7,
        'reviews/8/00000000-0000-4000-8000-000000000001.webp',
      ),
    ).rejects.toEqual(new BadRequestException('검증되지 않은 리뷰 이미지예요'));
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('deletes only review image keys owned by the user', async () => {
    const fileKey = 'reviews/7/00000000-0000-4000-8000-000000000001.webp';

    await service.deletePrivateReviewImage(7, fileKey);

    expect(deleteObjectCommandSpy).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: fileKey,
    });
    await expect(
      service.deletePrivateReviewImage(
        7,
        'reviews/8/00000000-0000-4000-8000-000000000001.webp',
      ),
    ).rejects.toEqual(new BadRequestException('검증되지 않은 리뷰 이미지예요'));
  });

  it.each([
    {
      metadata: { ContentType: 'application/pdf', ContentLength: 10 },
      message: '지원하지 않는 리뷰 이미지 형식이에요',
    },
    {
      metadata: {
        ContentType: 'image/webp',
        ContentLength: 10 * 1024 * 1024 + 1,
      },
      message: '이미지는 장당 최대 10MB까지 첨부할 수 있어요',
    },
  ])(
    'rejects invalid stored review image metadata',
    async ({ metadata, message }) => {
      mockS3Send.mockResolvedValueOnce(metadata);

      await expect(
        service.assertPrivateReviewImage(
          7,
          'reviews/7/00000000-0000-4000-8000-000000000001.webp',
        ),
      ).rejects.toEqual(new BadRequestException(message));
    },
  );

  it('mirrors uploadFile behavior: when originalname has no `.`, pop returns the whole name', async () => {
    // `split('.').pop() || 'bin'` matches existing uploadFile semantics: if
    // there is no '.', `pop()` returns the entire string (truthy), so it's
    // used verbatim as the "extension". This is intentional to keep behavior
    // identical between uploadFile and uploadBuffer.
    await service.uploadBuffer({
      buffer: Buffer.from('x'),
      mimetype: 'application/octet-stream',
      originalname: 'noext',
    });

    const cmdArgs = putObjectCommandSpy.mock.calls[0][0];
    expect(cmdArgs.Key).toMatch(/\.noext$/);
  });

  it('falls back to .bin when originalname is empty', async () => {
    await service.uploadBuffer({
      buffer: Buffer.from('x'),
      mimetype: 'application/octet-stream',
      originalname: '',
    });

    const cmdArgs = putObjectCommandSpy.mock.calls[0][0];
    expect(cmdArgs.Key).toMatch(/\.bin$/);
  });

  it('honors a custom folder prefix', async () => {
    await service.uploadBuffer({
      buffer: Buffer.from('y'),
      mimetype: 'image/png',
      originalname: 'a.png',
      folder: 'schedule-templates',
    });

    const cmdArgs = putObjectCommandSpy.mock.calls[0][0];
    expect(cmdArgs.Key).toMatch(/^schedule-templates\/\d{8}\/[0-9a-f-]+\.png$/);
  });

  it('strips a trailing slash from folder', async () => {
    await service.uploadBuffer({
      buffer: Buffer.from('z'),
      mimetype: 'image/png',
      originalname: 'a.png',
      folder: 'with-slash/',
    });

    const cmdArgs = putObjectCommandSpy.mock.calls[0][0];
    expect(cmdArgs.Key).toMatch(/^with-slash\/\d{8}\/[0-9a-f-]+\.png$/);
  });
});
