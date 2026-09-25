const REPOSITORY = 'h66rogi/rogichat';
const SHA = /^[a-f0-9]{40}$/;

async function github(path, token, fetcher) {
  const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Final QA ancestry API failed (${response.status})`);
  return response.json();
}

export async function verifyFinalQaAncestry(sourceSha, token, fetcher = fetch) {
  if (!SHA.test(sourceSha ?? '') || !token) throw new Error('Invalid publication source');
  const ref = await github('git/ref/heads/qa', token, fetcher);
  const head = ref.object?.sha;
  if (!SHA.test(head ?? '')) throw new Error('Invalid QA head');
  if (head === sourceSha) return head;
  const compare = await github(`compare/${sourceSha}...${head}`, token, fetcher);
  if (!['ahead', 'identical'].includes(compare.status)
      || compare.merge_base_commit?.sha !== sourceSha) {
    throw new Error('Publication source left QA ancestry');
  }
  return head;
}

if (process.argv[1]?.endsWith('/qa_publication_finalize.mjs')) {
  const head = await verifyFinalQaAncestry(process.env.SOURCE_SHA, process.env.GH_TOKEN);
  console.log(`Final QA ancestry verified at ${head}`);
}
