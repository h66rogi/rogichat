// Dedicated decoder entrypoint. Never mount API/worker secret files into this container.
import { chmod, lstat, unlink } from 'node:fs/promises';
import { decoderServer } from './media-decoder-server.js';
const socketPath = '/run/decoder/image.sock';
try {
  if (process.env.DECODER_ISOLATED !== 'true' || ['DATABASE_URL', 'DATABASE_SECRET_FILE', 'AUTH_SECRET_FILE', 'MEDIA_SECRET_FILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].some(key => process.env[key] !== undefined)) throw new Error();
  for (const path of ['/run/rogichat/secrets', '/etc/rogichat', '/var/run/docker.sock']) {
    try { await lstat(path); throw new Error('unsafe_mount'); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  try { const entry = await lstat(socketPath); if (!entry.isSocket()) throw new Error(); await unlink(socketPath); }
  catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  const server = decoderServer('/tmp');
  server.listen(socketPath, () => { void chmod(socketPath, 0o600).catch(() => { process.exitCode = 1; server.close(); }); });
  server.once('error', () => { process.exitCode = 1; });
  process.once('SIGTERM', () => { server.close(); setTimeout(() => process.exit(1), 10000).unref(); });
} catch { process.exitCode = 1; }
