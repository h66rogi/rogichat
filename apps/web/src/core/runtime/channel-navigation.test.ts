import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL_FEATURES, channelHref, featureFromPath } from '../../features/channel/model/channel-features';

void test('every channel menu destination resolves to its active feature', () => {
  for (const feature of Object.values(CHANNEL_FEATURES)) {
    assert.equal(featureFromPath(channelHref(feature.key)), feature.key);
    if (feature.segment) assert.equal(featureFromPath(`${channelHref(feature.key)}/`), feature.key);
  }
});

void test('nested channel detail paths retain their menu without matching another channel or sibling', () => {
  assert.equal(featureFromPath('/channel/hurogi/wardrobe/item-1'), 'wardrobe');
  assert.equal(featureFromPath('/chat/thread'), 'chat');
  for (const path of ['/channel/another/wardrobe', '/channel/hurogi/wardrobe-other', '/chatter', '/unknown', '']) {
    assert.equal(featureFromPath(path), null, path);
  }
});
