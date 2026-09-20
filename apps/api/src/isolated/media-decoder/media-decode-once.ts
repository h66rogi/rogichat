// Runs ONLY in the scratch-only, network-none decoder container, never as a worker child.
import { decodeImage } from './media-image-decoder.js';
import { parseMediaIntent } from '../../common/media/media-policy.js';
try {
  if (process.argv.length !== 5) throw new Error();
  const intent = parseMediaIntent(JSON.parse(process.argv[4]!), { canRegisterStickers: true });
  const result = await decodeImage(process.argv[2]!, process.argv[3]!, intent);
  process.stdout.write(JSON.stringify(result));
} catch { process.exitCode = 1; }
