import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL_FEATURES, channelHref, featureFromPath } from '../../features/channel/model/channel-features';

void test('every channel menu destination resolves to its active feature', () => {
  for (const feature of Object.values(CHANNEL_FEATURES)) {
    assert.equal(featureFromPath(channelHref(feature.key)), feature.key);
    if (feature.segment) assert.equal(featureFromPath(`${channelHref(feature.key)}/`), feature.key);
  }
});

void test('root feature detail paths retain their menu without matching legacy or sibling routes', () => {
  assert.equal(featureFromPath('/wardrobe/item-1'), 'wardrobe');
  assert.equal(featureFromPath('/setlist/123'), 'setlist');
  assert.equal(featureFromPath('/chat/thread'), 'chat');
  for (const path of ['/channel/another/wardrobe', '/channel/h66rogi/wardrobe', '/wardrobe-other', '/chatter', '/unknown', '']) {
    assert.equal(featureFromPath(path), null, path);
  }
});
