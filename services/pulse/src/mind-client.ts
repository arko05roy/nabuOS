import type { MindRun } from '@nabuos/types';

function mindBase(): string {
  return (process.env.MIND_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, '');
}

export async function runMindComparison(input: {
  ecosystem: string;
  name: string;
  previousVersion: string;
  newVersion: string;
  previousAuditId: string;
  newAuditId: string;
}): Promise<{ mind_run_id: string; summary?: string }> {
  const goal =
    `Should we upgrade ${input.name} from ${input.previousVersion} to ${input.newVersion} (${input.ecosystem})? ` +
    `Compare Guard audit evidence and cite concrete risk changes.`;

  const createRes = await fetch(`${mindBase()}/v1/mind/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `pulse-mind:${input.previousAuditId}:${input.newAuditId}`,
    },
    body: JSON.stringify({
      goal,
      mode: 'brief',
      context_refs: [
        { type: 'guard_audit', id: input.previousAuditId },
        { type: 'guard_audit', id: input.newAuditId },
      ],
    }),
  });

  const run = (await createRes.json()) as MindRun;
  if (!createRes.ok || !run.mind_run_id) {
    throw new Error(`mind run create failed: ${createRes.status}`);
  }

  const deadline = Date.now() + 180_000;
  let current = run;
  while (current.status === 'pending' || current.status === 'running') {
    if (Date.now() > deadline) throw new Error('mind run timeout');
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${mindBase()}/v1/mind/runs/${run.mind_run_id}`);
    current = (await poll.json()) as MindRun;
  }

  if (current.status !== 'completed') {
    throw new Error(`mind run ${current.status}`);
  }

  return { mind_run_id: current.mind_run_id, summary: current.summary };
}
