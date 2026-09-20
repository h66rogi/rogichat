// Read-only production schema/TLS/grants gate. No Prisma CLI or migration account.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require = createRequire('/workspace/apps/api/package.json');
const fail = () => { throw new Error('production readiness rejected'); };
export function validateCredential(v, hash) {
  if (!v || Object.keys(v).sort().join(',') !== 'database,host,password,port,username'
      || v.database !== 'rogichatprod' || v.username !== 'rogichat_app' || v.port !== 3306
      || typeof v.host !== 'string' || !/^rogichat-prod\.cluster-[a-z0-9]+\.ap-northeast-2\.rds\.amazonaws\.com$/.test(v.host)
      || typeof v.password !== 'string' || v.password.length < 32 || v.password.length > 1024
      || crypto.createHash('sha256').update(v.host).digest('hex') !== hash) fail();
  return v;
}
export function validateGrants(rows) {
  const expected = new Set(['SELECT','INSERT','UPDATE','DELETE']);
  const found = new Set();
  for (const row of rows) {
    const grant = String(Object.values(row)[0]);
    if (/WITH GRANT OPTION/.test(grant)) fail();
    if (/^GRANT USAGE ON \*\.\* TO /.test(grant)) continue;
    const match = /^GRANT ([A-Z, ]+) ON `rogichatprod`\.\* TO /.exec(grant);
    if (!match) fail();
    for (const privilege of match[1].split(', ')) {
      if (!expected.has(privilege)) fail();
      found.add(privilege);
    }
  }
  if (found.size !== expected.size) fail();
}
export function validateHistory(rows, manifest) {
  if (!manifest.length || rows.length !== manifest.length) fail();
  rows.forEach((row,i) => {
    if (row.migration_name !== manifest[i].name || row.checksum !== manifest[i].checksum
        || row.finished_at === null || row.rolled_back_at !== null) fail();
  });
}
export async function main() {
  if (process.argv.length !== 2 || process.getuid() !== 10001) fail();
  const approval = JSON.parse(fs.readFileSync(0,'utf8'));
  if (approval.environment !== 'production' || approval.migration_policy !== 'verify-only') fail();
  const v = validateCredential(JSON.parse(fs.readFileSync('/run/secrets/database.json','utf8')),approval.database_host_sha256);
  const {migrationManifest} = await import(pathToFileURL('/workspace/apps/api/dist/infrastructure/database/schema-manifest.js'));
  const db = await require('mysql2/promise').createConnection({host:v.host,port:v.port,database:v.database,
    user:v.username,password:v.password,connectTimeout:10000,multipleStatements:false,
    ssl:{ca:fs.readFileSync('/run/secrets/rds-ca.pem'),rejectUnauthorized:true,verifyIdentity:true}});
  try {
    const [identity] = await db.query('SELECT DATABASE() AS db,CURRENT_USER() AS account');
    const [tls] = await db.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    if (identity[0].db !== 'rogichatprod' || !identity[0].account.startsWith('rogichat_app@') || !tls[0]?.Value) fail();
    const [grants] = await db.query('SHOW GRANTS FOR CURRENT_USER()');
    validateGrants(grants);
    const [rows] = await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name LIMIT 101');
    validateHistory(rows,migrationManifest);
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Production schema/TLS/grants gate rejected; no migration executed.'); process.exitCode=1; });
}
