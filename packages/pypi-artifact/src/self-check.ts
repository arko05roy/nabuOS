import { createHash } from 'node:crypto';
import { selectPypiArtifact } from './select.js';
import { verifySha256 } from './integrity.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function selfCheck(): void {
  const data = Buffer.from('nabu-pypi-artifact-self-check');
  const digest = createHash('sha256').update(data).digest('hex');
  assert(verifySha256(data, digest).ok, 'sha256 verify ok');
  assert(!verifySha256(data, '00'.repeat(32)).ok, 'sha256 reject tamper');

  const chosen = selectPypiArtifact([
    {
      filename: 'pkg-1.0.0.tar.gz',
      url: 'https://files.pythonhosted.org/x/pkg-1.0.0.tar.gz',
      digests: { sha256: 'a' },
      packagetype: 'sdist',
      python_version: 'source',
      size: 1,
      yanked: false,
    },
    {
      filename: 'pkg-1.0.0-py3-none-any.whl',
      url: 'https://files.pythonhosted.org/x/pkg-1.0.0-py3-none-any.whl',
      digests: { sha256: 'b' },
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      size: 1,
      yanked: false,
    },
  ]);
  assert(chosen.packagetype === 'bdist_wheel', 'prefer wheel');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  selfCheck();
  console.log('ok pypi-artifact self-check');
}
