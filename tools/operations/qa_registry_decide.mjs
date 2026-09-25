import { remoteImage, publicationDecision } from './qa_registry.mjs';

const [repository, sourceSha, checkedImageId] = process.argv.slice(2);
const existing = await remoteImage(repository, sourceSha, process.env.GHCR_TOKEN);
const decision = publicationDecision(checkedImageId, existing);
console.log(`${decision} ${existing?.manifestDigest ?? '-'}`);
