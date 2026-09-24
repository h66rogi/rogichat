#!/usr/bin/env node
// Exact trusted QA push checks gate registry authentication, never PR artifacts.
const sha = process.env.SOURCE_SHA;
const repository = process.env.SOURCE_REPOSITORY;
if (!/^[a-f0-9]{40}$/.test(sha ?? '') || repository !== 'h66rogi/rogichat') throw new Error('Invalid source');
const workflows = ['backend.yml', 'security.yml', 'infrastructure.yml', 'mobile.yml'];
const deadline = Date.now() + 20 * 60 * 1000;
const headers = {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'};
while (Date.now() < deadline) {
  let ready = true;
  for (const workflow of workflows) {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?branch=qa&event=push&head_sha=${sha}&per_page=20`,
      {headers, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Verification API failed (${response.status})`);
    const data = await response.json();
    const matches = run => run.head_sha === sha && run.head_branch === 'qa' && run.event === 'push'
      && run.repository?.full_name === repository && run.head_repository?.full_name === repository
      && run.path === `.github/workflows/${workflow}`
      && Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0;
    if (!Array.isArray(data.workflow_runs) || data.workflow_runs.length > 20) throw new Error('Invalid run listing');
    let run = data.workflow_runs.filter(matches).sort((a, b) => b.id - a.id)[0];
    if (run) {
      const exact = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
        {headers, signal: AbortSignal.timeout(15000)});
      if (!exact.ok) throw new Error(`Exact attempt API failed (${exact.status})`);
      const checked = await exact.json();
      if (!matches(checked) || checked.id !== run.id || checked.run_attempt !== run.run_attempt) {
        throw new Error('Attempt identity mismatch');
      }
      run = checked;
    }
    if (run?.status === 'completed' && run.conclusion !== 'success') throw new Error(`${workflow} did not pass`);
    if (!run || run.status !== 'completed' || run.conclusion !== 'success') ready = false;
  }
  if (ready) {
    console.log('Exact QA source passed backend, security, infrastructure and mobile verification');
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 15000));
}
throw new Error('Timed out waiting for exact-source verification');
