import { spawn } from 'node:child_process';
import type { ReadinessCheck } from '@nabuos/types';
import { SandboxError } from './errors.js';

function dockerBin(): string {
  return process.env.DOCKER_BIN ?? 'docker';
}

function sandboxRuntime(): string {
  return process.env.SANDBOX_RUNTIME ?? 'runsc';
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SandboxError(`${cmd} timed out after ${timeoutMs}ms`, 'timeout'));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new SandboxError(`${cmd} not found on PATH`, 'docker_missing'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/** Probe Docker daemon and runsc runtime registration (Epic 4.1). */
export async function probeSandboxRuntime(): Promise<ReadinessCheck> {
  const checks: Record<string, 'ok' | 'fail' | 'unknown'> = {
    docker: 'unknown',
    runsc: 'unknown',
  };

  try {
    const version = await runCommand(dockerBin(), ['version', '--format', '{{.Server.Version}}']);
    checks.docker = version.exitCode === 0 && version.stdout.trim() ? 'ok' : 'fail';
  } catch (err) {
    checks.docker = 'fail';
    return {
      ready: false,
      checks,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const info = await runCommand(dockerBin(), ['info', '--format', '{{json .Runtimes}}']);
    if (info.exitCode !== 0) {
      checks.runsc = 'fail';
      return {
        ready: false,
        checks,
        message: `docker info failed: ${info.stderr.slice(0, 200)}`,
      };
    }
    const runtimes = JSON.parse(info.stdout) as Record<string, unknown>;
    const runtime = sandboxRuntime();
    checks.runsc = runtime in runtimes ? 'ok' : 'fail';
  } catch (err) {
    checks.runsc = 'fail';
    return {
      ready: false,
      checks,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const ready = checks.docker === 'ok' && checks.runsc === 'ok';
  return {
    ready,
    checks,
    message: ready
      ? undefined
      : `sandbox requires Docker + --runtime=${sandboxRuntime()} (see infra/sandbox/README.md)`,
  };
}

export function sandboxNodeImage(): string {
  return process.env.NABU_SANDBOX_NODE_IMAGE ?? 'nabuos/sandbox-node:20';
}

export function sandboxPythonImage(): string {
  return process.env.NABU_SANDBOX_PYTHON_IMAGE ?? 'nabuos/sandbox-python:3.12';
}

export { dockerBin, sandboxRuntime };
