import type { NpmInventory } from '@nabuos/npm-artifact';
import type { PypiInventory } from '@nabuos/pypi-artifact';

const NPM_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;

/** Shell to copy artifact into scratch and run npm lifecycle scripts (no registry fetch). */
export function buildNpmLifecycleShell(scripts: Record<string, string>): string {
  const active = NPM_LIFECYCLE_SCRIPTS.filter((s) => scripts[s]);
  if (active.length === 0) {
    return [
      'set -e',
      'cp -a /artifact/. /scratch/workspace/',
      'cd /scratch/workspace',
      'test -f package.json',
      'echo "no install lifecycle scripts"',
    ].join('\n');
  }

  const runScript = active
    .map(
      (s) =>
        `echo "=== ${s} ===" && node -e "const {spawnSync}=require('child_process');` +
        `const cmd=require('./package.json').scripts['${s}'];` +
        `const r=spawnSync('sh',['-c',cmd],{stdio:'inherit',cwd:process.cwd()});` +
        `process.exit(r.status??1)"`,
    )
    .join(' && ');

  return ['set -e', 'cp -a /artifact/. /scratch/workspace/', 'cd /scratch/workspace', runScript].join(
    '\n',
  );
}

export function buildNpmLifecycleCommand(inventory: Pick<NpmInventory, 'scripts'>): string[] {
  return ['sh', '-c', buildNpmLifecycleShell(inventory.scripts)];
}

export function buildPypiSandboxShell(inventory: Pick<PypiInventory, 'metadata_source' | 'files'>): string {
  const hasInstallable =
    inventory.metadata_source === 'setup.py' ||
    inventory.metadata_source === 'pyproject.toml' ||
    inventory.metadata_source === 'setup.cfg' ||
    inventory.files.paths.some((p) => /(^|\/)setup\.py$/.test(p) || /(^|\/)pyproject\.toml$/.test(p));

  if (!hasInstallable) {
    return [
      'set -e',
      'cp -a /artifact/. /scratch/workspace/',
      'cd /scratch/workspace',
      'python -m compileall -q .',
      'echo "wheel import compile check complete"',
    ].join('\n');
  }

  return [
    'set -e',
    'cp -a /artifact/. /scratch/workspace/',
    'cd /scratch/workspace',
    'pip install --no-deps --no-index --no-build-isolation --target /scratch/site-packages .',
  ].join('\n');
}

export function buildPypiSandboxCommand(
  inventory: Pick<PypiInventory, 'metadata_source' | 'files'>,
): string[] {
  return ['sh', '-c', buildPypiSandboxShell(inventory)];
}
