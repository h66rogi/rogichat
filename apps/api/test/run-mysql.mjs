// Owns only a fresh local datadir or a generated database on an explicitly disposable service.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { unusedPort, waitFor } from './helpers.mjs';

let directory;
let server;
let admin;
let testProcess;
let databaseName;
let username;
let stage = 'initialize';
let aborted = false;

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  aborted = true;
  testProcess?.kill('SIGTERM');
  server?.kill('SIGTERM');
});

async function run(command, args, env) {
  const proc = spawn(command, args, { stdio: 'inherit', ...(env ? { env } : {}) });
  const deadline = setTimeout(() => proc.kill('SIGKILL'), 60000);
  try {
    const [code] = await once(proc, 'exit');
    if (code !== 0) throw new Error('fixture command failed');
  } finally { clearTimeout(deadline); }
}

try {
  let port;
  let password;
  if (process.env.TEST_MYSQL_PORT) {
    if (process.env.ROGICHAT_TEST_MYSQL !== 'disposable' || !process.env.TEST_MYSQL_ROOT_PASSWORD ||
        !/^[0-9]+$/.test(process.env.TEST_MYSQL_PORT)) throw new Error('explicit disposable fixture required');
    port = Number(process.env.TEST_MYSQL_PORT);
    if (port < 1 || port > 65535) throw new Error('invalid fixture port');
    password = process.env.TEST_MYSQL_ROOT_PASSWORD;
  } else {
    directory = await mkdtemp(join(tmpdir(), 'rogichat-m01-'));
    port = await unusedPort();
    password = '';
    await run('mysqld', ['--no-defaults', '--initialize-insecure', `--datadir=${directory}`]);
    if (aborted) throw new Error('aborted');
    server = spawn('mysqld', [
      '--no-defaults', `--datadir=${directory}`, `--socket=${join(directory, 'mysql.sock')}`,
      `--pid-file=${join(directory, 'mysql.pid')}`, '--bind-address=127.0.0.1', `--port=${port}`,
      '--mysqlx=OFF', '--skip-log-bin', '--performance-schema=OFF', '--innodb-buffer-pool-size=64M',
    ], { stdio: 'ignore' });
    // Attach immediately; a missing binary must not produce an unhandled event.
    server.on('error', () => { aborted = true; });
  }
  stage = 'connect';
  await waitFor(async () => {
    if (aborted) throw new Error('aborted');
    try { admin = await createConnection({ host: '127.0.0.1', port, user: 'root', password, connectTimeout: 1000 }); return true; }
    catch { return false; }
  }, 30000);
  const [version] = await admin.query('SELECT VERSION() AS version');
  if (!/^8\.0\./.test(version[0].version)) throw new Error('MySQL 8.0 fixture required');
  stage = 'fixture';
  const suffix = randomBytes(8).toString('hex');
  databaseName = `rogichat_test_${suffix}`;
  username = `fixture_${suffix}`;
  const runtimePassword = randomBytes(24).toString('hex');
  await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [username, runtimePassword]);
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${databaseName}\`.* TO ?@'%'`, [username]);
  stage = 'tests';
  const runtimeUrl = `mysql://${username}:${runtimePassword}@127.0.0.1:${port}/${databaseName}`;
  const adminUrl = `mysql://root:${encodeURIComponent(password)}@127.0.0.1:${port}/${databaseName}`;
  stage = 'migration';
  // Generated migrations only, on this harness-owned loopback database. Never reads repository .env.
  const migrationName = process.argv.find(x => x.startsWith('--migration-name='))?.split('=')[1] ?? 'schema_update';
  if (!/^[a-z0-9_]{1,64}$/.test(migrationName)) throw new Error('invalid fixture migration name');
  await run(process.execPath, [createRequire(import.meta.url).resolve('prisma'), 'migrate', 'dev', '--name', migrationName], {
    PATH: process.env.PATH, DATABASE_URL: adminUrl,
  });
  if (process.argv.includes('--migration-only')) {
    process.exitCode = 0;
  } else {
  stage = 'tests';
  // Discover committed test names so newly added regressions cannot silently miss CI.
  let integrationFiles = (await readdir(new URL('./integration/', import.meta.url)))
    .filter(name => name.endsWith('.test.mjs')).sort().map(name => join('test', 'integration', name));
  const requested = process.argv.filter(arg => arg.startsWith('--test-file=')).map(arg => arg.slice('--test-file='.length));
  if (requested.length) {
    if (requested.some(name => !/^[a-z0-9-]+\.test\.mjs$/.test(name) || !integrationFiles.includes(join('test', 'integration', name)))) throw new Error('unknown integration test');
    integrationFiles = requested.map(name => join('test', 'integration', name));
  }
  if (!integrationFiles.length) throw new Error('integration tests missing');
  testProcess = spawn(process.execPath, ['--test', '--test-concurrency=1', ...integrationFiles], {
    stdio: 'inherit', env: {
      PATH: process.env.PATH, APP_ENV: 'test', NODE_ENV: 'test', DB_TLS_MODE: 'disabled',
      DATABASE_URL: runtimeUrl, TEST_ADMIN_URL: adminUrl, ROGICHAT_TEST_MYSQL: 'disposable',
    },
  });
  const [code] = await once(testProcess, 'exit');
  process.exitCode = code ?? 1;
  }
} catch {
  console.error(`Disposable MySQL harness failed at ${stage}; no external database was selected.`);
  process.exitCode = 1;
} finally {
  if (admin) {
    try {
      // Names are generated here, never supplied by a caller. No shared schema or datadir cleanup.
      if (databaseName) await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      if (username) await admin.query("DROP USER IF EXISTS ?@'%'", [username]);
    } catch { console.error('Fixture cleanup failed'); process.exitCode = 1; }
    await admin.end();
  }
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const deadline = setTimeout(() => server.kill('SIGKILL'), 10000);
    try { await exited; } finally { clearTimeout(deadline); }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  if (aborted) process.exitCode = 1;
}
