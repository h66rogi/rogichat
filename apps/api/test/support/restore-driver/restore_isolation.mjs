/** Real isolated-MySQL custody checks and protected Unix IPC; no live adapter.
 * The trusted test-lane custodian owns the admin connection and dedicated random
 * target-account credentials. No app/worker receives that operator account.
 */
import { createServer } from 'node:net';
import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectStorageFence } from './restore_storage_fence.mjs';
import { canonical, checkProof } from './restore_proof.mjs';

const reject = () => { throw new Error('restore_isolation_rejected'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const requiredGlobals = ['Select_priv', 'Insert_priv', 'Update_priv', 'Delete_priv', 'Index_priv'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

async function readProtected(path, maximum) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) reject();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino
        || ![0o400, 0o600].includes(info.mode & 0o7777) || ![0, process.getuid?.()].includes(info.uid)
        || info.size < 1 || info.size > maximum) reject();
    const bytes = await handle.readFile();
    if (bytes.length !== info.size) reject();
    return bytes;
  } finally { await handle.close(); }
}

// MySQL database grants support SQL wildcards even in quoted database names.
function matchesGrant(pattern, database) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\' && i + 1 < pattern.length) regex += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (char === '%') regex += '.*';
    else if (char === '_') regex += '.';
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$').test(database);
}

export async function createIsolationAuthority({ admin, targetUrl, scope, boundaryEnvelope,
  authorityPrivateKey, ledgerFile, admissionFile, connectTarget, previousAuthorizationEpochSha256, authSecretFile, authAudience, storageRoot, storageScopeSha256 }) {
  // Never infer a live target from the runtime environment or accept a socket
  // supplied by an untrusted proof. Only an explicitly owned loopback test DB.
  const url = new URL(targetUrl);
  const oldPassword = decodeURIComponent(url.password);
  const suffix = /^\/rogichat_test_([a-f0-9]{16})$/.exec(url.pathname)?.[1];
  if (!suffix || url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !url.port
      || decodeURIComponent(url.username) !== `fixture_${suffix}` || !url.password || url.search || url.hash
      || scope.environment !== 'qa' || scope.targetId !== url.pathname.slice(1)) reject();
  if (typeof previousAuthorizationEpochSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(previousAuthorizationEpochSha256)) reject();
  if (typeof authAudience !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(authAudience)) reject();
  const authBytes = await readProtected(authSecretFile, 8192);
  const authSecretSha256 = hash(authBytes);
  const authRecord = JSON.parse(authBytes);
  if (!authRecord || typeof authRecord !== 'object' || Array.isArray(authRecord)
      || Object.keys(authRecord).some(key => !['key', 'identityGuardKey', 'broker'].includes(key))
      || typeof authRecord.key !== 'string' || !/^[a-f0-9]{64}$/.test(authRecord.key)) reject();
  const storage = await inspectStorageFence(storageRoot, storageScopeSha256);
  const database = scope.targetId, account = `fixture_${suffix}`;
  const privateKey = createPrivateKey(authorityPrivateKey);
  if (privateKey.asymmetricKeyType !== 'ed25519') reject();
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const keyId = hash(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }));
  const boundary = checkProof(boundaryEnvelope, publicKey, { ...scope, purpose: 'restore-ledger-boundary' });
  const [identity] = await admin.query('SELECT CONNECTION_ID() AS connectionId, CURRENT_USER() AS principal, @@hostname AS hostname, @@port AS port');
  if (identity.length !== 1 || !Number.isSafeInteger(Number(identity[0].connectionId))) reject();
  if (typeof connectTarget !== 'function') reject();
  const adminId = Number(identity[0].connectionId), adminPrincipal = identity[0].principal;
  const adminUser = adminPrincipal.split('@')[0];
  if (adminUser === account) reject();
  const [serverIdentity] = await admin.query('SELECT @@server_uuid AS serverUuid');
  const serverUuid = serverIdentity[0]?.serverUuid;
  if (typeof serverUuid !== 'string' || !serverUuid) reject();
  const scopeSha256 = hash(canonical(scope));
  const lease = 'restore:' + scopeSha256.slice(0, 48);
  const [lock] = await admin.execute('SELECT GET_LOCK(?, 0) AS acquired', [lease]);
  if (Number(lock[0]?.acquired) !== 1) reject();
  let closed = false, rotated = false, directory, server, authorizationEpochFile, authorizationEpochFileSha256, authorizationEpoch, authorizationKeySha256, custodyFile;
  const boundaryDigest = boundary.payloadSha256;
  const nonces = new Set();

  async function assertHeld() {
    if (closed || canonical(await inspectStorageFence(storageRoot, storageScopeSha256)) !== canonical(storage)) reject();
    const freshEpochFile = await readProtected(authorizationEpochFile, 256);
    const epochRecord = JSON.parse(freshEpochFile);
    if (!exact(epochRecord, ['authorizationEpoch']) || epochRecord.authorizationEpoch !== authorizationEpoch
        || hash(freshEpochFile) !== authorizationEpochFileSha256
        || hash(authorizationEpoch) === previousAuthorizationEpochSha256) reject();
    const currentAuth = await readProtected(authSecretFile, 8192);
    if (hash(currentAuth) !== authSecretSha256) reject();
    const actualKey = Buffer.from(JSON.parse(currentAuth).key, 'hex');
    const derived = createHmac('sha256', actualKey).update('rogichat:authorization-epoch:v1:')
      .update(authAudience).update(':').update(authorizationEpoch).digest();
    if (hash(derived) !== authorizationKeySha256) reject();
    actualKey.fill(0); derived.fill(0);
    const custody = JSON.parse(await readProtected(custodyFile, 1024));
    if (canonical(custody) !== canonical({ previousAuthorizationEpochSha256, authorizationEpochFileSha256,
        authorizationKeySha256, authSecretSha256, scopeSha256: hash(canonical(scope)) })) reject();
    if (hash(canonical(scope)) !== scopeSha256
        || checkProof(boundaryEnvelope, publicKey, { ...scope, purpose: 'restore-ledger-boundary' }).payloadSha256 !== boundaryDigest) reject();
    const [current] = await admin.query('SELECT CONNECTION_ID() AS connectionId');
    if (Number(current[0]?.connectionId) !== adminId) reject();
    const [held] = await admin.execute('SELECT IS_USED_LOCK(?) AS owner', [lease]);
    if (Number(held[0]?.owner) !== adminId) reject();
    const [target] = await admin.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if (target.length !== 1) reject();
    // The independently retained files are outside the restored database. Their
    // signed digests are reread for every challenge; no replay watermark is used.
    const records = JSON.parse(await readFile(ledgerFile, 'utf8'));
    if (!Array.isArray(records) || records.length > 10000) reject();
    const actual = records.map(record => {
      if (!exact(record, ['key', 'canonicalBase64']) || typeof record.canonicalBase64 !== 'string') reject();
      const bytes = Buffer.from(record.canonicalBase64, 'base64');
      if (!bytes.length || bytes.length > 4096 || bytes.toString('base64') !== record.canonicalBase64) reject();
      return { key: record.key, sha256: hash(bytes) };
    }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    if (canonical(actual) !== canonical(boundary.payload.inventory)) reject();
    const admission = JSON.parse(await readFile(admissionFile, 'utf8'));
    if (!exact(admission, ['admissionFenceId', 'ledgerBoundaryId', 'targetId', 'pendingRequestIds'])
        || admission.admissionFenceId !== boundary.payload.admissionFenceId
        || admission.ledgerBoundaryId !== boundary.payload.ledgerBoundaryId
        || admission.targetId !== database || !Array.isArray(admission.pendingRequestIds)
        || admission.pendingRequestIds.length !== 0) reject();
    const [columns] = await admin.query("SELECT COLUMN_NAME AS privilege FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'mysql' AND TABLE_NAME = 'user'");
    const globals = columns.map(row => row.privilege).filter(name => typeof name === 'string' && name.endsWith('_priv'));
    if (!globals.length || globals.some(name => !/^[A-Za-z_]+$/.test(name))
        || new Set(globals).size !== globals.length || requiredGlobals.some(name => !globals.includes(name))) reject();
    const [users] = await admin.query(`SELECT User, Host, account_locked, ${globals.join(', ')} FROM mysql.user`);
    const dedicated = users.filter(row => row.User === account);
    if (dedicated.length !== 1 || dedicated[0].Host !== '%' || dedicated[0].account_locked !== 'N'
        || globals.some(privilege => dedicated[0][privilege] !== 'N')) reject();
    for (const user of users) {
      if (user.User === adminUser) continue;
      if (['mysql.infoschema', 'mysql.session', 'mysql.sys'].includes(user.User) && user.account_locked === 'Y') continue;
      if (globals.some(privilege => user[privilege] !== 'N')) reject();
    }
    for (const table of ['global_grants', 'proxies_priv']) {
      const [privileges] = await admin.query(`SELECT User AS principalUser FROM mysql.${table}`);
      if (privileges.some(row => row.principalUser !== adminUser
          && !['mysql.infoschema', 'mysql.session', 'mysql.sys'].includes(row.principalUser))) reject();
    }
    const [roles] = await admin.query('SELECT FROM_USER, TO_USER FROM mysql.role_edges');
    if (roles.length) reject();
    const [grants] = await admin.query('SELECT * FROM mysql.db');
    for (const grant of grants) {
      if (matchesGrant(grant.Db, database) && grant.User !== account && `${grant.User}@${grant.Host}` !== adminPrincipal) reject();
    }
    const own = grants.filter(row => row.User === account);
    if (own.length !== 1 || own[0].Db !== database || own[0].Host !== '%'
        || ['Select_priv', 'Insert_priv', 'Update_priv', 'Delete_priv'].some(field => own[0][field] !== 'Y')
        || Object.entries(own[0]).some(([field, value]) => field.endsWith('_priv')
          && !['Select_priv', 'Insert_priv', 'Update_priv', 'Delete_priv'].includes(field) && value !== 'N')) reject();
    for (const table of ['tables_priv', 'columns_priv', 'procs_priv']) {
      const [rows] = await admin.execute(`SELECT User FROM mysql.${table} WHERE Db = ?`, [database]);
      if (rows.length) reject();
    }
    const connection = await connectTarget({ host: '127.0.0.1', port: Number(url.port),
      user: account, password: decodeURIComponent(url.password), database });
    try {
      const [actualTarget] = await connection.query('SELECT @@server_uuid AS serverUuid, DATABASE() AS db, CURRENT_USER() AS principal');
      if (actualTarget.length !== 1 || actualTarget[0].serverUuid !== serverUuid
          || actualTarget[0].db !== database || actualTarget[0].principal !== `${account}@%`) reject();
    } finally { await connection.end(); }
    const [sessions] = await admin.execute('SELECT ID, USER FROM information_schema.PROCESSLIST WHERE DB = ?', [database]);
    if (sessions.some(row => Number(row.ID) !== adminId && row.USER !== account)) reject();
  }

  async function drain() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [sessions] = await admin.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE USER = ?', [account]);
      if (!sessions.length) return;
      for (const session of sessions) {
        const id = Number(session.ID);
        if (!Number.isSafeInteger(id) || id <= 0 || id === adminId) reject();
        try { await admin.query(`KILL CONNECTION ${id}`); }
        catch (error) { if (error?.code !== 'ER_NO_SUCH_THREAD') reject(); }
      }
    }
    const [remaining] = await admin.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE USER = ?', [account]);
    if (remaining.length) reject();
  }
  async function lockAndDrain() {
    await admin.query("ALTER USER ?@'%' ACCOUNT LOCK", [account]);
    await drain();
  }
  async function rotateAndDrain() {
    // Only after complete real target/account validation. Lock rejects new old-
    // credential admissions; draining kills preexisting sessions before release.
    rotated = true;
    await lockAndDrain();
    const fresh = randomBytes(32).toString('hex');
    await admin.query("ALTER USER ?@'%' IDENTIFIED BY ?", [account, fresh]);
    await admin.query("ALTER USER ?@'%' DISCARD OLD PASSWORD", [account]);
    url.password = fresh;
    await admin.query("ALTER USER ?@'%' ACCOUNT UNLOCK", [account]);
    let old;
    try {
      old = await connectTarget({ host: '127.0.0.1', port: Number(url.port), user: account, password: oldPassword, database });
    } catch (error) {
      if (error?.code !== 'ER_ACCESS_DENIED_ERROR') reject();
    }
    if (old) { await old.end(); reject(); }
    await assertHeld(); // Fresh protected credential must still authenticate.
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      try { if (rotated) await lockAndDrain(); }
      finally { await admin.execute('SELECT RELEASE_LOCK(?)', [lease]); }
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }

  try {
    directory = await mkdtemp(join(tmpdir(), 'rogi-restore-custody-'));
    await chmod(directory, 0o700);
    authorizationEpochFile = join(directory, 'authorization-epoch');
    custodyFile = join(directory, 'epoch-custody.json');
    authorizationEpoch = randomUUID();
    if (hash(authorizationEpoch) === previousAuthorizationEpochSha256) reject();
    const freshEpochFile = Buffer.from(canonical({ authorizationEpoch }));
    authorizationEpochFileSha256 = hash(freshEpochFile);
    const stableKey = Buffer.from(authRecord.key, 'hex');
    const derived = createHmac('sha256', stableKey).update('rogichat:authorization-epoch:v1:')
      .update(authAudience).update(':').update(authorizationEpoch).digest();
    authorizationKeySha256 = hash(derived);
    stableKey.fill(0); derived.fill(0);
    await writeFile(authorizationEpochFile, freshEpochFile, { mode: 0o600, flag: 'wx' });
    await writeFile(custodyFile, canonical({ previousAuthorizationEpochSha256, authorizationEpochFileSha256,
      authorizationKeySha256, authSecretSha256, scopeSha256: hash(canonical(scope)) }), { mode: 0o600, flag: 'wx' });
    await assertHeld();
    await rotateAndDrain();
    const socketPath = join(directory, 'authority.sock');
    server = createServer(socket => {
      socket.setTimeout(3000, () => socket.destroy());
      let input = '', handled = false;
      socket.on('error', () => {});
      socket.on('data', bytes => {
        if (handled || Buffer.byteLength(input) + bytes.length > 8192) { socket.destroy(); return; }
        input += bytes.toString('utf8');
        if (!input.endsWith('\n')) return;
        handled = true;
        void (async () => {
          try {
            const request = JSON.parse(input);
            if (!exact(request, ['version', 'operation', 'challenge', 'scope', 'boundarySha256'])
                || request.version !== 1 || request.operation !== 'assertHeld'
                || !/^[a-f0-9]{64}$/.test(request.challenge) || nonces.has(request.challenge)
                || canonical(request.scope) !== canonical(scope) || request.boundarySha256 !== boundaryDigest) reject();
            nonces.add(request.challenge);
            if (nonces.size > 10000) reject();
            await assertHeld();
            const now = Math.floor(Date.now() / 1000);
            const payload = { version: 1, purpose: 'restore-isolation-held', challenge: request.challenge,
              scopeSha256: hash(canonical(scope)), boundarySha256: boundaryDigest,
              admissionFenceId: boundary.payload.admissionFenceId, authorizationEpoch, authorizationKeySha256,
              mysqlLeaseName: lease, mysqlLeaseOwner: adminId, mysqlServerUuid: serverUuid, ...storage, issuedAt: now, expiresAt: now + 5 };
            const bytes = Buffer.from(canonical(payload));
            socket.end(JSON.stringify({ payloadBase64: bytes.toString('base64'),
              signatureBase64: sign(null, bytes, privateKey).toString('base64'), keyId }) + '\n');
          } catch { socket.end('{"error":"restore_isolation_rejected"}\n'); }
        })();
      });
    });
    await new Promise((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    return { targetUrl: url.href, socketPath, publicKey, boundarySha256: boundaryDigest, authorizationEpochFile, authorizationEpoch, authorizationKeySha256, ...storage, assertHeld, close };
  } catch {
    try { await close(); } catch { /* Preserve the fail-closed rejection. */ }
    reject();
  }
}
