import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'h66rogi/rogichat';
const SHA = /^[a-f0-9]{40}$/;
export const REQUIRED = Object.freeze({
  'web.yml': { workflow: 'Web production', job: 'Web required checks' },
  'backend.yml': { workflow: 'Backend foundation', job: 'verify' },
  'security.yml': { workflow: 'Security', job: 'Public repository guard' },
  'infrastructure.yml': { workflow: 'Infrastructure validation', job: 'validate' },
  'mobile.yml': { workflow: 'Mobile foundation', job: 'Mobile required checks' },
});

const validRun = (run, workflow, sha) => run?.head_sha === sha && run.head_branch === 'qa'
  && run.event === 'push' && run.repository?.full_name === REPOSITORY
  && run.head_repository?.full_name === REPOSITORY
  && run.path === `.github/workflows/${workflow}`
  && run.name === REQUIRED[workflow].workflow
  && Number.isSafeInteger(run.id) && run.id > 0
  && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0;

export function selectSource(eventName, event, checkoutSha, qaSha) {
  if (!SHA.test(checkoutSha ?? '') || !SHA.test(qaSha ?? '')) throw new Error('Invalid QA source SHA');
  if (checkoutSha !== qaSha) return { ready: false, reason: 'QA advanced after workflow dispatch' };
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    return { ready: true, sha: qaSha, trigger: null };
  }
  if (eventName !== 'workflow_run') throw new Error('Unsupported publication event');
  const run = event?.workflow_run;
  const workflow = Object.keys(REQUIRED).find(path => run?.path === `.github/workflows/${path}`);
  if (event?.repository?.full_name !== REPOSITORY || !workflow
      || !validRun(run, workflow, qaSha)) throw new Error('Untrusted workflow_run identity');
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    return { ready: false, reason: 'Triggering verification was not successful' };
  }
  return { ready: true, sha: qaSha,
    trigger: { workflow, id: run.id, attempt: run.run_attempt } };
}

async function json(url, token, fetcher) {
  const response = await fetcher(url, { headers: {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Verification API failed (${response.status})`);
  return response.json();
}

export async function exactChecks(sha, token, fetcher = fetch) {
  if (!SHA.test(sha ?? '') || !token) throw new Error('Invalid verification request');
  const evidence = [];
  for (const [workflow, required] of Object.entries(REQUIRED)) {
    const listing = await json(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${workflow}/runs?branch=qa&event=push&head_sha=${sha}&per_page=100`, token, fetcher);
    if (!Array.isArray(listing.workflow_runs) || listing.workflow_runs.length > 100
        || listing.total_count > 100) throw new Error('Incomplete workflow run listing');
    const latest = listing.workflow_runs.filter(run => validRun(run, workflow, sha))
      .sort((a, b) => b.id - a.id)[0];
    if (!latest) return { ready: false, reason: `${workflow} has no trusted QA push run` };
    const run = await json(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${latest.id}/attempts/${latest.run_attempt}`, token, fetcher);
    if (!validRun(run, workflow, sha) || run.id !== latest.id
        || run.run_attempt !== latest.run_attempt) throw new Error('Exact run attempt identity mismatch');
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return { ready: false, reason: `${workflow} latest attempt did not succeed` };
    }
    const jobs = await json(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, token, fetcher);
    if (!Array.isArray(jobs.jobs) || jobs.jobs.length > 100 || jobs.total_count > 100) {
      throw new Error('Incomplete required job listing');
    }
    const matches = jobs.jobs.filter(job => job.name === required.job);
    if (matches.length !== 1 || matches[0].status !== 'completed'
        || matches[0].conclusion !== 'success' || matches[0].run_id !== run.id
        || matches[0].run_attempt !== run.run_attempt) {
      return { ready: false, reason: `${workflow} required job did not succeed` };
    }
    evidence.push({ workflow, job: required.job, id: run.id,
      attempt: run.run_attempt, jobId: matches[0].id, sha });
  }
  return { ready: true, evidence };
}

export function triggerIsLatest(trigger, evidence) {
  if (!trigger) return true;
  const run = evidence.find(item => item.workflow === trigger.workflow);
  return run?.id === trigger.id && run.attempt === trigger.attempt;
}

export async function runGate(env = process.env, fetcher = fetch) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || !env.GH_TOKEN) throw new Error('Invalid repository or token');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const ref = await json(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/qa`, env.GH_TOKEN, fetcher);
  const selected = selectSource(env.GITHUB_EVENT_NAME, event, env.GITHUB_SHA, ref.object?.sha);
  if (!selected.ready) return selected;
  const checks = await exactChecks(selected.sha, env.GH_TOKEN, fetcher);
  if (!checks.ready) return checks;
  if (!triggerIsLatest(selected.trigger, checks.evidence)) {
    return { ready: false, reason: 'Superseded workflow_run attempt' };
  }
  return { ready: true, sha: selected.sha, evidence: checks.evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runGate();
  console.log(result.ready ? `Five exact QA required checks passed for ${result.sha}` : result.reason);
  if (!result.ready && process.env.GATE_REQUIRE_READY === 'true') process.exitCode = 1;
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      `ready=${result.ready}\n${result.ready ? `source_sha=${result.sha}\nevidence=${JSON.stringify(result.evidence)}\n` : ''}`);
  }
}
