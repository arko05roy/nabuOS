import {
  fileMatchesVersion,
  isYanked,
  normalizePackageName,
} from './index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function selfCheck(): void {
  assert(normalizePackageName('Django') === 'django', 'Django → django');
  assert(normalizePackageName('foo_bar.baz') === 'foo-bar-baz', 'PEP 503 separators');
  assert(
    fileMatchesVersion('requests-2.31.0-py3-none-any.whl', '2.31.0'),
    'wheel version match',
  );
  assert(fileMatchesVersion('requests-2.31.0.tar.gz', '2.31.0'), 'sdist version match');
  assert(!fileMatchesVersion('requests-2.30.0.tar.gz', '2.31.0'), 'reject other version');
  assert(isYanked(false) === false, 'not yanked');
  assert(isYanked('broken release') === true, 'yanked with reason');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  selfCheck();
  console.log('ok pypi-registry self-check');
}
