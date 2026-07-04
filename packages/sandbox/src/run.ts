import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { SandboxImage, SandboxRun } from '@nabuos/types';
import { SandboxError } from './errors.js';
import { dockerBin, sandboxNodeImage, sandboxPythonImage, sandboxRuntime } from './runtime.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MEMORY_MB = 512;
const DEFAULT_CPUS = 1;

function artifactRoot(): string {
  return resolve(process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts'));
}

/** Only paths under NABU_ARTIFACT_DIR may be mounted into sandboxes. */
export function assertAllowedExtractDir(extractDir: string): string {
  const root = artifactRoot();
  const abs = resolve(extractDir);
  if (!abs.startsWith(root + '/') && abs !== root) {
    throw new SandboxError(
      `extract_dir must be under ${root}`,
      'invalid_extract_dir',
    );
  }
  return abs;
}

function imageRef(image: SandboxImage): string {
  return image === 'python' ? sandboxPythonImage() : sandboxNodeImage();
}

function networkProbeCommand(image: SandboxImage): string[] {
  if (image === 'python') {
    return [
      'python',
      '-c',
      "import urllib.request\nurllib.request.urlopen('http://example.com', timeout=2)",
    ];
  }
  return [
    'node',
    '-e',
    "require('net').connect(80,'example.com').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1)).setTimeout(2000,()=>process.exit(1))",
  ];
}

async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

export interface ExecuteSandboxOptions {
  run_id: string;
  extract_dir: string;
  image: SandboxImage;
  command: string[];
  timeout_ms?: number;
  memory_mb?: number;
  cpus?: number;
  artifactRootDir?: string;
}

interface DockerRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

function runDockerSandbox(
  image: string,
  artifactDir: string,
  scratchDir: string,
  command: string[],
  limits: { timeout_ms: number; memory_mb: number; cpus: number },
): Promise<DockerRunResult> {
  const args = [
    'run',
    '--runtime',
    sandboxRuntime(),
    '--network',
    'none',
    '--read-only',
    `--memory=${limits.memory_mb}m`,
    `--cpus=${limits.cpus}`,
    '--pids-limit',
    '64',
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
    '-v',
    `${artifactDir}:/artifact:ro`,
    '-v',
    `${scratchDir}:/scratch:rw`,
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--init',
    '--rm',
    image,
    ...command,
  ];

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(dockerBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, limits.timeout_ms);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new SandboxError('docker CLI not found on PATH', 'docker_missing'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}

/** Run command in gVisor with network disabled and hardened mounts (Epic 4.2). */
export async function executeSandboxRun(options: ExecuteSandboxOptions): Promise<SandboxRun> {
  const artifactDir = assertAllowedExtractDir(options.extract_dir);
  const root = options.artifactRootDir ?? artifactRoot();
  const outDir = join(root, 'sandbox', options.run_id);
  const scratchDir = join(outDir, 'scratch');
  await mkdir(scratchDir, { recursive: true });

  const limits = {
    timeout_ms: options.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    memory_mb: options.memory_mb ?? DEFAULT_MEMORY_MB,
    cpus: options.cpus ?? DEFAULT_CPUS,
  };
  const image = imageRef(options.image);
  const existing = await loadSandboxRun(options.run_id, root);
  const ts = new Date().toISOString();

  const base: SandboxRun = {
    run_id: options.run_id,
    status: 'running',
    runtime: 'runsc',
    network_mode: 'none',
    image,
    command: options.command,
    resource_limits: limits,
    mounts: {
      artifact: { host: artifactDir, container: '/artifact', mode: 'ro' },
      scratch: { host: scratchDir, container: '/scratch', mode: 'rw' },
    },
    stdout: '',
    stderr: '',
    files_written: [],
    network_probe_failed: false,
    raw_log_path: join(outDir, 'run.json'),
    audit_id: existing?.audit_id,
    ecosystem: existing?.ecosystem,
    name: existing?.name,
    version: existing?.version,
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };

  await persistSandboxRun(base);

  const result = await runDockerSandbox(image, artifactDir, scratchDir, options.command, limits);
  base.stdout = result.stdout;
  base.stderr = result.stderr;
  base.duration_ms = result.durationMs;
  base.exit_code = result.exitCode;
  base.updated_at = new Date().toISOString();

  if (result.timedOut) {
    base.status = 'timeout';
    base.error = `execution exceeded ${limits.timeout_ms}ms`;
  } else if (result.exitCode === 0) {
    base.status = 'completed';
  } else {
    base.status = 'failed';
    base.error = `container exited ${result.exitCode}`;
  }

  try {
    base.files_written = await listFilesRecursive(scratchDir);
  } catch {
    base.files_written = [];
  }

  // ponytail: network probe is a second container run; upgrade = single combined probe script
  const probe = await runDockerSandbox(
    image,
    artifactDir,
    scratchDir,
    networkProbeCommand(options.image),
    { ...limits, timeout_ms: Math.min(limits.timeout_ms, 10_000) },
  );
  base.network_probe_failed = probe.exitCode !== 0;

  await writeFile(base.raw_log_path, JSON.stringify(base, null, 2));
  return base;
}

export async function loadSandboxRun(
  runId: string,
  artifactRootDir?: string,
): Promise<SandboxRun | null> {
  const root = artifactRootDir ?? artifactRoot();
  const path = join(root, 'sandbox', runId, 'run.json');
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as SandboxRun;
  } catch {
    return null;
  }
}

export function createSandboxRunId(): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `sbx_${suffix}`;
}

export async function persistSandboxRun(run: SandboxRun, artifactRootDir?: string): Promise<void> {
  const root = artifactRootDir ?? artifactRoot();
  const outDir = join(root, 'sandbox', run.run_id);
  await mkdir(outDir, { recursive: true });
  const path = run.raw_log_path || join(outDir, 'run.json');
  run.raw_log_path = path;
  await writeFile(path, JSON.stringify(run, null, 2));
}
