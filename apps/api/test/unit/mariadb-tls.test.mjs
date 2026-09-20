import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { createServer } from 'node:tls';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { poolOptions } from '../../dist/infrastructure/database/prisma-provider.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { sampleEnv } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const driver = dirname(require.resolve('mariadb/package.json'));
const Connection = require(join(driver, 'lib/connection.js'));
const Options = require(join(driver, 'lib/config/connection-options.js'));

test('driver real TLS rejects wrong CA and hostname before its authentication callback for both server families', { timeout: 20000 }, async t => {
  // Test-only keys are generated into a fresh private temp directory and removed;
  // no certificate/key or real credential is checked into the product.
  const directory = mkdtempSync(join(tmpdir(), 'rogichat-tls-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const certificate = (name, san) => {
    const key = join(directory, `${name}.key`), cert = join(directory, `${name}.crt`);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', `/CN=${name}.invalid`, '-addext', `subjectAltName=${san}`, '-keyout', key, '-out', cert], { stdio: 'ignore' });
    return { key: readFileSync(key), cert: readFileSync(cert), file: cert };
  };
  const trusted = certificate('trusted', 'DNS:localhost');
  const wrongCa = certificate('untrusted', 'DNS:localhost');
  const wrongName = certificate('wrong-name', 'DNS:wrong-name.invalid');
  for (const mariaDb of [false, true]) {
    for (const [name, peer, ca, expectAuth] of [
      ['valid', trusted, trusted, true], ['wrong-ca', wrongCa, trusted, false], ['wrong-hostname', wrongName, wrongName, false],
    ]) {
      const sockets = new Set(); let authBytes = Buffer.alloc(0), callbackInvoked = false, finish;
      const complete = new Promise(resolve => { finish = resolve; });
      const deadline = setTimeout(() => finish('timeout'), 2500);
      const server = createServer(peer, socket => {
        socket.on('data', bytes => { authBytes = Buffer.concat([authBytes, bytes]); finish(); });
      });
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      server.on('tlsClientError', () => {});
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const password = randomBytes(24).toString('hex');
      let connection;
      try {
        const config = readConfig('api', { ...sampleEnv, DB_TLS_MODE: 'required', DB_CA_FILE: ca.file,
          DATABASE_URL: `mysql://synthetic:${password}@localhost:${server.address().port}/rogichat_test` }, []);
        connection = new Connection(new Options(poolOptions(config)));
        connection.socket = connect({ host: '127.0.0.1', port: server.address().port });
        await once(connection.socket, 'connect');
        let rejectionCode;
        connection.socketErrorHandler = error => { rejectionCode = error?.code; finish(); };
        // Exercise the actual pinned driver's TLS transition. A successful callback
        // is exactly where the normal handshake would submit authentication bytes.
        connection.createSecureContext({ isMariaDB: () => mariaDb }, () => {
          callbackInvoked = true; connection.socket.write(password);
        });
        assert.notEqual(await complete, 'timeout', 'TLS boundary must settle within fixture deadline');
        assert.equal(callbackInvoked, expectAuth, `MariaDB=${mariaDb}/${name}: authentication callback (${rejectionCode})`);
        assert.equal(authBytes.includes(Buffer.from(password)), expectAuth);
        if (!expectAuth) assert.equal(authBytes.length, 0, 'no authentication before verified TLS');
      } finally {
        clearTimeout(deadline);
        connection?.socket?.destroy();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    }
  }
});
