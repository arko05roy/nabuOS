import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent, AgentDeployment, AgentJob } from '@nabuos/types';

// ponytail: local FS until Postgres agents / agent_deployments / agent_jobs

function runRoot(): string {
  const base = process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
  return join(base, 'run');
}

function deploymentPath(deploymentId: string): string {
  return join(runRoot(), 'deployments', `${deploymentId}.json`);
}

function agentPath(agentId: string): string {
  return join(runRoot(), 'agents', `${agentId}.json`);
}

function jobPath(jobId: string): string {
  return join(runRoot(), 'jobs', `${jobId}.json`);
}

function idempotencyPath(key: string): string {
  const safe = Buffer.from(key).toString('base64url');
  return join(runRoot(), 'idempotency', `${safe}.json`);
}

const deploymentMemory = new Map<string, AgentDeployment>();
const agentMemory = new Map<string, Agent>();
const jobMemory = new Map<string, AgentJob>();

export function createDeploymentId(): string {
  return `dep_${randomBytes(12).toString('hex')}`;
}

export function createAgentId(): string {
  return `agent_${randomBytes(12).toString('hex')}`;
}

export function createJobId(): string {
  return `job_${randomBytes(12).toString('hex')}`;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    await access(path);
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function loadDeployment(deploymentId: string): Promise<AgentDeployment | null> {
  const cached = deploymentMemory.get(deploymentId);
  if (cached) return cached;
  const dep = await readJson<AgentDeployment>(deploymentPath(deploymentId));
  if (dep) deploymentMemory.set(deploymentId, dep);
  return dep;
}

export async function saveDeployment(dep: AgentDeployment): Promise<void> {
  dep.updated_at = new Date().toISOString();
  deploymentMemory.set(dep.deployment_id, dep);
  const dir = join(runRoot(), 'deployments');
  await mkdir(dir, { recursive: true });
  await writeFile(deploymentPath(dep.deployment_id), JSON.stringify(dep, null, 2));
}

export async function loadAgent(agentId: string): Promise<Agent | null> {
  const cached = agentMemory.get(agentId);
  if (cached) return cached;
  const agent = await readJson<Agent>(agentPath(agentId));
  if (agent) agentMemory.set(agentId, agent);
  return agent;
}

export async function saveAgent(agent: Agent): Promise<void> {
  agentMemory.set(agent.agent_id, agent);
  const dir = join(runRoot(), 'agents');
  await mkdir(dir, { recursive: true });
  await writeFile(agentPath(agent.agent_id), JSON.stringify(agent, null, 2));
}

export async function loadJob(jobId: string): Promise<AgentJob | null> {
  const cached = jobMemory.get(jobId);
  if (cached) return cached;
  const job = await readJson<AgentJob>(jobPath(jobId));
  if (job) jobMemory.set(jobId, job);
  return job;
}

export async function saveJob(job: AgentJob): Promise<void> {
  job.updated_at = new Date().toISOString();
  jobMemory.set(job.job_id, job);
  const dir = join(runRoot(), 'jobs');
  await mkdir(dir, { recursive: true });
  await writeFile(jobPath(job.job_id), JSON.stringify(job, null, 2));
}

export async function findDeploymentByIdempotencyKey(key: string): Promise<AgentDeployment | null> {
  const ref = await readJson<{ deployment_id: string }>(idempotencyPath(key));
  if (!ref) return null;
  return loadDeployment(ref.deployment_id);
}

export async function bindDeploymentIdempotencyKey(
  key: string,
  deploymentId: string,
): Promise<void> {
  const dir = join(runRoot(), 'idempotency');
  await mkdir(dir, { recursive: true });
  await writeFile(idempotencyPath(key), JSON.stringify({ deployment_id: deploymentId }));
}
