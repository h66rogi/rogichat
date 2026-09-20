import { createConnection } from 'node:net';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { restoreRejected } from './restore-proof.js';
import type { RestoreProofVerifier, RestoreScope, VerifiedProof, BoundaryPayload } from './restore-proof.js';

// Private custody daemon is mandatory. The application never substitutes a
// boolean, process-local mutex, database discovery watermark or cached proof.
export class RestoreIsolationClient {
  constructor(private readonly socketPath: string, private readonly verifier: RestoreProofVerifier) {
    if (!isAbsolute(socketPath) || resolve(socketPath) !== socketPath || socketPath.length > 100) restoreRejected();
  }
  async assertHeld(scope: RestoreScope, boundary: VerifiedProof<BoundaryPayload>) {
    if (await realpath(this.socketPath) !== this.socketPath) restoreRejected();
    const [socketFile, parent] = await Promise.all([lstat(this.socketPath), lstat(dirname(this.socketPath))]);
    const own = (uid: number) => uid === 0 || uid === process.geteuid?.();
    if (!socketFile.isSocket() || socketFile.isSymbolicLink() || (socketFile.mode & 0o7777) !== 0o600 || !own(socketFile.uid) ||
        !parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o7777) !== 0o700 || !own(parent.uid)) restoreRejected();
    const challenge = randomBytes(32).toString('hex');
    const envelope = await new Promise<unknown>((resolve, reject) => {
      const socket = createConnection(this.socketPath); let input = Buffer.alloc(0), settled = false;
      const fail = () => { clearTimeout(deadline); if (!settled) { settled = true; reject(new Error('restore_isolation_unavailable')); } socket.destroy(); };
      const deadline = setTimeout(fail, 3000); // Absolute wall-clock bound, unaffected by trickled bytes.
      socket.setTimeout(3000, fail); socket.once('error', fail); socket.once('close', () => { if (!settled) fail(); });
      socket.once('connect', () => socket.write(JSON.stringify({ version: 1, operation: 'assertHeld', challenge, scope, boundarySha256: boundary.sha256 }) + '\n'));
      socket.on('data', (bytes: Buffer) => {
        if (settled || input.length + bytes.length > 16384) { fail(); return; }
        input = Buffer.concat([input, bytes]);
        if (!input.includes(10)) return;
        try {
          if (input.at(-1) !== 10 || input.subarray(0, -1).includes(10)) throw new Error();
          const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input));
          settled = true; clearTimeout(deadline); resolve(value); socket.destroy();
        } catch { fail(); }
      });
    });
    return this.verifier.isolation(envelope, scope, boundary, challenge, Math.floor(Date.now() / 1000));
  }
}
