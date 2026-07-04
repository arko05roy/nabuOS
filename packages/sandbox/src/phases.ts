import type { NpmInventory } from '@nabuos/npm-artifact';
import type { PypiInventory } from '@nabuos/pypi-artifact';
import type { SandboxAuditRun } from '@nabuos/types';
import { buildNpmLifecycleCommand, buildPypiSandboxCommand } from './lifecycle.js';
import { createSandboxRunId, executeSandboxRun } from './run.js';
import { sandboxRunToAuditEvidence } from './verdict.js';

export interface RunNpmLifecycleOptions {
  extract_dir: string;
  inventory: Pick<NpmInventory, 'scripts'>;
  audit_id?: string;
  name?: string;
  version?: string;
  timeout_ms?: number;
}

export interface RunPypiSandboxOptions {
  extract_dir: string;
  inventory: Pick<PypiInventory, 'metadata_source' | 'files'>;
  audit_id?: string;
  name?: string;
  version?: string;
  timeout_ms?: number;
}

/** Epic 4.3 — run npm install lifecycle scripts inside gVisor. */
export async function runNpmLifecycleSandbox(
  options: RunNpmLifecycleOptions,
): Promise<SandboxAuditRun> {
  const runId = createSandboxRunId();
  const run = await executeSandboxRun({
    run_id: runId,
    extract_dir: options.extract_dir,
    image: 'node',
    command: buildNpmLifecycleCommand(options.inventory),
    timeout_ms: options.timeout_ms ?? 180_000,
    memory_mb: 768,
    cpus: 1,
  });
  run.audit_id = options.audit_id;
  run.ecosystem = 'npm';
  run.name = options.name;
  run.version = options.version;
  return sandboxRunToAuditEvidence(run, 'npm_lifecycle');
}

/** Epic 4.4 — safe PyPI install/compile inside gVisor (setup.py never on host). */
export async function runPypiInstallSandbox(
  options: RunPypiSandboxOptions,
): Promise<SandboxAuditRun> {
  const runId = createSandboxRunId();
  const run = await executeSandboxRun({
    run_id: runId,
    extract_dir: options.extract_dir,
    image: 'python',
    command: buildPypiSandboxCommand(options.inventory),
    timeout_ms: options.timeout_ms ?? 180_000,
    memory_mb: 768,
    cpus: 1,
  });
  run.audit_id = options.audit_id;
  run.ecosystem = 'pypi';
  run.name = options.name;
  run.version = options.version;
  return sandboxRunToAuditEvidence(run, 'pypi_install');
}
