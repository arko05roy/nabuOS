import { probeSandboxRuntime } from './runtime.js';
import { buildNpmLifecycleCommand, buildPypiSandboxCommand } from './lifecycle.js';

/** Assert lifecycle command builders (no Docker). */
export function lifecycleSelfCheck(): void {
  const npmCmd = buildNpmLifecycleCommand({ scripts: { postinstall: 'echo hi' } });
  if (!npmCmd[0] || npmCmd[0] !== 'sh') {
    throw new Error('npm lifecycle command must use sh -c');
  }
  const noScripts = buildNpmLifecycleCommand({ scripts: {} });
  if (!noScripts[2]?.includes('no install lifecycle')) {
    throw new Error('npm lifecycle must handle empty scripts');
  }
  const pypiCmd = buildPypiSandboxCommand({
    metadata_source: 'METADATA',
    files: { paths: ['pkg/__init__.py'], count: 1, total_bytes: 1, extensions: {} },
  });
  if (!pypiCmd[0]) throw new Error('pypi sandbox command missing');
  const pypiInstall = buildPypiSandboxCommand({
    metadata_source: 'setup.py',
    files: { paths: ['setup.py'], count: 1, total_bytes: 1, extensions: {} },
  });
  if (!pypiInstall[2]?.includes('pip install')) {
    throw new Error('pypi sandbox must pip install when setup.py present');
  }
}

/** Fails if Docker or runsc runtime is not ready. */
export async function sandboxSelfCheck(): Promise<void> {
  lifecycleSelfCheck();
  const probe = await probeSandboxRuntime();
  if (!probe.ready) {
    throw new Error(probe.message ?? `sandbox runtime not ready: ${JSON.stringify(probe.checks)}`);
  }
}
