import { normalizeSeverity, parseSemgrepOutput } from './parse.js';
import { computeDeepVerdict, needsMindInvestigation } from './score.js';

export function semgrepSelfCheck(): void {
  const sample = {
    version: '1.0.0',
    results: [
      {
        check_id: 'javascript.lang.security.audit.eval-detected',
        path: 'lib/core.js',
        start: { line: 10, col: 3 },
        end: { line: 10, col: 20 },
        extra: { message: 'eval detected', severity: 'ERROR' },
      },
    ],
    errors: [],
  };

  const parsed = parseSemgrepOutput(sample);
  if (parsed.findings.length !== 1 || parsed.findings[0]?.severity !== 'high') {
    throw new Error('parseSemgrepOutput self-check failed');
  }
  if (normalizeSeverity('CRITICAL') !== 'critical') {
    throw new Error('normalizeSeverity self-check failed');
  }

  const deep = computeDeepVerdict(
    { verdict: 'allow', score: 85, reasons: [], scoring_version: 'guard-score-v0.1' },
    parsed.findings,
  );
  if (deep.verdict !== 'block' || deep.scoring_version !== 'guard-score-v0.2') {
    throw new Error('computeDeepVerdict self-check failed');
  }
  if (!needsMindInvestigation(parsed.findings)) {
    throw new Error('needsMindInvestigation self-check failed');
  }
  console.log('ok semgrep self-check');
}
