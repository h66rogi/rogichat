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
  return files.filter((_, position) => position % count === index);
}
