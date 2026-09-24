/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  materializeOverlayDataFromSnapshot,
  readMaterializedNowPlayingId,
} from './snapshot-to-overlay-data';
import type { OverlayData } from '@/domains/overlay/types/overlay';
import type { OverlayPlaybackSnapshotData } from '@/domains/overlay/utils/playback-snapshot';

function baseConfig(overrides: Partial<OverlayData> = {}): OverlayData {
  return {
    sessionId: 100,
    channel: {
      id: 7,
      name: 'Haenu',
      webPath: 'haenu',
      profileImageUrl: null,
      themeColor: '#123456',
    },
    settings: {
      requestEnabled: true,
      paused: false,
      requestCommand: '!신청',
      maxQueueSize: 20,
      donationPriorityEnabled: false,
    },
    queue: [],
    setlist: [],
    nowPlaying: null,
    omakase: null,
    resolvedThemes: { 'now-playing': 'spotify', queue: 'apple' },
    resolvedOptions: { 'now-playing': { showRequester: true } },
    widgetCustomCss: { 'now-playing': '.np{color:red}' },
    totalLayout: { widgets: [{ id: 'now-playing' }] },
    totalLayoutVersion: 3,
    totalLayoutUpdatedAt: '2026-07-05T00:00:00.000Z',
    themes: { 'now-playing': 'spotify' },
    themeId: 'spotify',
    startedAt: '2026-07-05T09:00:00.000Z',
    isLive: true,
    ...overrides,
  };
}

function snap(
  overrides: Partial<OverlayPlaybackSnapshotData> = {},
): OverlayPlaybackSnapshotData {
  return {
    event: 'overlay.playback.snapshot.v1',
    contractVersion: 1,
    ...overrides,
  };
}

describe('materializeOverlayDataFromSnapshot: config fields preserved', () => {
  it('keeps every config field from base (channel/themes/options/css/layout)', () => {
    const base = baseConfig();
    const out = materializeOverlayDataFromSnapshot(
      snap({ sessionEpoch: 100, revision: 5, nowPlaying: null }),
      base,
    );

    expect(out.channel).toEqual(base.channel);
    expect(out.resolvedThemes).toEqual(base.resolvedThemes);
    expect(out.resolvedOptions).toEqual(base.resolvedOptions);
    expect(out.widgetCustomCss).toEqual(base.widgetCustomCss);
    expect(out.totalLayout).toEqual(base.totalLayout);
    expect(out.totalLayoutVersion).toBe(3);
    expect(out.totalLayoutUpdatedAt).toBe(base.totalLayoutUpdatedAt);
    expect(out.themes).toEqual(base.themes);
    expect(out.themeId).toBe('spotify');
  });

  it('does not mutate the base object', () => {
    const base = baseConfig();
    const snapshot = snap({ nowPlaying: { requestId: 1, status: 'PLAYING', title: 'x' } });
    materializeOverlayDataFromSnapshot(snapshot, base);
    expect(base.nowPlaying).toBeNull();
    expect(base.queue).toEqual([]);
  });
});

describe('materializeOverlayDataFromSnapshot: playback overridden', () => {
  it('maps snapshot queue rows (requestId -> id) into ApiSongRequest', () => {
    const out = materializeOverlayDataFromSnapshot(
      snap({
        queue: [
          { requestId: 11, status: 'PENDING', song: { id: 900, title: 'A', artist: { name: 'AA' } }, position: 1 },
          { requestId: 12, status: 'PENDING', title: 'B', artist: 'BB', position: 2 },
        ],
      }),
      baseConfig(),
    );

    expect(out.queue).toHaveLength(2);
    expect(out.queue[0].id).toBe(11);
    expect(out.queue[0].status).toBe('PENDING');
    expect(out.queue[0].song?.title).toBe('A');
    expect(out.queue[1].id).toBe(12);
    expect(out.queue[1].rawTitle).toBe('B');
    expect(out.queue[1].rawArtist).toBe('BB');
  });

  it('renders now-playing from the snapshot', () => {
    const out = materializeOverlayDataFromSnapshot(
      snap({ nowPlaying: { requestId: 42, status: 'PLAYING', title: 'Now', artist: 'Star' } }),
      baseConfig(),
    );
    expect(out.nowPlaying?.id).toBe(42);
    expect(out.nowPlaying?.status).toBe('PLAYING');
    expect(readMaterializedNowPlayingId(out)).toBe(42);
  });

  it('applies an authoritative now-playing null (confirmed clear)', () => {
    const base = baseConfig({
      nowPlaying: {
        id: 5,
        rawArtist: 'x',
        rawTitle: 'y',
        requesterNickname: '',
        status: 'PLAYING',
        queueOrder: 0,
      },
    });
    const out = materializeOverlayDataFromSnapshot(
      snap({ sessionEpoch: 100, revision: 9, nowPlaying: null }),
      base,
    );
    expect(out.nowPlaying).toBeNull();
    expect(readMaterializedNowPlayingId(out)).toBeNull();
  });

  it('leaves base now-playing untouched when the snapshot omits the field', () => {
    const base = baseConfig({
      nowPlaying: {
        id: 5,
        rawArtist: 'x',
        rawTitle: 'y',
        requesterNickname: '',
        status: 'PLAYING',
        queueOrder: 0,
      },
    });
    const out = materializeOverlayDataFromSnapshot(snap({ revision: 2 }), base);
    expect(out.nowPlaying?.id).toBe(5);
  });
});

describe('materializeOverlayDataFromSnapshot: setlist songlist->queue fallback', () => {
  it('uses snapshot.setlist when present', () => {
    const out = materializeOverlayDataFromSnapshot(
      snap({
        queue: [{ requestId: 1, status: 'PENDING', title: 'q', position: 1 }],
        setlist: [
          { requestId: 1, status: 'PENDING', title: 'q', position: 1 },
          { requestId: 2, status: 'COMPLETED', title: 'done', position: 2 },
        ],
      }),
      baseConfig(),
    );
    expect(out.setlist).toHaveLength(2);
    expect(out.setlist?.[1].status).toBe('COMPLETED');
  });

  it('falls back to snapshot.queue when setlist is absent', () => {
    const out = materializeOverlayDataFromSnapshot(
      snap({ queue: [{ requestId: 1, status: 'PENDING', title: 'q', position: 1 }] }),
      baseConfig(),
    );
    expect(out.setlist).toHaveLength(1);
    expect(out.setlist?.[0].id).toBe(1);
  });
});

describe('materializeOverlayDataFromSnapshot: settings / session / live', () => {
  it('merges snapshot settings over base settings', () => {
    const out = materializeOverlayDataFromSnapshot(
      snap({ settings: { paused: true, maxQueueSize: 50 } }),
      baseConfig(),
    );
    expect(out.settings?.paused).toBe(true);
    expect(out.settings?.maxQueueSize).toBe(50);
    // untouched base setting survives the merge
    expect(out.settings?.requestCommand).toBe('!신청');
  });

  it('carries isLive/sessionId/startedAt from the snapshot', () => {
    const out = materializeOverlayDataFromSnapshot(
      snap({ sessionId: 250, isLive: false, startedAt: null }),
      baseConfig(),
    );
    expect(out.isLive).toBe(false);
    expect(out.sessionId).toBe(250);
    expect(out.startedAt).toBeNull();
  });

  it('keeps base session/live when the snapshot omits them', () => {
    const out = materializeOverlayDataFromSnapshot(snap({ revision: 1 }), baseConfig());
    expect(out.isLive).toBe(true);
    expect(out.sessionId).toBe(100);
    expect(out.startedAt).toBe('2026-07-05T09:00:00.000Z');
  });
});
