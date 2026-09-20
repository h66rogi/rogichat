// Separately reviewed root-installed probe, mounted into a PINNED baseline runtime.
// Never import candidate code. Runtime credentials only; fixed read-only queries.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const fail = () => { throw new Error('readonly schema gate rejected'); };
export const queries = Object.freeze({
  tables: 'SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME',
  columns: 'SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_DEFAULT,IS_NULLABLE,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION',
  indexes: 'SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,COLLATION,SUB_PART,NULLABLE,INDEX_TYPE,EXPRESSION,IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX',
  foreignKeys: 'SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.ORDINAL_POSITION,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION',
  checks: 'SELECT tc.TABLE_NAME,cc.CONSTRAINT_NAME,cc.CHECK_CLAUSE,tc.ENFORCED FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE cc.CONSTRAINT_SCHEMA=DATABASE() ORDER BY tc.TABLE_NAME,cc.CONSTRAINT_NAME',
});
export const historySQL = 'SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name LIMIT 101';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(typeof value === 'bigint' ? String(value) : value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export function fingerprint(schema) {
  if (!schema || Object.keys(schema).sort().join(',') !== Object.keys(queries).sort().join(',')
      || Object.values(schema).some(rows => !Array.isArray(rows)) || !schema.tables.length || !schema.columns.length) fail();
  return crypto.createHash('sha256').update(canonical(schema)).digest('hex');
}
export function validateHistory(rows, baseline) {
  if (!Array.isArray(baseline) || !baseline.length || baseline.length > 100 || rows.length !== baseline.length) fail();
  let previous = '';
  baseline.forEach((expected, index) => {
    const row = rows[index];
    if (!/^[0-9]{14}_[a-z0-9_]{1,80}$/.test(expected.name) || !/^[a-f0-9]{64}$/.test(expected.checksum)
        || expected.name <= previous || row.migration_name !== expected.name || row.checksum !== expected.checksum
        || row.finished_at == null || row.rolled_back_at !== null) fail();
    previous = expected.name;
  });
}
export function validateGrants(rows) {
  const expected = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
  const found = new Set();
  for (const row of rows) {
    const grant = String(Object.values(row)[0]);
    const account = "(?:'rogichat_app'|`rogichat_app`)@(?:'[^']+'|`[^`]+`)";
    if (new RegExp('^GRANT USAGE ON \\*\\.\\* TO ' + account + '$').test(grant)) continue;
    const match = new RegExp('^GRANT ([A-Z, ]+) ON `rogichatqa`\\.\\* TO ' + account + '$').exec(grant);
    if (!match) fail();
    for (const privilege of match[1].split(', ')) {
      if (!expected.has(privilege)) fail();
      found.add(privilege);
    }
  }
  if ([...expected].some(value => !found.has(value))) fail();
}
export function validateCredential(value, hostHash) {
  if (!value || Object.keys(value).sort().join(',') !== 'database,host,password,port,username'
      || value.database !== 'rogichatqa' || value.username !== 'rogichat_app' || value.port !== 3306
      || typeof value.password !== 'string' || value.password.length < 32 || value.password.length > 1024
      || typeof value.host !== 'string' || !/^[a-z0-9.-]+$/.test(value.host)
      || crypto.createHash('sha256').update(value.host).digest('hex') !== hostHash) fail();
  return value;
}
export async function inspect(connection, policy) {
  const identity = await connection.query('SELECT DATABASE() AS db,CURRENT_USER() AS account');
  const tls = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (identity.length !== 1 || identity[0].db !== 'rogichatqa'
      || !identity[0].account.startsWith('rogichat_app@') || !tls[0]?.Value) fail();
  validateGrants(await connection.query('SHOW GRANTS FOR CURRENT_USER()'));
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    validateHistory(await connection.query(historySQL), policy.migrations);
    const schema = {};
    for (const [key, query] of Object.entries(queries)) schema[key] = await connection.query(query);
    const hash = fingerprint(schema);
    if (hash !== policy.schema_sha256) fail();
    return {schema: 'exact', schema_sha256: hash, runtime_grants: 'dml-only', migrations: policy.migrations};
  } finally { await connection.query('ROLLBACK'); }
}
export async function main() {
  if (process.argv.length !== 2 || process.getuid() !== 10001) fail();
  const policy = JSON.parse(fs.readFileSync('/run/probe/policy.json', 'utf8'));
  if (policy.environment !== 'qa') fail();
  const credential = validateCredential(JSON.parse(fs.readFileSync('/run/secrets/database.json', 'utf8')), policy.database_host_sha256);
  const require = createRequire('/app/apps/api/package.json');
  const mariadb = require('mariadb');
  const connection = await mariadb.createConnection({host: credential.host, port: credential.port,
    database: credential.database, user: credential.username, password: credential.password,
    connectTimeout: 10000, socketTimeout: 10000, multipleStatements: false,
    ssl: {ca: fs.readFileSync('/run/secrets/rds-ca.pem'), rejectUnauthorized: true},
  });
  try { console.log(JSON.stringify(await inspect(connection, policy))); }
  finally { await connection.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('QA readonly schema gate rejected.'); process.exitCode = 1; });
}
