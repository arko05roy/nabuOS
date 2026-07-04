export class GuardTriageError extends Error {
  constructor(
    message: string,
    readonly code: 'btl_unconfigured' | 'btl_error' | 'invalid_json',
  ) {
    super(message);
    this.name = 'GuardTriageError';
  }
}

export type TriageVerdict = 'allow' | 'warn' | 'block';
export type TriageNextPhase = 'none' | 'deep' | 'sandbox';

export interface GuardTriageFinding {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  citation: string;
}

export interface GuardTriageResult {
  risk_score: number;
  verdict_recommendation: TriageVerdict;
  findings: GuardTriageFinding[];
  uncertainties: string[];
  required_next_phase: TriageNextPhase;
  scoring_version: 'guard-triage-v0.1';
  btl_runtime: import('@nabuos/types').BtlResponseHeaders & { model: string };
}
