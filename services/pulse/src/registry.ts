import { createNpmRegistryClient } from '@nabuos/npm-registry';
import { createPypiRegistryClient } from '@nabuos/pypi-registry';
import type { Ecosystem } from '@nabuos/types';

const npm = createNpmRegistryClient();
const pypi = createPypiRegistryClient();

export async function fetchLatestVersion(
  ecosystem: Ecosystem,
  name: string,
): Promise<string> {
  if (ecosystem === 'npm') {
    const packument = await npm.getPackument(name);
    const latest = packument['dist-tags']?.latest;
    if (!latest) throw new Error(`npm package ${name} has no latest dist-tag`);
    return latest;
  }
  const project = await pypi.getProject(name);
  if (!project.info.version) throw new Error(`pypi project ${name} has no version`);
  return project.info.version;
}
