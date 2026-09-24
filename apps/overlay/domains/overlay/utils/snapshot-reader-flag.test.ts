/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isSnapshotReaderAllEnabled,
  isSnapshotReaderEnabled,
} from './snapshot-reader-flag';

const ALL_KEY = 'NEXT_PUBLIC_OVERLAY_SNAPSHOT_READER_ALL';
const CHANNELS_KEY = 'NEXT_PUBLIC_OVERLAY_SNAPSHOT_READER_CHANNELS';

function clearFlags() {
  delete process.env[ALL_KEY];
  delete process.env[CHANNELS_KEY];
}

describe('isSnapshotReaderEnabled: default ON', () => {
  beforeEach(clearFlags);
  afterEach(clearFlags);

  it('both env vars unset -> true for every channel', () => {
    expect(isSnapshotReaderEnabled('token-abc')).toBe(true);
    expect(isSnapshotReaderEnabled({ token: 'token-abc', webPath: 'haenu' })).toBe(
      true,
    );
    expect(isSnapshotReaderEnabled(null)).toBe(true);
    expect(isSnapshotReaderEnabled(undefined)).toBe(true);
    expect(isSnapshotReaderAllEnabled()).toBe(true);
  });

  it('an empty ALL value still uses the default-on behavior', () => {
    process.env[ALL_KEY] = '';
    expect(isSnapshotReaderAllEnabled()).toBe(true);
    expect(isSnapshotReaderEnabled('anything')).toBe(true);
  });
});

describe('isSnapshotReaderEnabled: ALL switch', () => {
  beforeEach(clearFlags);
  afterEach(clearFlags);

  it('ALL=true enables every channel', () => {
    process.env[ALL_KEY] = 'true';
    expect(isSnapshotReaderAllEnabled()).toBe(true);
    expect(isSnapshotReaderEnabled('any-token')).toBe(true);
    expect(isSnapshotReaderEnabled({ webPath: 'whatever' })).toBe(true);
    expect(isSnapshotReaderEnabled(null)).toBe(true);
  });

  it('ALL accepts true variants and does not fail closed on malformed values', () => {
    for (const value of ['true', 'TRUE', ' True ', 'ture', 'unexpected']) {
      process.env[ALL_KEY] = value;
      expect(isSnapshotReaderAllEnabled()).toBe(true);
    }
  });

  it('only explicit ALL=false disables every channel without an allowlist', () => {
    for (const value of ['false', 'FALSE', ' False ']) {
      process.env[ALL_KEY] = value;
      expect(isSnapshotReaderAllEnabled()).toBe(false);
      expect(isSnapshotReaderEnabled('anything')).toBe(false);
    }
  });
});

describe('isSnapshotReaderEnabled: per-channel allowlist', () => {
  beforeEach(clearFlags);
  afterEach(clearFlags);

  it('matches by token', () => {
    process.env[ALL_KEY] = 'false';
    process.env[CHANNELS_KEY] = 'tok-1, tok-2';
    expect(isSnapshotReaderEnabled('tok-1')).toBe(true);
    expect(isSnapshotReaderEnabled('tok-2')).toBe(true);
    expect(isSnapshotReaderEnabled('tok-3')).toBe(false);
    expect(isSnapshotReaderEnabled({ token: 'tok-2' })).toBe(true);
  });

  it('matches by webPath even when token is not listed', () => {
    process.env[ALL_KEY] = 'false';
    process.env[CHANNELS_KEY] = 'haenu';
    expect(isSnapshotReaderEnabled({ token: 'opaque-token', webPath: 'haenu' })).toBe(
      true,
    );
    expect(
      isSnapshotReaderEnabled({ token: 'opaque-token', webPath: 'someone-else' }),
    ).toBe(false);
  });

  it('is forgiving about case and surrounding whitespace', () => {
    process.env[ALL_KEY] = 'false';
    process.env[CHANNELS_KEY] = '  Haenu ,  TOK-9 ';
    expect(isSnapshotReaderEnabled({ webPath: 'haenu' })).toBe(true);
    expect(isSnapshotReaderEnabled('tok-9')).toBe(true);
  });

  it('does not match empty token/webPath against blank allowlist entries', () => {
    process.env[ALL_KEY] = 'false';
    process.env[CHANNELS_KEY] = 'real-token';
    expect(isSnapshotReaderEnabled({ token: '', webPath: '' })).toBe(false);
    expect(isSnapshotReaderEnabled('')).toBe(false);
  });
});
