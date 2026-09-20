// Mounted read-only into the reviewed migration image. Never copied into runtime.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire('/workspace/apps/api/package.json');
const ROOT = '/run/release';
const CA = '/run/secrets/rds-ca.pem';
const fail = () => { throw new Error('migration gate rejected'); };

export function validateCredential(value, role, hostHash) {
  if (!value || Object.keys(value).sort().join(',') !== 'database,host,password,port,username'
      || value.username !== role || value.database !== 'rogichatqa' || value.port !== 3306
      || typeof value.host !== 'string'
      || !/^rogichat-qa\.cluster-[a-z0-9]+\.ap-northeast-2\.rds\.amazonaws\.com$/.test(value.host)
      || typeof value.password !== 'string' || value.password.length < 32 || value.password.length > 1024
      || crypto.createHash('sha256').update(value.host).digest('hex') !== hostHash) fail();
  return value;
}

export function connectionURL(value) {
  const url = new URL(`mysql://${value.host}:${value.port}/${value.database}`);
  // URL setters preserve literal percent signs; encode raw credential bytes first.
  url.username = encodeURIComponent(value.username);
  url.password = encodeURIComponent(value.password);
  url.searchParams.set('sslcert', CA);
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('connection_limit', '1');
  return url.href;
}

export function validateGrants(rows, role) {
  const allowed = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE',
    ...(role === 'rogichat_migrator' ? ['CREATE', 'ALTER', 'DROP', 'INDEX', 'REFERENCES'] : [])]);
  const found = new Set();
  for (const row of rows) {
    const grant = String(Object.values(row)[0]);
    if (/^GRANT USAGE ON \*\.\* TO /.test(grant) && !/WITH GRANT OPTION/.test(grant)) continue;
    const match = /^GRANT ([A-Z, ]+) ON `rogichatqa`\.\* TO /.exec(grant);
    if (!match || /WITH GRANT OPTION/.test(grant)) fail();
    for (const privilege of match[1].split(', ')) {
      if (!allowed.has(privilege)) fail();
      found.add(privilege);
    }
  }
  if ([...allowed].some(privilege => !found.has(privilege))) fail();
}

export function validateHistory(rows, manifest, exact = false) {
  if (rows.length > manifest.length || (exact && rows.length !== manifest.length)) fail();
  rows.forEach((row, index) => {
    if (row.migration_name !== manifest[index].name || row.checksum !== manifest[index].checksum
        || row.finished_at === null || row.rolled_back_at !== null) fail();
  });
}

export function validateManifest(actual, approved) {
  for (const entries of [actual, approved]) {
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) fail();
    let previous = '';
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
          || Object.keys(entry).sort().join(',') !== 'checksum,name'
          || typeof entry.name !== 'string' || !/^[0-9]{14}_[a-z0-9_]{1,80}$/.test(entry.name)
          || typeof entry.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(entry.checksum)
          || entry.name <= previous) fail();
      previous = entry.name;
    }
  }
  // JSON object field order is not part of an approval. Migration order and
  // every approved name/checksum remain exact, including the number of entries.
  if (actual.length !== approved.length || actual.some((entry, index) =>
    entry.name !== approved[index].name || entry.checksum !== approved[index].checksum)) fail();
}

async function connect(value) {
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({
    host: value.host, port: value.port, database: value.database,
    user: value.username, password: value.password, connectTimeout: 10000,
    multipleStatements: false,
    ssl: {ca: fs.readFileSync(CA), rejectUnauthorized: true, verifyIdentity: true},
  });
  try {
    const [identity] = await connection.query('SELECT DATABASE() AS db,CURRENT_USER() AS account');
    const [tls] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    if (identity[0].db !== 'rogichatqa' || !identity[0].account.startsWith(`${value.username}@`)
        || !tls[0]?.Value) fail();
    const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER()');
    validateGrants(grants, value.username);
    return connection;
  } catch (error) { await connection.end(); throw error; }
}

async function history(connection) {
  try {
    const [rows] = await connection.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name LIMIT 101');
    return rows;
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    const [tables] = await connection.query('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE()');
    if (Number(tables[0].total) !== 0) fail();
    return [];
  }
}

async function runPrisma(url) {
  // Only the child receives the URL. Docker Config.Env and host argv never do.
  // Prisma output may contain connection details: discard it, including failures.
  const cli = require.resolve('prisma/build/index.js');
  const env = {PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', NODE_ENV: 'production',
    CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', DATABASE_URL: url};
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
      cwd: '/workspace/apps/api', env, stdio: 'ignore', timeout: 300000, killSignal: 'SIGKILL',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve() : reject(new Error('migration failed')));
  });
}

export async function initializeCatalog(run = spawn) {
  // The protected QA gate above is unchanged. Use only the approved runtime
  // DML credential, never the DDL credential, for versioned domain initialization.
  await new Promise((resolve, reject) => {
    const child = run(process.execPath, ['/workspace/apps/api/dist/modules/owner-bootstrap/default-room-initialize.js'], {
      cwd: '/workspace/apps/api', env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production', APP_ENV: 'qa',
        DATABASE_SECRET_FILE: '/run/secrets/database.json', DB_TLS_MODE: 'required', DB_CA_FILE: CA, DB_POOL_SIZE: '1' },
      stdio: 'ignore', timeout: 60000, killSignal: 'SIGKILL',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve() : reject(new Error('initialization failed')));
  });
}

export async function main() {
  if (process.argv.length !== 2 || process.getuid() !== 10001) fail();
  const approval = JSON.parse(fs.readFileSync(`${ROOT}/approval.json`, 'utf8'));
  const runtime = validateCredential(JSON.parse(fs.readFileSync('/run/secrets/database.json', 'utf8')),
    'rogichat_app', approval.database_host_sha256);
  const migrator = validateCredential(JSON.parse(fs.readFileSync(`${ROOT}/migrator.json`, 'utf8')),
    'rogichat_migrator', approval.database_host_sha256);
  if (runtime.host !== migrator.host) fail();
  const {migrationManifest} = await import(pathToFileURL('/workspace/apps/api/dist/infrastructure/database/schema-manifest.js'));
  validateManifest(migrationManifest, approval.migrations);
  const runtimeConnection = await connect(runtime);
  let migratorConnection;
  try {
    migratorConnection = await connect(migrator);
    validateHistory(await history(runtimeConnection), migrationManifest);
    validateHistory(await history(migratorConnection), migrationManifest);
    await runPrisma(connectionURL(migrator));
    validateHistory(await history(runtimeConnection), migrationManifest, true);
    validateHistory(await history(migratorConnection), migrationManifest, true);
    // Re-read runtime grants after migration: DDL must remain impossible by policy.
    const [grants] = await runtimeConnection.query('SHOW GRANTS FOR CURRENT_USER()');
    validateGrants(grants, 'rogichat_app');
    await initializeCatalog();
    console.log('QA migration applied; manifest, TLS and runtime grants verified.');
  } finally { await Promise.all([runtimeConnection.end(), migratorConnection?.end()]); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('QA migration rejected or failed; rollout blocked.'); process.exitCode = 1; });
}
