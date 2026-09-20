#!/usr/bin/env node
// Only trusted QA push workflows can authorize publication; PR artifacts are never inputs.
import { appendFile } from 'node:fs/promises';
const sha = process.env.SOURCE_SHA;
const repository = process.env.SOURCE_REPOSITORY;
if (!/^[a-f0-9]{40}$/.test(sha ?? '') || repository !== 'h66rogi/rogichat') throw new Error('Invalid source');
const workflows = ['web.yml', 'backend.yml', 'security.yml', 'infrastructure.yml', 'mobile.yml'];
const deadline = Date.now() + 25 * 60 * 1000;
while (Date.now() < deadline) {
  const evidence = [];
  for (const workflow of workflows) {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?branch=qa&event=push&head_sha=${sha}&per_page=20`, {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Verification API failed (${response.status})`);
    const data = await response.json();
    const run = data.workflow_runs?.filter(run => run.head_sha === sha && run.head_branch === 'qa' && run.event === 'push' && run.head_repository?.full_name === repository).sort((a, b) => b.id - a.id)[0];
    if (run?.status === 'completed' && run.conclusion !== 'success') throw new Error(`${workflow} did not pass`);
    if (run?.status === 'completed' && run.conclusion === 'success') evidence.push({ workflow, id: run.id, attempt: run.run_attempt, url: run.html_url, sha });
  }
  if (evidence.length === workflows.length) {
    await appendFile(process.env.GITHUB_OUTPUT, `evidence=${JSON.stringify(evidence)}\n`);
    console.log('Exact QA push passed all five verification workflows');
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 15000));
}
throw new Error('Timed out waiting for exact-source verification');
