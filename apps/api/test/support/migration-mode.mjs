export function migrationMode(args, ci = process.env.GITHUB_ACTIONS === 'true') {
  const options = args.filter(arg => arg.startsWith('--migration-mode'));
  if (options.length > 1) throw new Error('duplicate migration mode');
  const indexes = args.filter(arg => /^--shard-index=[0-9]+$/.test(arg));
  const counts = args.filter(arg => /^--shard-count=[0-9]+$/.test(arg));
  const ordinary = indexes.length === 1 && counts.length === 1 &&
    !args.some(arg => ['--migration-only', '--quality', '--soak', '--restore', '--expansion'].includes(arg)) &&
    !args.some(arg => arg.startsWith('--test-file='));
  if (!options.length) {
    // Four CI shards share the same committed migrations. One still runs
    // Prisma's shadow database and drift validation on every workflow run.
    if (ci && ordinary && counts[0] === '--shard-count=4' &&
        ['--shard-index=0', '--shard-index=2', '--shard-index=3'].includes(indexes[0])) return 'deploy';
    return 'dev';
  }
  if (options[0] === '--migration-mode=dev') return 'dev';
  if (options[0] !== '--migration-mode=deploy') throw new Error('invalid migration mode');
  if (!ordinary) throw new Error('deploy mode requires an ordinary integration shard');
  return 'deploy';
}
