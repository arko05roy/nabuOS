import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SecretAccessEvent, SecretAccessOutcome } from '@nabuos/types';

// ponytail: append-only FS audit log until Postgres secret_access_events

function auditRoot(): string {
  const base = process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
  return join(base, 'vault', 'access-events.jsonl');
}

const allowedCounts = new Map<string, number>();

export async function recordAccessEvent(input: {
  handle: string;
  agent_id?: string;
  tool?: string;
  outcome: SecretAccessOutcome;
  reason?: string;
}): Promise<SecretAccessEvent> {
  const event: SecretAccessEvent = {
    event_id: `sae_${randomBytes(8).toString('hex')}`,
    handle: input.handle,
    agent_id: input.agent_id,
    tool: input.tool,
    outcome: input.outcome,
    reason: input.reason,
    at: new Date().toISOString(),
  };

  const path = auditRoot();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');

  if (input.outcome === 'allowed') {
    allowedCounts.set(input.handle, (allowedCounts.get(input.handle) ?? 0) + 1);
  }

  return event;
}

export async function countAllowedReads(handle: string): Promise<number> {
  if (allowedCounts.has(handle)) return allowedCounts.get(handle)!;

  const path = auditRoot();
  let count = 0;
  try {
    const raw = await readFile(path, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as SecretAccessEvent;
      if (event.handle === handle && event.outcome === 'allowed') count += 1;
    }
  } catch {
    return 0;
  }
  allowedCounts.set(handle, count);
  return count;
}

export async function listAccessEvents(limit = 100): Promise<SecretAccessEvent[]> {
  const path = auditRoot();
  try {
    const raw = await readFile(path, 'utf8');
    const events = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as SecretAccessEvent);
    return events.slice(-limit).reverse();
  } catch {
    return [];
  }
}
