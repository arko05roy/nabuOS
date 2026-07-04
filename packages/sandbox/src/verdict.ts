import type { AuditVerdict, SandboxAuditRun, SandboxRun, Verdict } from '@nabuos/types';

const STDERR_BLOCK_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bcurl\b/i, label: 'curl in sandbox stderr' },
  { re: /\bwget\b/i, label: 'wget in sandbox stderr' },
  { re: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i, label: 'network connection attempt in stderr' },
  { re: /\/etc\/passwd|\/etc\/shadow/i, label: 'credential path access in stderr' },
  { re: /\b(eval|exec)\s*\(/i, label: 'dynamic code execution in stderr' },
];

export function extractHardBlockSignals(run: SandboxRun): string[] {
  const signals: string[] = [];
  if (!run.network_probe_failed) {
    signals.push('sandbox network isolation failed (external probe succeeded)');
  }
  if (run.status === 'timeout') {
    signals.push('sandbox execution timed out');
  }
  const haystack = `${run.stdout}\n${run.stderr}`;
  for (const { re, label } of STDERR_BLOCK_PATTERNS) {
    if (re.test(haystack)) signals.push(label);
  }
  return signals;
}

export function extractProcessHints(stdout: string, stderr: string): string[] {
  const hints: string[] = [];
  const lines = `${stdout}\n${stderr}`.split('\n');
  for (const line of lines) {
    if (/spawn|child process|fork/i.test(line)) {
      hints.push(line.trim().slice(0, 200));
    }
  }
  return hints.slice(0, 20);
}

export function sandboxRunToAuditEvidence(
  run: SandboxRun,
  phase: SandboxAuditRun['phase'],
): SandboxAuditRun {
  const hard_block_signals = extractHardBlockSignals(run);
  return {
    run_id: run.audit_id ? `sbx_audit_${run.run_id}` : run.run_id,
    sandbox_run_id: run.run_id,
    phase,
    status: run.status,
    exit_code: run.exit_code,
    stdout: run.stdout,
    stderr: run.stderr,
    duration_ms: run.duration_ms,
    files_written: run.files_written,
    network_isolated: run.network_probe_failed,
    hard_block_signals,
    process_hints: extractProcessHints(run.stdout, run.stderr),
    raw_path: run.raw_log_path,
  };
}

/** guard-score-v0.3 — fold real sandbox signals into deep/fast verdict. */
export function computeSandboxVerdict(
  prior: AuditVerdict,
  sandbox: SandboxAuditRun,
): AuditVerdict {
  let score = prior.score;
  const reasons = [...prior.reasons];

  if (sandbox.hard_block_signals.length > 0) {
    for (const signal of sandbox.hard_block_signals) {
      reasons.push(`sandbox hard-block: ${signal}`);
      score -= 25;
    }
  }

  if (sandbox.status === 'failed' && sandbox.exit_code !== 0) {
    reasons.push(`sandbox phase exited ${sandbox.exit_code}`);
    score -= 10;
  } else if (sandbox.status === 'timeout') {
    reasons.push('sandbox phase timed out');
    score -= 15;
  }

  if (!sandbox.network_isolated) {
    score = Math.min(score, 40);
  }

  score = Math.max(0, Math.min(100, score));

  let verdict: Verdict;
  if (sandbox.hard_block_signals.length > 0 || !sandbox.network_isolated || score < 50) {
    verdict = 'block';
  } else if (score < 80 || sandbox.status === 'failed' || sandbox.status === 'timeout') {
    verdict = 'warn';
  } else {
    verdict = 'allow';
  }

  return {
    verdict,
    score,
    reasons,
    scoring_version: 'guard-score-v0.3',
  };
}

export function needsSandboxMindInvestigation(sandbox: SandboxAuditRun): boolean {
  return sandbox.hard_block_signals.length > 0 || !sandbox.network_isolated;
}
