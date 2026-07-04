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
  depth?: AuditDepth;
  artifact?: AuditArtifact;
  fast_verdict: AuditVerdict;
  deep_verdict?: AuditVerdict | null;
  mind_investigation?: MindInvestigation | null;
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

export type SemgrepSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Parsed Semgrep finding linked to an audit job. */
export interface SemgrepFinding {
  rule_id: string;
  severity: SemgrepSeverity;
  path: string;
  start_line: number;
  end_line: number;
  message: string;
  metadata?: Record<string, unknown>;
}

/** Semgrep scan output persisted on deep audits. */
export interface SemgrepRun {
  configs: string[];
  finding_count: number;
  findings: SemgrepFinding[];
  raw_path: string;
  scan_duration_ms: number;
  semgrep_version?: string;
}

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
  semgrep?: SemgrepRun;
  mind_investigation?: MindInvestigation | null;
  phases: AuditPhase[];
  created_at: string;
  updated_at: string;
}

export type MindStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Mind incident run triggered by Guard deep audit (Epic 3.3). */
export interface MindInvestigation {
  mind_run_id: string;
  status: MindStatus | 'skipped';
  triggered_at: string;
  trigger_reason: string;
}

export type MindMode = 'brief' | 'deep' | 'policy' | 'incident';

export type MindStepType = 'plan' | 'gather' | 'critique' | 'decide' | 'report';

export type MindStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MindStep {
  step_id: string;
  type: MindStepType;
  status: MindStepStatus;
  summary?: string;
  evidence_refs: MindEvidence[];
  btl_request_id?: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

/** POST /v1/mind/runs request body. */
export interface CreateMindRunRequest {
  goal: string;
  mode: MindMode;
  context_refs?: MindContextRef[];
}

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
  steps: MindStep[];
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

/** POST /v1/vault/secrets request body. Value is stored once; never returned on API. */
export interface CreateSecretRequest {
  project_id: string;
  name: string;
  value: string;
  policy?: SecretPolicy;
}

export type SecretAccessOutcome = 'allowed' | 'denied' | 'not_found' | 'expired';

/** Vault secret read audit event — no secret values. */
export interface SecretAccessEvent {
  event_id: string;
  handle: string;
  agent_id?: string;
  tool?: string;
  outcome: SecretAccessOutcome;
  reason?: string;
  at: string;
}

export interface GuardSkillCheck {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  audit_id?: string;
  verdict: Verdict;
  score: number;
  passed: boolean;
  reason?: string;
}

/** POST /v1/run/agents request body. */
export interface CreateAgentDeploymentRequest {
  name: string;
  template: string;
  skills: AgentSkill[];
  secrets: string[];
  policy: AgentPolicy;
}

export type AgentJobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Agent job from POST /v1/run/agents/:agent_id/jobs. */
export interface AgentJob {
  job_id: string;
  agent_id: string;
  deployment_id: string;
  status: AgentJobStatus;
  goal: string;
  result_summary?: string;
  btl_request_id?: string;
  btl_charge?: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

/** Persisted agent record. */
export interface Agent {
  agent_id: string;
  name: string;
  template: string;
  created_at: string;
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

export interface PulseWatchPackage {
  ecosystem: Ecosystem;
  name: string;
  baseline_version?: string;
  last_seen_version?: string;
  last_audit_id?: string;
  last_verdict?: Verdict;
  last_score?: number;
  last_checked_at?: string;
}

/** POST /v1/pulse/watchlists request body. */
export interface CreatePulseWatchlistRequest {
  name: string;
  webhook_url?: string;
  packages: PulseWatchPackage[];
}

export interface PulseWatchlist {
  watchlist_id: string;
  name: string;
  webhook_url?: string;
  packages: PulseWatchPackage[];
  created_at: string;
  updated_at: string;
}

export interface PulseAlert {
  alert_id: string;
  watchlist_id: string;
  ecosystem: Ecosystem;
  name: string;
  previous_version?: string;
  new_version: string;
  previous_audit_id?: string;
  new_audit_id: string;
  previous_verdict?: Verdict;
  new_verdict: Verdict;
  previous_score?: number;
  new_score: number;
  risk_increased: boolean;
  mind_run_id?: string;
  mind_summary?: string;
  webhook_delivered: boolean;
  webhook_status?: number;
  created_at: string;
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
  guard_checks?: GuardSkillCheck[];
  secret_handles_bound?: string[];
  failure_reason?: string;
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
