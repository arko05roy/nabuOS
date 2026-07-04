/** Package ecosystems supported by nabu Guard. */
export type Ecosystem = 'npm' | 'pypi';

/** Audit depth tiers from the public Guard API. */
export type AuditDepth = 'fast' | 'deep' | 'sandbox';

export type AuditStatus = 'pending' | 'running' | 'completed' | 'failed';

export type Verdict = 'allow' | 'warn' | 'block';

export interface AuditArtifact {
  url: string;
  sha256: string;
  integrity_verified: boolean;
}

/** guard-score-v0.1 and successors; score is deterministic + BTL triage. */
export interface AuditVerdict {
  verdict: Verdict;
  score: number;
  reasons: string[];
  scoring_version?: string;
}

export type AuditPhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'degraded'
  | 'skipped';

export interface AuditPhase {
  name: string;
  status: AuditPhaseStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

/** POST /v1/guard/audits request body. */
export interface CreateAuditRequest {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  depth: AuditDepth;
}

/** GET /v1/guard/check response when a completed audit exists. */
export interface GuardCheckHit {
  status: 'completed';
  audit_id: string;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  artifact?: AuditArtifact;
  fast_verdict: AuditVerdict;
  updated_at: string;
}

/** GET /v1/guard/check when no cached verdict exists. */
export interface GuardCheckMiss {
  status: 'not_found';
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export type GuardCheckResponse = GuardCheckHit | GuardCheckMiss;

/** Guard audit job persisted and returned by POST/GET /v1/guard/audits. */
export interface AuditJob {
  audit_id: string;
  status: AuditStatus;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  depth: AuditDepth;
  artifact?: AuditArtifact;
  fast_verdict?: AuditVerdict | null;
  deep_verdict?: AuditVerdict | null;
  phases: AuditPhase[];
  created_at: string;
  updated_at: string;
}

export type MindMode = 'brief' | 'deep' | 'policy' | 'incident';

export type MindStatus = 'pending' | 'running' | 'completed' | 'failed';

export type MindDecision =
  | 'allow'
  | 'deny'
  | 'use_with_constraints'
  | 'investigate';

export interface MindContextRef {
  type: string;
  id: string;
}

export interface MindEvidence {
  type: string;
  ref: string;
  summary: string;
}

export interface BtlRuntimeUsage {
  request_ids: string[];
  total_charge: number;
  total_saved: number;
}

/** Per-request economics from BTL response headers (x-btl-*). */
export interface BtlResponseHeaders {
  request_id?: string;
  cache_tier?: string;
  benchmark_cost?: number;
  customer_charge?: number;
  saved?: number;
}

export interface BtlChatCompletionResult {
  content: string | null;
  model: string;
  headers: BtlResponseHeaders;
  raw: unknown;
}

/** Apollo decision kernel run returned by POST/GET /v1/mind/runs. */
export interface MindRun {
  mind_run_id: string;
  status: MindStatus;
  goal: string;
  mode: MindMode;
  context_refs?: MindContextRef[];
  decision?: MindDecision;
  confidence?: number;
  summary?: string;
  evidence: MindEvidence[];
  bt_runtime: BtlRuntimeUsage;
  created_at: string;
  updated_at: string;
}

export interface SecretPolicy {
  allowed_agent_ids?: string[];
  allowed_tools?: string[];
  allowed_destinations?: string[];
  max_reads?: number;
  expires_at?: string;
}

/** Opaque secret handle; raw values never appear on public API after creation. */
export interface SecretRef {
  secret_id: string;
  project_id: string;
  name: string;
  handle: string;
  policy: SecretPolicy;
  created_at: string;
  updated_at: string;
}

export interface AgentSkill {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export interface AgentPolicy {
  guard_min_score: number;
  allow_warn: boolean;
}

export type AgentDeploymentStatus =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

/** Synapze-style agent deployment from POST /v1/run/agents. */
export interface AgentDeployment {
  deployment_id: string;
  agent_id: string;
  name: string;
  template: string;
  skills: AgentSkill[];
  secrets: string[];
  policy: AgentPolicy;
  status: AgentDeploymentStatus;
  created_at: string;
  updated_at: string;
}

export interface ReadinessCheck {
  ready: boolean;
  checks: Record<string, 'ok' | 'fail' | 'unknown'>;
  message?: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  uptime_seconds: number;
}
