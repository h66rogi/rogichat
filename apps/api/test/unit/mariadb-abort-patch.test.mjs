import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { setImmediate } from 'node:timers';

const require = createRequire(import.meta.url);
const adapterRequire = createRequire(require.resolve('@prisma/adapter-mariadb'));
const directory = dirname(adapterRequire.resolve('mariadb/package.json'));
const Connection = require(join(directory, 'lib/connection.js'));
const Options = require(join(directory, 'lib/config/connection-options.js'));
const { Status } = require(join(directory, 'lib/const/connection_status.js'));

test('exact pinned hard-abort patch is installed and recorded by frozen lockfile', () => {
  assert.equal(require(join(directory, 'package.json')).version, '3.4.7');
  assert.equal(require.resolve('mariadb/package.json'), adapterRequire.resolve('mariadb/package.json'));
  const patch = readFileSync(new URL('../../../../patches/mariadb@3.4.7.patch', import.meta.url));
  const lock = readFileSync(new URL('../../../../pnpm-lock.yaml', import.meta.url), 'utf8');
  assert.ok(lock.includes(createHash('sha256').update(patch).digest('hex')));
  assert.match(Connection.prototype.destroy.toString(), /this\.fatalError\(err, true\)/);
  assert.doesNotMatch(Connection.prototype.destroy.toString(), /new Connection|new Quit|killCon/);
  assert.match(Connection.prototype.createSecureContext.toString(), /info\.isMariaDB\(\) && this\.opts\.ssl === true/);
});

test('active query transport closes synchronously when any auxiliary connection is unavailable', async t => {
  let connectionAttempts = 0, closed = 0, rejected = 0;
  t.mock.method(net, 'connect', () => { connectionAttempts++; throw new Error('max_connections'); });
  const connection = new Connection(new Options({ host: '127.0.0.1' }));
  connection.status = Status.CONNECTED;
  connection.socket = { removeAllListeners() {}, destroyed: false, destroy() { closed++; this.destroyed = true; } };
  connection.receiveQueue.push({ onPacketReceive() {}, throwError(error) { rejected++; assert.equal(error.fatal, true); } });
  connection.destroy();
  assert.equal(closed, 1); assert.equal(connection.status, Status.CLOSED); assert.equal(connectionAttempts, 0);
  assert.equal(connection.addCommand, connection.addCommandDisabled);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected, 1); connection.destroy(); assert.equal(closed, 1);
});
