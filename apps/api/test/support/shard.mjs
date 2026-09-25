// QA run 36183038038 spent 245s in shard 3 and 66s in shard 2. Keep the
// longest integration files apart while retaining the existing assignment for
// every other file and for specialized suites with a different shard count.
const FOUR_SHARD_INTEGRATION_OVERRIDES = new Map([
  ['test/integration/channel-content.test.mjs', 2],
  ['test/integration/default-room.test.mjs', 0],
  ['test/integration/media-worker.test.mjs', 1],
  ['test/integration/messages.test.mjs', 0],
  ['test/integration/native-soop.test.mjs', 1],
  ['test/integration/purge-runtime.test.mjs', 0],
  ['test/integration/read-state.test.mjs', 0],
]);

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
  return files.filter((file, position) =>
    (integration ? FOUR_SHARD_INTEGRATION_OVERRIDES.get(file) ?? position % count : position % count) === index);
}
