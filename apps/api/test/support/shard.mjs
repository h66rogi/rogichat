// QA run 36213359943 spent 583s in shard 0, versus 117-224s in the others.
// Its two longest files each took about 155s. Keep them on separate runners
// while retaining every other assignment and specialized suite behavior.
const FOUR_SHARD_INTEGRATION_OVERRIDES = new Map([
  ['test/integration/channel-content-core.test.mjs', 1],
  ['test/integration/channel-content-media.test.mjs', 2],
  ['test/integration/channel-content-live.test.mjs', 3],
  ['test/integration/channel-content-requests.test.mjs', 2],
  ['test/integration/default-room.test.mjs', 1],
  ['test/integration/media-worker.test.mjs', 1],
  ['test/integration/messages.test.mjs', 0],
  ['test/integration/native-soop.test.mjs', 1],
  ['test/integration/purge-runtime.test.mjs', 0],
  ['test/integration/read-state.test.mjs', 0],
]);
const CHANNEL_CONTENT_SPLIT = new Set(
  [...FOUR_SHARD_INTEGRATION_OVERRIDES.keys()].filter(file => file.startsWith('test/integration/channel-content-')),
);

export function selectShard(files, args) {
  const indexArgs = args.filter(arg => arg.startsWith('--shard-index='));
  const countArgs = args.filter(arg => arg.startsWith('--shard-count='));
  if (!indexArgs.length && !countArgs.length) return files;
  if (indexArgs.length !== 1 || countArgs.length !== 1 ||
      args.some(arg => arg.startsWith('--test-file='))) throw new Error('invalid integration shard');
  const indexText = indexArgs[0].slice('--shard-index='.length);
  const countText = countArgs[0].slice('--shard-count='.length);
  if (!/^(0|[1-9][0-9]*)$/.test(indexText) || !/^[1-9][0-9]*$/.test(countText)) {
    throw new Error('invalid integration shard');
  }
  const index = Number(indexText);
  const count = Number(countText);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count > 8 ||
      index >= count || count > files.length) throw new Error('invalid integration shard');
  const integration = count === 4 && files.every(file => file.startsWith('test/integration/'));
  return files.filter((file, position) => {
    if (!integration) return position % count === index;
    // Four pieces replace one original file. Keep every other file's prior
    // modulo position so the measured shard balance remains comparable.
    const piecesBefore = files.slice(0, position).filter(previous => CHANNEL_CONTENT_SPLIT.has(previous)).length;
    const legacyPosition = position - Math.max(0, piecesBefore - 1);
    return (FOUR_SHARD_INTEGRATION_OVERRIDES.get(file) ?? legacyPosition % count) === index;
  });
}
