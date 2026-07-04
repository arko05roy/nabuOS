import type { SemgrepFinding, SemgrepSeverity } from '@nabuos/types';

interface CliMatch {
  check_id: string;
  path: string;
  start: { line: number; col?: number };
  end: { line: number; col?: number };
  extra?: {
    message?: string;
    severity?: string;
    metadata?: Record<string, unknown>;
  };
}

interface CliOutput {
  version?: string;
  results?: CliMatch[];
  errors?: Array<{ message?: string }>;
}

const SEVERITY_MAP: Record<string, SemgrepSeverity> = {
  CRITICAL: 'critical',
  ERROR: 'high',
  HIGH: 'high',
  WARNING: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
  EXPERIMENT: 'info',
  INVENTORY: 'info',
};

export function normalizeSeverity(raw?: string): SemgrepSeverity {
  if (!raw) return 'medium';
  const key = raw.toUpperCase();
  return SEVERITY_MAP[key] ?? 'medium';
}

export function parseSemgrepOutput(raw: unknown): {
  findings: SemgrepFinding[];
  semgrep_version?: string;
  errors: string[];
} {
  const doc = raw as CliOutput;
  const errors = (doc.errors ?? [])
    .map((e) => e.message)
    .filter((m): m is string => typeof m === 'string' && m.length > 0);

  const findings: SemgrepFinding[] = [];
  for (const match of doc.results ?? []) {
    if (!match.check_id || !match.path) continue;
    findings.push({
      rule_id: match.check_id,
      severity: normalizeSeverity(match.extra?.severity),
      path: match.path,
      start_line: match.start?.line ?? 0,
      end_line: match.end?.line ?? match.start?.line ?? 0,
      message: match.extra?.message ?? match.check_id,
      metadata: match.extra?.metadata,
    });
  }

  return { findings, semgrep_version: doc.version, errors };
}
