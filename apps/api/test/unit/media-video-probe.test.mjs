import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoProbe, VIDEO_PROBE_BYTES, VideoProbeError } from '../../dist/isolated/media-decoder/video-probe.js';

function fixture() {
  return {
    streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
      duration: '1.000000', start_time: '0.000000', avg_frame_rate: '30/1', r_frame_rate: '30/1',
      sample_aspect_ratio: '1:1', disposition: { attached_pic: 0, timed_thumbnails: 0 } }],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', size: '1000', duration: '1.000000', start_time: '0.000000' },
  };
}
function parse(input) { return parseVideoProbe(Buffer.from(JSON.stringify(input)), 1000); }
function denied(input) { assert.throws(() => parse(input), error => error instanceof VideoProbeError && error.message === 'INVALID_VIDEO'); }
function changed(update) { const input = fixture(); update(input); return input; }

test('bounded probe returns only allowlisted video fields, including portrait orientation and optional audio', () => {
  const input = fixture(); input.format.tags = { location: 'private', title: 'private' };
  assert.deepEqual(parse(input), { videoIndex: 0, audioIndex: null, width: 1920, height: 1080, durationMs: 1000, rotation: 0, codec: 'h264' });
  input.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', rotation: -90 }];
  input.streams.push({ index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000', duration: '1.100000' });
  input.streams.push({ index: 2, codec_type: 'data', codec_name: 'bin_data' });
  const result = parse(input);
  assert.deepEqual(result, { videoIndex: 0, audioIndex: 1, width: 1080, height: 1920, durationMs: 1100, rotation: 270, codec: 'h264' });
  assert.ok(Object.isFrozen(result));
});

test('probe rejects malformed, over-budget, wrong container, size mismatch and provider errors without leaking input', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(VIDEO_PROBE_BYTES + 1), Buffer.from('{private'), Buffer.from('null')]) {
    assert.throws(() => parseVideoProbe(bytes, 1000), { message: 'INVALID_VIDEO' });
  }
  for (const expected of [0, 50 * 1024 * 1024 + 1, NaN, 1.1]) assert.throws(() => parseVideoProbe(Buffer.from('{}'), expected), VideoProbeError);
  for (const update of [v => { v.format.size = '999'; }, v => { v.format.format_name = 'hls'; },
    v => { v.error = { string: 'private' }; }, v => { v.streams = []; }, v => { v.streams.push(...Array(4).fill(v.streams[0])); }]) denied(changed(update));
});

test('duration bounds apply to format and every selected track including offsets, not just video metadata', () => {
  for (const value of ['60.000001', '0', '-1', 'NaN', 'Infinity', '1e2', '', ' 1', 1, null]) {
    denied(changed(v => { v.format.duration = value; }));
    denied(changed(v => { v.streams[0].duration = value; }));
  }
  denied(changed(v => { v.streams[0].duration = '60'; v.streams[0].start_time = '0.1'; }));
  denied(changed(v => { v.format.start_time = '-1'; }));
  assert.equal(parse(changed(v => { v.format.duration = '60'; v.streams[0].duration = '60'; })).durationMs, 60_000);
});

test('rejects ambiguous tracks, cover art, invalid indices, decoder codecs and missing video', () => {
  for (const update of [v => { v.streams.push({ ...v.streams[0], index: 1 }); },
    v => { v.streams.push({ index: 0, codec_type: 'data' }); },
    v => { v.streams[0].disposition.attached_pic = 1; }, v => { delete v.streams[0].disposition; },
    v => { v.streams[0].codec_name = 'unknown'; }, v => { v.streams[0].index = -1; },
    v => { v.streams = [{ index: 0, codec_type: 'data' }]; }, v => { v.streams[0].codec_type = 'attachment'; }]) denied(changed(update));
});

test('resolution, frame-rate, pixel ratio and rotation bounds reject expansion and decode bombs', () => {
  for (const update of [v => { v.streams[0].width = 1921; }, v => { v.streams[0].height = 1081; },
    v => { v.streams[0].height = 0; }, v => { v.streams[0].avg_frame_rate = '61/1'; },
    v => { v.streams[0].avg_frame_rate = '0/0'; }, v => { v.streams[0].r_frame_rate = '121/1'; },
    v => { v.streams[0].sample_aspect_ratio = '2:1'; },
    v => { v.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', rotation: 45 }]; },
    v => { v.streams[0].side_data_list = Array(2).fill({ side_data_type: 'Display Matrix', rotation: 90 }); }]) denied(changed(update));
});

test('audio admission bounds channel count, sample rate, duration and duplicate tracks', () => {
  const audio = { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000', duration: '1' };
  for (const patch of [{ channels: 9 }, { channels: 0 }, { sample_rate: '192000' }, { codec_name: 'unknown' }, { duration: '61' }]) {
    denied(changed(v => v.streams.push({ ...audio, ...patch })));
  }
  denied(changed(v => v.streams.push(audio, { ...audio, index: 2 })));
});

test('canonical output must use H264 yuv420p 30fps and optional stereo 48k AAC', () => {
  const source = fixture(); source.streams[0].pix_fmt = 'yuv420p';
  const canonical = input => parseVideoProbe(Buffer.from(JSON.stringify(input)), 1000, true);
  assert.equal(canonical(source).codec, 'h264');
  for (const patch of [{ pix_fmt: 'yuv444p' }, { codec_name: 'hevc' }, { avg_frame_rate: '60/1' }]) {
    const input = globalThis.structuredClone(source); Object.assign(input.streams[0], patch);
    assert.throws(() => canonical(input), VideoProbeError);
  }
  source.streams.push({ index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000', duration: '1' });
  assert.equal(canonical(source).audioIndex, 1);
  source.streams[1].codec_name = 'mp3'; assert.throws(() => canonical(source), VideoProbeError);
});
