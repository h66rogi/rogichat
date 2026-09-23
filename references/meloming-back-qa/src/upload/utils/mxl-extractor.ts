import yauzl from 'yauzl';
import { Readable } from 'stream';
import { isMusicXmlLike } from './sheet-music-mime';

const MAX_ENTRIES = 100;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_RATIO = 100;

export class MxlExtractError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'MxlExtractError';
  }
}

function isSafeEntryName(name: string): boolean {
  if (name.includes('..')) return false;
  if (name.startsWith('/')) return false;
  if (/^[a-z]:/i.test(name)) return false;
  return true;
}

async function streamToBuffer(
  stream: Readable,
  limit: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(
          new MxlExtractError('too_large', `entry exceeds ${limit} bytes`),
        );
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function extractMxlToMusicXml(mxlBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (v: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const safeReject = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };

    yauzl.fromBuffer(mxlBuffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        return safeReject(
          new MxlExtractError('invalid_zip', 'cannot open .mxl as zip'),
        );
      }
      let entryCount = 0;
      let totalUncompressed = 0;
      const candidates: { name: string; size: number; entry: yauzl.Entry }[] =
        [];

      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        entryCount++;
        if (entryCount > MAX_ENTRIES) {
          zip.close();
          return safeReject(
            new MxlExtractError('too_many_entries', `> ${MAX_ENTRIES} entries`),
          );
        }
        if (!isSafeEntryName(entry.fileName)) {
          zip.close();
          return safeReject(
            new MxlExtractError(
              'unsafe_entry',
              `unsafe path: ${entry.fileName}`,
            ),
          );
        }
        totalUncompressed += entry.uncompressedSize;
        if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
          zip.close();
          return safeReject(
            new MxlExtractError(
              'too_large_total',
              `total uncompressed > ${MAX_UNCOMPRESSED_BYTES}`,
            ),
          );
        }
        const ratio =
          entry.uncompressedSize / Math.max(entry.compressedSize, 1);
        if (ratio > MAX_RATIO) {
          zip.close();
          return safeReject(
            new MxlExtractError('zip_bomb', `ratio ${ratio} > ${MAX_RATIO}`),
          );
        }
        const lowerName = entry.fileName.toLowerCase();
        if (
          (lowerName.endsWith('.musicxml') || lowerName.endsWith('.xml')) &&
          !lowerName.includes('meta-inf/')
        ) {
          candidates.push({
            name: entry.fileName,
            size: entry.uncompressedSize,
            entry,
          });
        }
        zip.readEntry();
      });

      zip.on('end', () => {
        if (settled) return;
        if (candidates.length === 0) {
          return safeReject(
            new MxlExtractError('no_musicxml', 'no .musicxml/.xml entry'),
          );
        }
        const picked = candidates.sort((a, b) => b.size - a.size)[0];
        zip.openReadStream(picked.entry, (err2, stream) => {
          if (settled) return;
          if (err2 || !stream) {
            return safeReject(
              new MxlExtractError('read_error', 'cannot open entry stream'),
            );
          }
          streamToBuffer(stream, MAX_UNCOMPRESSED_BYTES)
            .then((buf) => {
              // Round 4 H4 — the outer file passed ZIP magic detection, but
              // the inner .musicxml/.xml entry is still untrusted content
              // (SVG, HTML-in-XML, etc.). Re-validate the root element before
              // returning. Without this, an attacker-crafted .mxl could ship
              // arbitrary XML to downstream consumers.
              if (!isMusicXmlLike(buf)) {
                return safeReject(
                  new MxlExtractError(
                    'invalid_musicxml_content',
                    'extracted entry is not a MusicXML score-partwise/timewise document',
                  ),
                );
              }
              safeResolve(buf);
            })
            .catch((e) =>
              safeReject(e instanceof Error ? e : new Error(String(e))),
            );
        });
      });

      zip.on('error', (e: Error) =>
        safeReject(new MxlExtractError('zip_error', String(e))),
      );
      zip.readEntry();
    });
  });
}
