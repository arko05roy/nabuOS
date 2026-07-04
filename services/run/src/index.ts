import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createServiceApp } from '@nabuos/service-kit';
import type { AgentDeployment, AgentJob, CreateAgentDeploymentRequest } from '@nabuos/types';
import {
  bindDeploymentIdempotencyKey,
  createAgentId,
  createDeploymentId,
  createJobId,
  findDeploymentByIdempotencyKey,
  loadDeployment,
  loadJob,
  saveAgent,
  saveDeployment,
  saveJob,
} from './deployment-store.js';
import { runAgentJob, runDependenciesReady, runDeployEngine } from './deploy-engine.js';

const port = Number(process.env.PORT ?? 3004);

const health = createServiceApp('run', async () => {
  const { ready, checks } = await runDependenciesReady();
  return {
    ready,
    checks,
    message: ready ? undefined : 'guard and vault must be reachable',
  };
});

const app = new Hono();
app.route('/', health);

const inflightDeployments = new Set<string>();
const inflightJobs = new Set<string>();

function parseDeploy(body: unknown): CreateAgentDeploymentRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const name = b.name;
  const template = b.template;
  const skills = b.skills;
  const secrets = b.secrets;
  const policy = b.policy;

  if (typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  if (typeof template !== 'string' || !template.trim()) return { error: 'template is required' };
  if (!Array.isArray(skills) || skills.length === 0) return { error: 'skills required' };
  if (!Array.isArray(secrets)) return { error: 'secrets must be an array' };
  if (!policy || typeof policy !== 'object') return { error: 'policy is required' };

  const parsedSkills = skills
    .filter((s): s is { ecosystem: string; name: string; version: string } => {
      return !!s && typeof s === 'object';
    })
    .map((s) => ({
      ecosystem: s.ecosystem as 'npm' | 'pypi',
      name: String(s.name ?? ''),
      version: String(s.version ?? ''),
    }))
    .filter((s) => (s.ecosystem === 'npm' || s.ecosystem === 'pypi') && s.name && s.version);

  if (parsedSkills.length !== skills.length) {
    return { error: 'each skill needs ecosystem (npm|pypi), name, version' };
  }

  const p = policy as Record<string, unknown>;
  if (typeof p.guard_min_score !== 'number') {
    return { error: 'policy.guard_min_score must be a number' };
  }
  if (typeof p.allow_warn !== 'boolean') {
    return { error: 'policy.allow_warn must be a boolean' };
  }

  return {
    name: name.trim(),
    template: template.trim(),
    skills: parsedSkills,
    secrets: secrets.map(String),
    policy: { guard_min_score: p.guard_min_score, allow_warn: p.allow_warn },
  };
}

function scheduleDeployment(dep: AgentDeployment): void {
  inflightDeployments.add(dep.deployment_id);
  void runDeployEngine(dep).finally(() => {
    inflightDeployments.delete(dep.deployment_id);
  });
}

function scheduleJob(job: AgentJob, secretHandle: string): void {
  inflightJobs.add(job.job_id);
  void (async () => {
    job.status = 'running';
    await saveJob(job);
    try {
      const result = await runAgentJob({
        agent_id: job.agent_id,
        deployment_id: job.deployment_id,
        goal: job.goal,
        secret_handle: secretHandle,
      });
      job.status = 'completed';
      job.result_summary = result.summary;
      job.btl_request_id = result.btl_request_id;
      job.btl_charge = result.btl_charge;
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    }
    await saveJob(job);
  })().finally(() => {
    inflightJobs.delete(job.job_id);
  });
}

app.post('/v1/run/agents', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseDeploy(body);
  if ('error' in parsed) return c.json({ error: 'invalid_request', message: parsed.error }, 400);

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (idempotencyKey) {
    const existing = await findDeploymentByIdempotencyKey(idempotencyKey);
    if (existing) return c.json(existing, existing.status === 'running' ? 200 : 202);
  }

  const ts = new Date().toISOString();
  const agentId = createAgentId();
  const dep: AgentDeployment = {
    deployment_id: createDeploymentId(),
    agent_id: agentId,
    name: parsed.name,
    template: parsed.template,
    skills: parsed.skills,
    secrets: parsed.secrets,
    policy: parsed.policy,
    status: 'pending',
    created_at: ts,
    updated_at: ts,
  };

  await saveAgent({
    agent_id: agentId,
    name: parsed.name,
    template: parsed.template,
    created_at: ts,
  });
  if (idempotencyKey) await bindDeploymentIdempotencyKey(idempotencyKey, dep.deployment_id);
  await saveDeployment(dep);
  scheduleDeployment(dep);

  return c.json(dep, 202);
});

app.get('/v1/run/agents/:deployment_id', async (c) => {
  const deploymentId = c.req.param('deployment_id');
  const dep = await loadDeployment(deploymentId);
  if (!dep) return c.json({ error: 'deployment_not_found' }, 404);
  return c.json(dep);
});

app.post('/v1/run/agents/:agent_id/jobs', async (c) => {
  const agentId = c.req.param('agent_id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_request' }, 400);
  const b = body as Record<string, unknown>;
  const goal = typeof b.goal === 'string' ? b.goal.trim() : '';
  const deployment_id = typeof b.deployment_id === 'string' ? b.deployment_id : '';
  if (!goal) return c.json({ error: 'goal is required' }, 400);
  if (!deployment_id) return c.json({ error: 'deployment_id is required' }, 400);

  const dep = await loadDeployment(deployment_id);
  if (!dep || dep.agent_id !== agentId) {
    return c.json({ error: 'deployment_not_found' }, 404);
  }
  if (dep.status !== 'running') {
    return c.json(
      { error: 'deployment_not_running', message: `status=${dep.status}` },
      409,
    );
  }
  if (!dep.secrets.length) {
    return c.json({ error: 'no_secrets_bound', message: 'deployment has no secret handles' }, 400);
  }

  const ts = new Date().toISOString();
  const job: AgentJob = {
    job_id: createJobId(),
    agent_id: agentId,
    deployment_id,
    status: 'pending',
    goal,
    created_at: ts,
    updated_at: ts,
  };
  await saveJob(job);
  scheduleJob(job, dep.secrets[0]!);

  return c.json(job, 202);
});

app.get('/v1/run/jobs/:job_id', async (c) => {
  const jobId = c.req.param('job_id');
  const job = await loadJob(jobId);
  if (!job) return c.json({ error: 'job_not_found' }, 404);
  return c.json(job);
});

const server = serve({ fetch: app.fetch, port });
console.log(`run listening on :${port}`);

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });
});
