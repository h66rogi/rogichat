import assert from 'node:assert/strict';
import { once } from 'node:events';
import { decoderServer } from '../../dist/isolated/media-decoder/media-decoder-server.js';
assert.equal(process.env.DATABASE_URL, undefined);
assert.equal(process.env.AUTH_SECRET_FILE, undefined);
const [directory, socket] = process.argv.slice(2);
const server = decoderServer(directory, { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' });
server.listen(socket); await once(server, 'listening'); process.send({ type: 'ready' });
process.once('SIGTERM', () => server.close(() => process.exit(0)));
