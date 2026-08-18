export interface SchedulerObservation {
  jobId: string | null;
  status: string;
  jobName: string | null;
}

export function parseFormattedSchedulerObservation(output: string): SchedulerObservation {
  const fields = output.trim().split(/\s+/);
  return { jobId: fields[0] || null, status: (fields[1] || 'UNKWN').toUpperCase(), jobName: fields[2] || null };
}

export function parseLegacyBhistObservation(output: string): SchedulerObservation {
  const header = output.match(/Job\s+<(\d+)>,\s+Job Name\s+<([^>]+)>/i);
  let status = 'UNKWN';
  if (/Done successfully\./i.test(output)) status = 'DONE';
  else if (/Exited(?:\s+with\s+exit\s+code|\.)|Terminated|Completed\s+<exit>/i.test(output)) status = 'EXIT';
  else if (/ZOMBI/i.test(output)) status = 'ZOMBI';
  return { jobId: header?.[1] ?? null, status, jobName: header?.[2] ?? null };
}

export function parseHistoryJobMatches(output: string, expectedJobName: string): string[] {
  const ids = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (/^\d+$/.test(fields[0] ?? '') && fields[2] === expectedJobName) ids.add(fields[0]);
  }
  for (const match of output.matchAll(/Job\s+<(\d+)>,\s+Job Name\s+<([^>]+)>/gi)) {
    if (match[2] === expectedJobName) ids.add(match[1]);
  }
  return [...ids];
}
