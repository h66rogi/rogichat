import { createHash } from 'node:crypto';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

function requireDigest(value) {
  if (!SHA256.test(value ?? '')) throw new Error('Invalid registry digest');
  return value;
}

export async function registryReader(repository, githubToken, fetcher = fetch) {
  if (!/^rogichat-(?:api|api-migration|media-decoder|web)$/.test(repository)
      || !githubToken) throw new Error('Invalid registry request');
  const auth = Buffer.from(`x-access-token:${githubToken}`).toString('base64');
  const tokenUrl = new URL('https://ghcr.io/token');
  tokenUrl.searchParams.set('service', 'ghcr.io');
  tokenUrl.searchParams.set('scope', `repository:h66rogi/${repository}:pull`);
  const tokenResponse = await fetcher(tokenUrl, {
    headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok) throw new Error(`Registry token request failed (${tokenResponse.status})`);
  const tokenData = await tokenResponse.json();
  const bearer = tokenData.token ?? tokenData.access_token;
  if (typeof bearer !== 'string' || !bearer) throw new Error('Registry token missing');
  const request = async (kind, reference) => {
    const url = `https://ghcr.io/v2/h66rogi/${repository}/${kind}/${reference}`;
    return fetcher(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: ACCEPT },
      signal: AbortSignal.timeout(15000) });
  };
  return { request };
}

export async function remoteImage(repository, sourceSha, githubToken, fetcher = fetch) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('Invalid source SHA');
  const { request } = await registryReader(repository, githubToken, fetcher);
  const tag = `qa-${sourceSha}`;
  const tagged = await request('manifests', tag);
  if (tagged.status === 404) return null;
  if (!tagged.ok) throw new Error(`Registry manifest request failed (${tagged.status})`);
  const taggedText = await tagged.text();
  const manifestDigest = requireDigest(tagged.headers.get('docker-content-digest')
    ?? `sha256:${createHash('sha256').update(taggedText).digest('hex')}`);
  let manifest = JSON.parse(taggedText);
  if (Array.isArray(manifest.manifests)) {
    const images = manifest.manifests.filter(item => item.platform?.os === 'linux'
      && item.platform?.architecture === 'amd64');
    if (images.length !== 1) throw new Error('Ambiguous amd64 registry image');
    const child = await request('manifests', requireDigest(images[0].digest));
    if (!child.ok) throw new Error(`Registry child manifest failed (${child.status})`);
    manifest = await child.json();
  }
  const configDigest = requireDigest(manifest.config?.digest);
  const blob = await request('blobs', configDigest);
  if (!blob.ok) throw new Error(`Registry config request failed (${blob.status})`);
  const config = await blob.json();
  if (config.config?.Labels?.['org.opencontainers.image.revision'] !== sourceSha) {
    throw new Error('Registry image source label mismatch');
  }
  return { manifestDigest, configDigest };
}

export function publicationDecision(checkedImageId, existing) {
  requireDigest(checkedImageId);
  if (existing === null) return 'push';
  if (existing.configDigest !== checkedImageId) throw new Error('Existing immutable tag differs from checked image');
  return 'already-published';
}
