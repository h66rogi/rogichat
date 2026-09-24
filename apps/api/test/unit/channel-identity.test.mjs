import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_WEB_PATH,
  CHANNEL_PROFILE_IMAGE_URL,
  isChannelIdentifier,
  isChannelProfileImageUrl,
  canonicalProfileImageUrl,
  profileImageUrlForStorage,
} from '../../dist/modules/channel-content/channel-identity.js';

test('the public channel identifier is h66rogi while old clients remain readable', () => {
  assert.equal(CHANNEL_WEB_PATH, 'h66rogi');
  assert.equal(isChannelIdentifier('h66rogi'), true);
  assert.equal(isChannelIdentifier('hurogi'), true);
  assert.equal(isChannelIdentifier('1'), false);
  assert.equal(isChannelIdentifier('1', true), true);
  assert.equal(isChannelIdentifier('other'), false);
});

test('stored old avatar paths are returned and saved under the canonical path', () => {
  assert.equal(CHANNEL_PROFILE_IMAGE_URL, '/images/h66rogi-profile.png');
  assert.equal(isChannelProfileImageUrl('/images/hurogi-profile.png'), true);
  assert.equal(canonicalProfileImageUrl('/images/hurogi-profile.png'), CHANNEL_PROFILE_IMAGE_URL);
  assert.equal(profileImageUrlForStorage('/images/hurogi-profile.png'), CHANNEL_PROFILE_IMAGE_URL);
  assert.equal(canonicalProfileImageUrl('https://example.com/avatar.png'), 'https://example.com/avatar.png');
  assert.equal(profileImageUrlForStorage(null), null);
});
