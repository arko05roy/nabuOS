import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { SemgrepRun } from '@nabuos/types';
import { parseSemgrepOutput } from './parse.js';

export class SemgrepError extends Error {
  constructor(
    message: string,
    readonly code: 'semgrep_missing' | 'semgrep_failed' | 'invalid_json',
  ) {
    super(message);
    this.name = 'SemgrepError';
  }
}

/** Registry rulepacks for JS/TS, Python, secrets, security audit (shell/injection patterns). */
export const DEFAULT_SEMGREP_CONFIGS = [
  'p/javascript',
  'p/typescript',
  'p/python',
  'p/secrets',
  'p/security-audit',
] as const;

function semgrepBin(): string {
  return process.env.SEMGREP_BIN ?? 'semgrep';
}

function runSemgrep(
  extractDir: string,
  outputPath: string,
  configs: readonly string[],
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  const args = [
    'scan',
    '--metrics=off',
    '--no-git-ignore',
    ...configs.flatMap((c) => ['--config', c]),
    '--json',
    `--json-output=${outputPath}`,
    extractDir,
  ];

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(semgrepBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new SemgrepError('semgrep CLI not found on PATH', 'semgrep_missing'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        durationMs: Date.now() - started,
      });
    });
  });
}

export interface ScanSemgrepOptions {
  auditId: string;
  extractDir: string;
  configs?: readonly string[];
  artifactRoot?: string;
}

/** Run real Semgrep scan against extracted package source; persist raw JSON. */
export async function scanSemgrep(options: ScanSemgrepOptions): Promise<SemgrepRun> {
  const configs = options.configs ?? DEFAULT_SEMGREP_CONFIGS;
  const root = options.artifactRoot ?? process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
  const outDir = join(root, 'semgrep', options.auditId);
  await mkdir(outDir, { recursive: true });
  const rawPath = join(outDir, 'semgrep.json');

  const result = await runSemgrep(options.extractDir, rawPath, configs);

  // ponytail: semgrep exits 0 when scan completes even with findings; non-zero = CLI failure
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new SemgrepError(
      `semgrep exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
      'semgrep_failed',
    );
  }

  let raw: unknown;
  try {
    const { readFile } = await import('node:fs/promises');
    raw = JSON.parse(await readFile(rawPath, 'utf8'));
  } catch {
    throw new SemgrepError('semgrep JSON output missing or invalid', 'invalid_json');
  }

  const parsed = parseSemgrepOutput(raw);
  const scanned = (raw as { paths?: { scanned?: string[] } }).paths?.scanned?.length ?? 0;
  if (scanned === 0) {
    throw new SemgrepError('semgrep scanned zero files (check extract_dir)', 'semgrep_failed');
  }
  if (parsed.errors.length > 0 && parsed.findings.length === 0) {
    throw new SemgrepError(`semgrep errors: ${parsed.errors.join('; ')}`, 'semgrep_failed');
  }

  await writeFile(rawPath, JSON.stringify(raw, null, 2));

  return {
    configs: [...configs],
    finding_count: parsed.findings.length,
    findings: parsed.findings,
    raw_path: rawPath,
    scan_duration_ms: result.durationMs,
    semgrep_version: parsed.semgrep_version,
  };
}
