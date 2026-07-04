import type { AuditVerdict, SemgrepFinding, Verdict } from '@nabuos/types';

const HARD_BLOCK_RULE_PATTERNS = [
  /eval/,
  /exec/,
  /shell/,
  /subprocess/,
  /exfiltrat/,
  /credential/,
  /secret/,
  /postinstall/,
  /preinstall/,
];

function isHardBlockFinding(f: SemgrepFinding): boolean {
  if (f.severity !== 'critical' && f.severity !== 'high') return false;
  const haystack = `${f.rule_id} ${f.message}`.toLowerCase();
  return HARD_BLOCK_RULE_PATTERNS.some((re) => re.test(haystack));
}

function severityPenalty(severity: SemgrepFinding['severity']): number {
  switch (severity) {
    case 'critical':
      return 20;
    case 'high':
      return 10;
    case 'medium':
      return 5;
    case 'low':
      return 2;
    default:
      return 0;
  }
}

/** Combine fast audit verdict with real Semgrep findings (guard-score-v0.2). */
export function computeDeepVerdict(
  fastVerdict: AuditVerdict,
  findings: SemgrepFinding[],
): AuditVerdict {
  let score = fastVerdict.score;
  const reasons = [...fastVerdict.reasons];
  const hardBlocks = findings.filter(isHardBlockFinding);

  for (const f of findings) {
    const penalty = severityPenalty(f.severity);
    if (penalty > 0) {
      score -= penalty;
      reasons.push(`semgrep ${f.severity}: ${f.message} (${f.path}:${f.start_line}, ${f.rule_id})`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  let verdict: Verdict;
  if (hardBlocks.length > 0 || score < 50) {
    verdict = 'block';
  } else if (score < 80) {
    verdict = 'warn';
  } else {
    verdict = 'allow';
  }

  return {
    verdict,
    score,
    reasons,
    scoring_version: 'guard-score-v0.2',
  };
}

/** Epic 3.3 — auto-Mind when critical/high static findings exist. */
export function needsMindInvestigation(findings: SemgrepFinding[]): boolean {
  return findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high' || isHardBlockFinding(f),
  );
}
