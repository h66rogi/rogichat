import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { GlobalSongController } from './global-song.controller';
import { GlobalSongPublicService } from './global-song-public.service';
import { GlobalSongMergeService } from './global-song-merge.service';
import { GlobalArtistMergeService } from './global-artist-merge.service';
import { GlobalSongMatcherService } from './global-song-matcher.service';
import { GlobalSongRebuildService } from './global-song-rebuild.service';
import { GlobalSongBackfillService } from './global-song-backfill.service';
import { GlobalSongQuickAddService } from './global-song-quick-add.service';
import { GlobalSongRecommendationService } from './global-song-recommendation.service';
import { CFComputationService } from './cf/cf-computation.service';
import { GlobalSongPopularService } from './global-song-popular.service';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { ChannelService } from '../channel/channel.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * E2E-style tests for the three public GlobalSong endpoints added in the
 * 2026-04-12 global-song detail spec. These focus on wiring + validation:
 *
 *   - no auth guard (public access)
 *   - ParseIntPipe on :id
 *   - class-validator rules on query DTOs
 *   - Cache-Control headers
 *   - route ordering (search matches before :id)
 *
 * We mock GlobalSongPublicService so the controller is tested in isolation.
 * Other collaborators are bound to empty objects because the public endpoints
 * never touch them.
 */
describe('GlobalSongController — public endpoints', () => {
  let app: INestApplication;
  let publicService: jest.Mocked<GlobalSongPublicService>;
  let popularService: jest.Mocked<GlobalSongPopularService>;

  beforeEach(async () => {
    publicService = {
      getDetail: jest.fn().mockResolvedValue({
        id: 1,
        title: 't',
        artist: { id: 1, name: 'a' },
        albumArt: null,
        channelCount: 0,
        clipCount: 0,
        channels: [],
        spotifyTrackId: null,
      }),
      getClips: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      search: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      getByArtist: jest.fn().mockResolvedValue({ items: [] }),
      getMyRegistrations: jest.fn().mockResolvedValue({
        registeredChannelIds: [],
        globalSongId: 42,
        mergedFrom: null,
      }),
    } as unknown as jest.Mocked<GlobalSongPublicService>;
    popularService = {
      getPopular: jest.fn().mockResolvedValue({
        ranking: [],
        newcomers: [],
        topArtists: [],
        liveNow: [],
        mostRequestedThisWeek: [],
        mostLiked: [],
        mostHotClips: [],
        mostDonated: [],
        generatedAt: '2026-06-06T00:00:00.000Z',
      }),
      getPopularSection: jest.fn().mockResolvedValue({
        section: 'ranking',
        items: [],
        limit: 100,
        offset: 0,
        maxRank: 500,
        hasNextPage: false,
        generatedAt: '2026-06-06T00:00:00.000Z',
      }),
    } as unknown as jest.Mocked<GlobalSongPopularService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [GlobalSongController],
      providers: [
        Reflector,
        { provide: GlobalSongMatcherService, useValue: {} },
        { provide: GlobalSongRebuildService, useValue: {} },
        { provide: GlobalSongBackfillService, useValue: {} },
        { provide: GlobalSongQuickAddService, useValue: {} },
        { provide: GlobalSongRecommendationService, useValue: {} },
        { provide: CFComputationService, useValue: {} },
        { provide: GlobalSongPublicService, useValue: publicService },
        { provide: GlobalSongPopularService, useValue: popularService },
        { provide: GlobalSongMergeService, useValue: { resolveMerged: jest.fn(), merge: jest.fn() } },
        { provide: GlobalArtistMergeService, useValue: { merge: jest.fn(), resolveMerged: jest.fn() } },
        // Dependencies for guards declared on the auth-protected routes.
        // These routes are never hit in this suite but Nest needs the DI
        // graph to resolve.
        { provide: ChannelService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: ChannelPermissionGuard, useValue: { canActivate: () => true } },
        { provide: InternalApiKeyGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(ChannelPermissionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(InternalApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /* ======================================================================
   *  GET /global-songs/popular/sections/:section
   * ==================================================================== */

  describe('GET /global-songs/popular/sections/:section', () => {
    it('200 without auth header and forwards paging query', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/popular/sections/ranking?limit=100&offset=100',
      );
      expect(res.status).toBe(200);
      expect(popularService.getPopularSection).toHaveBeenCalledWith(
        'ranking',
        expect.objectContaining({ limit: 100, offset: 100 }),
      );
    });

    it('400 when section is unsupported', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/popular/sections/banana',
      );
      expect(res.status).toBe(400);
      expect(popularService.getPopularSection).not.toHaveBeenCalled();
    });

    it('400 when paging query is out of range', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/popular/sections/ranking?limit=101',
      );
      expect(res.status).toBe(400);
    });

    it('sets Cache-Control: public, max-age=300', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/popular/sections/ranking',
      );
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });
  });

  /* ======================================================================
   *  GET /global-songs/:id
   * ==================================================================== */

  describe('GET /global-songs/:id', () => {
    it('200 without auth header (public)', async () => {
      const res = await request(app.getHttpServer()).get('/global-songs/42');
      expect(res.status).toBe(200);
      expect(publicService.getDetail).toHaveBeenCalledWith(42);
    });

    it('400 when :id is non-numeric (ParseIntPipe)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/not-a-number',
      );
      expect(res.status).toBe(400);
    });

    it('sets Cache-Control: public, max-age=300', async () => {
      const res = await request(app.getHttpServer()).get('/global-songs/42');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });
  });

  /* ======================================================================
   *  GET /global-songs/:id/clips
   * ==================================================================== */

  describe('GET /global-songs/:id/clips', () => {
    it('200 with default query when called without params', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/42/clips',
      );
      expect(res.status).toBe(200);
      // default sort=popular, default limit=20 after ValidationPipe transform
      expect(publicService.getClips).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ sort: 'popular', limit: 20 }),
      );
    });

    it('400 when limit is out of range', async () => {
      for (const bad of ['0', '51', '-1']) {
        const res = await request(app.getHttpServer()).get(
          `/global-songs/42/clips?limit=${bad}`,
        );
        expect(res.status).toBe(400);
      }
    });

    it('400 when sort is invalid', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/42/clips?sort=banana',
      );
      expect(res.status).toBe(400);
    });

    it('sets Cache-Control: public, max-age=300', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/42/clips',
      );
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });
  });

  /* ======================================================================
   *  GET /global-songs/search
   * ==================================================================== */

  describe('GET /global-songs/search', () => {
    it('routes to search (static path) not :id (param path)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/search?q=hi',
      );
      expect(res.status).toBe(200);
      expect(publicService.search).toHaveBeenCalled();
      expect(publicService.getDetail).not.toHaveBeenCalled();
    });

    it('200 without auth header (public)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/search?q=iu',
      );
      expect(res.status).toBe(200);
    });

    it('400 when q is missing', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/search',
      );
      expect(res.status).toBe(400);
    });

    it('400 when q is whitespace only (trim then IsNotEmpty)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/search?q=%20%20%20',
      );
      expect(res.status).toBe(400);
    });

    it('400 when limit is out of range', async () => {
      for (const bad of ['0', '51', '-1']) {
        const res = await request(app.getHttpServer()).get(
          `/global-songs/search?q=iu&limit=${bad}`,
        );
        expect(res.status).toBe(400);
      }
    });

    it('sets Cache-Control: public, max-age=60', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/search?q=iu',
      );
      expect(res.headers['cache-control']).toBe('public, max-age=60');
    });
  });

  /* ======================================================================
   *  GET /global-songs/:id/by-artist
   * ==================================================================== */

  describe('GET /global-songs/:id/by-artist', () => {
    it('200 without auth header (public) and forwards default limit=10', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/42/by-artist',
      );
      expect(res.status).toBe(200);
      expect(publicService.getByArtist).toHaveBeenCalledWith(42, 10);
    });

    it('forwards limit query param', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/42/by-artist?limit=25',
      );
      expect(res.status).toBe(200);
      expect(publicService.getByArtist).toHaveBeenCalledWith(42, 25);
    });

    it('400 when :id is non-numeric (ParseIntPipe)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/not-a-number/by-artist',
      );
      expect(res.status).toBe(400);
    });

    it('sets Cache-Control: public, max-age=300', async () => {
      const res = await request(app.getHttpServer()).get(
        '/global-songs/42/by-artist',
      );
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });
  });

  /* ======================================================================
   *  GET /global-songs/:id/my-registrations  (JWT)
   * ==================================================================== */

  describe('GET /global-songs/:id/my-registrations', () => {
    it('JWT-guarded: never 200 without auth, service not invoked', async () => {
      // The passport jwt strategy isn't bootstrapped in this minimal spec, so
      // the @UseGuards(AuthGuard('jwt')) layer surfaces as a 401/500 — both
      // outcomes confirm the controller route was NOT reached. The
      // important invariant is that no auth → no service call.
      const res = await request(app.getHttpServer()).get(
        '/global-songs/42/my-registrations',
      );
      expect(res.status).not.toBe(200);
      expect(publicService.getMyRegistrations).not.toHaveBeenCalled();
    });
  });
});
