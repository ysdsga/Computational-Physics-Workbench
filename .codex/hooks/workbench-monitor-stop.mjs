import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function decideStopHook(input, guard, failureMessage = '') {
  if (failureMessage) {
    return {
      continue: true,
      systemMessage: `Workbench monitor guard could not be checked: ${failureMessage}. Run workbench doctor before the next real research action.`,
    };
  }
  const unattended = Array.isArray(guard?.unattendedRuns) ? guard.unattendedRuns : [];
  const cleanup = Array.isArray(guard?.cleanupRequired) ? guard.cleanupRequired : [];
  if (guard?.ok !== false || unattended.length === 0 && cleanup.length === 0) return { continue: true };
  const unattendedRuns = unattended.map(item => item.run_id).filter(Boolean).join(', ');
  const cleanupRuns = cleanup.map(item => item.run_id).filter(Boolean).join(', ');
  if (input?.stop_hook_active === true) {
    return {
      continue: true,
      systemMessage: [
        unattendedRuns ? `Active Workbench Run(s) still have an absent, paused, or stale Scheduled Task monitor: ${unattendedRuns}.` : '',
        cleanupRuns ? `Terminal Workbench Run(s) still require automation deletion acknowledgement: ${cleanupRuns}.` : '',
      ].filter(Boolean).join(' '),
    };
  }
  if (cleanupRuns) return {
    decision: 'block',
    reason: `Workbench Run(s) ${cleanupRuns} have no active remote Jobs but still reference a Codex automation. Delete each returned automation through the Codex automation API, confirm success, then run workbench monitor close with the matching reference and automation-state deleted.`,
  };
  return {
    decision: 'block',
    reason: `Active Workbench Run(s) ${unattendedRuns} have remote Jobs but their current-chat Scheduled Task is absent, paused, or outside its heartbeat lease. Create, resume, or update exactly one heartbeat per Run, confirm it is ACTIVE, attach/sync its reference and cadence, then rerun workbench monitor guard. The Hook does not poll HPC itself.`,
  };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; });
    process.stdin.on('end', () => {
      try { resolve(value.trim() ? JSON.parse(value) : {}); } catch (error) { reject(error); }
    });
    process.stdin.on('error', reject);
  });
}

async function main() {
  let input = {};
  try { input = await readStdin(); }
  catch (error) {
    process.stdout.write(`${JSON.stringify(decideStopHook({}, null, `invalid Hook input: ${error.message}`))}\n`);
    return;
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cli = path.resolve(repoRoot, 'bin', 'workbench.js');
  const result = spawnSync(process.execPath, [cli, 'monitor', 'guard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8_000,
    env: process.env,
  });
  let guard = null;
  let failure = '';
  if (result.error) failure = result.error.message;
  else if (result.status !== 0) failure = (result.stderr || `workbench monitor guard exited ${result.status}`).trim();
  else {
    try { guard = JSON.parse(result.stdout); }
    catch (error) { failure = `invalid guard response: ${error.message}`; }
  }
  process.stdout.write(`${JSON.stringify(decideStopHook(input, guard, failure))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
