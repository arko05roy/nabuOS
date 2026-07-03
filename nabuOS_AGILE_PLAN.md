# nabuOS Agile Plan

Version: 0.2  
Date: 2026-07-04  
Product name: nabuOS  
North star: A real agent operating system where package trust, secrets, deployment, memory, and decision-making are exposed as usable services, and where every agent decision is backed by BTL Runtime + evidence.

## Implementation Progress (as of 2026-07-04)

This section records what is **actually built** in the repo. The sprint stories below remain the full roadmap; status tags show current state.

### v0 scope cut

External services active in development:

| Service | Status | Notes |
|---------|--------|-------|
| BTL Runtime | **Active** | `GATEWAY_API_KEY` in `.env`, `@nabuos/btl-runtime`, `pnpm smoke:btl` |
| npm registry | **Active** | Public API, no key; `@nabuos/npm-registry`, `pnpm smoke:npm` |
| RetainDB | **Deferred** | No API key yet; memory persistence skipped until provisioned |
| Infisical / HashiCorp Vault | **Deferred** | `@nabuos/env-secrets` resolves `secret://env/*` from process env |

See `docs/scope.md`.

### Monorepo layout (built)

```
apps/web
services/api-gateway, guard, mind, vault, run, sandbox-worker
packages/types, sdk, service-kit, btl-runtime, npm-registry, env-secrets
infra/, docs/
```

Stack: **pnpm workspaces**, **TypeScript (ESM)**, **Hono** + `@hono/node-server`.

### Service ports (defaults)

| Service | Port | `/readyz` |
|---------|------|-----------|
| api-gateway | 3100 | process |
| guard | 3001 | process |
| mind | 3002 | process + live BTL `GET /v1/models` |
| vault | 3003 | process + env secret handles configured |
| run | 3004 | process |
| sandbox-worker | 3005 | process |

### Scripts

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build all packages and services |
| `pnpm typecheck` | Typecheck all packages and services |
| `pnpm health:check` | Hit `/healthz` + `/readyz` on all services (must be running) |
| `pnpm smoke:btl` | Live `GET /models` + `POST /chat/completions` via BTL (`btl-2` default) |
| `pnpm smoke:npm` | Live npm metadata via guard (`axios`, `lodash`, `@babel/core`) |

### Sprint 0 status

| Epic | Story | Status |
|------|-------|--------|
| 0.1 | 1. Monorepo structure | **Done** |
| 0.1 | 2. Shared TypeScript types | **Done** (`@nabuos/types` + `@nabuos/sdk` re-export) |
| 0.1 | 3. Health endpoints | **Done** (`@nabuos/service-kit`, all services) |
| 0.2 | 1. BTL Runtime provision | **Done** (key in `.env`, client + smoke test) |
| 0.2 | 2. RetainDB provision | **Deferred** |
| 0.2 | 3. Infisical / Vault provision | **Deferred** (env-secrets hack) |
| 0.2 | 4. Secrets outside repository | **Done** (`.env` gitignored, `.env.example` committed) |
| 0.3 | 1–3. OpenTelemetry | **Not started** |

### Sprint 1 status (in progress)

| Epic | Story | Status |
|------|-------|--------|
| 1.1 | 1. `getPackument` | **Done** (`@nabuos/npm-registry`, guard `GET /v1/guard/npm/:name`) |
| 1.1 | 2. `getVersion` | **Done** (guard `GET /v1/guard/npm/:name/:version`) |
| 1.1 | 3. Scoped name encoding | **Done** (`encodeURIComponent`, smoke: `@babel/core`) |
| 1.1 | Acceptance: metadata snapshot storage | **Not started** (returns live JSON only; no DB yet) |
| 1.2–1.6 | Artifact, inventory, OSV, BTL triage, public audit API | **Not started** |

### Live API routes (implemented)

**Guard** (`services/guard`, port 3001):

- `GET /healthz`, `GET /readyz`
- `GET /v1/guard/npm/:name` — live packument from `registry.npmjs.org`
- `GET /v1/guard/npm/:name/:version` — version doc with `dist.tarball`, `dist.integrity`, scripts, deps

**Mind** (`services/mind`, port 3002):

- `GET /healthz`, `GET /readyz` — readiness probes live BTL when `GATEWAY_API_KEY` set

**Vault** (`services/vault`, port 3003):

- `GET /healthz`, `GET /readyz` — checks `secret://env/gateway-api-key` is configured
- `GET /v1/vault/handles` — lists opaque handles (no values)
- `GET /v1/vault/resolve?handle=...` — returns `{ configured: true }` only; never raw secret

**Other services** (api-gateway, run, sandbox-worker): health endpoints only.

### BTL Runtime integration notes (learned)

- Base URL: `https://api.badtheorylabs.com/v1`
- Auth: `Authorization: Bearer $GATEWAY_API_KEY` (machine key, `inference` scope)
- Default smoke model: `btl-2`
- **Do not send `temperature: 0` to `btl-2` by default** — can cause `gateway_internal_error` (500). Omit `temperature` unless explicitly required.
- Cost proof headers observed: `x-btl-benchmark-cost`, `x-btl-customer-charge`, `x-btl-saved`. `x-btl-request-id` may be absent on some responses.
- See `docs/btl-runtime.md`

### Packages shipped

| Package | Role |
|---------|------|
| `@nabuos/types` | `AuditJob`, `AuditVerdict`, `MindRun`, `SecretRef`, `AgentDeployment`, `BtlResponseHeaders` |
| `@nabuos/sdk` | Re-exports core types (client methods later) |
| `@nabuos/service-kit` | Shared `/healthz` and `/readyz` |
| `@nabuos/btl-runtime` | Live BTL HTTP client (`ping`, `chatCompletion`, header parsing) |
| `@nabuos/npm-registry` | Live npm registry client (`getPackument`, `getVersion`) |
| `@nabuos/env-secrets` | v0 vault hack: `secret://env/gateway-api-key` → `GATEWAY_API_KEY` |

### Definition of Done — partial compliance

Sprint 0 stories satisfied where marked **Done**, with these gaps still open for later sprints:

- OpenTelemetry spans and `trace_id` in logs (Epic 0.3)
- Postgres metadata snapshot storage (Epic 1.1 acceptance)
- CI pipeline and deployment manifests (`infra/` placeholder)
- RetainDB and Infisical acceptance criteria explicitly waived until keys are provisioned

## 0. Non-Negotiables

This plan is written around the user's constraints:

- No mocks.
- No fake package data.
- No simulated audits.
- No "demo mode" returning hardcoded risk scores.
- No local-only story that cannot be deployed.
- No blockchain dependency in the core path.
- BTL Runtime is the LLM path for all agent reasoning, triage, synthesis, and decision-making.
- RetainDB is the memory layer where persistent user, agent, audit, and decision memories are needed **(deferred in v0 until API key is provisioned; see Implementation Progress)**.
- Public services must be useful independently:
  - A developer can call nabuOS Guard to audit an npm or PyPI package without deploying an agent.
  - A developer can call nabuOS Mind to reason over a package/audit/decision context.
  - A developer can use nabuOS Run to deploy a real agent only if Guard and Vault policies pass.

## 1. Product Shape

nabuOS is composed of five layers:

1. **nabu Guard**  
   Public package and skill security service. Audits npm and PyPI packages using real package registries, OSV, deps.dev, Semgrep, BTL Runtime, and sandboxed execution where enabled.

2. **nabu Vault**  
   SecretAgent layer. Stores and scopes API keys, provider keys, package registry tokens, GitHub tokens, webhook credentials, and future wallet credentials. Secrets never enter prompts or logs.

3. **nabu Run**  
   Synapze layer. Deploys and operates agents. Every agent install/load path must call Guard. Every secret use must go through Vault. Every decision must pass through Mind.

4. **nabu Mind**  
   Apollo layer. A decision kernel used throughout Guard, Vault, Run, and Apps. It plans, gathers evidence, critiques gaps, decides, and writes cited reports.

5. **nabu Apps**  
   User-facing apps built on the stack. First app is Pulse: real market/package/security intelligence, not a fake trading simulator.

## 2. External Services and Repositories

This section records the concrete docs and repos found during research. These are the implementation references for engineers.

### 2.0 Reference Hackathon Projects to Reuse or Study

These are the actual winner/inspiration repos and project pages that should be inspected before building from scratch. They are not dependencies to blindly copy; they are implementation references for architecture, API surfaces, and shortcuts.

#### npmguard-style supply chain security

Reference A: ETHGlobal Cannes 2026 npmguard

- Repo: https://github.com/kryczkal/EthCannes2026
- Search result description: "Autonomous npm supply chain security auditor. Monitors npm for new package releases, audits them through a multi-step security pipeline, and publishes verifiable results on-chain via ENS (Sepolia) + IPFS."
- Relevant architecture:
  - TypeScript + Hono audit pipeline.
  - Inventory phase.
  - Static analysis phase.
  - Sandbox phase.
  - IPFS publisher.
  - CLI.
  - Real-time SSE audit dashboard.
  - Chainlink CRE cron for npm monitoring.
  - ENS/IPFS publication.
- What nabuOS should reuse conceptually:
  - Audit pipeline decomposition.
  - CLI shape.
  - SSE job progress dashboard.
  - npm release monitor design.
  - Report publication format.
- What nabuOS should not copy for v1:
  - Mandatory ENS/IPFS publication.
  - 0G payment flow.
  - Chainlink CRE dependency in critical path.
- nabuOS adaptation:
  - Keep registry monitoring, audit pipeline, CLI, dashboard.
  - Replace Gemini calls with BTL Runtime.
  - Make npm + PyPI public API first.
  - Keep chain publication optional.

Reference B: Rust npmguard pre-install gate

- Repo: https://github.com/AyoubTadlaoui/npmguard
- README snapshot: https://github.com/AyoubTadlaoui/npmguard/blob/9bbea1033b6a4e3889a5bd95b680ec866280859d/README.md
- Relevant commit: https://github.com/AyoubTadlaoui/npmguard/commit/9771c0093da730ee0bab39e5ddd6a05140aadc59
- Confirmed architecture:
  - Rust binary.
  - CLI.
  - MCP server.
  - SQLite cache.
  - OSV malware data.
  - Typosquat/slopsquat detection.
  - Install-script analysis.
  - Claude Code PreToolUse gate.
- Confirmed limitation:
  - It is advisory for most agents.
  - Claude Code hook can deterministically block Bash tool calls.
  - Parser-level evasion is possible until an npm-wrapper/sandbox layer exists.
- What nabuOS should reuse conceptually:
  - Pre-install gate semantics.
  - CLI/MCP interface.
  - "warn asks user, block denies, network error asks" policy.
  - Package age / maintainer churn / typosquat risk signals.
  - SQLite/local cache idea for a developer-local CLI.
- What nabuOS should extend:
  - PyPI support.
  - Hosted API.
  - BTL Runtime triage.
  - gVisor sandbox.
  - Vault/Run integration.
  - Organization policy.

Reference C: npm-guard lifecycle script scanner

- Repo: https://github.com/Conradlog/npm-guard
- Relevant features:
  - `npm-guard check <package> --deep --json`
  - Recursive scanning of transitive dependencies.
  - Detection of newly injected dependencies versus previous version.
  - Package age verification.
  - Suspicious lifecycle script checks.
  - AI-agent-readable JSON.
- What nabuOS should reuse conceptually:
  - JSON output fields.
  - Transitive dependency risk explanation.
  - Previous-version diffing.

#### Synapze-style deploy plane

- ETHGlobal project: https://ethglobal.com/showcase/synapze-vijh5
- Repo from ETHGlobal API result: https://github.com/sekmet/synapzeai
- Live demo: https://www.synapze.xyz
- Relevant architecture from project description:
  - One-click deployment for ElizaOS agents.
  - Upload/configure character file JSON.
  - Agent templates.
  - Environment variable management.
  - Real-time monitoring/progress page.
  - Coinbase AgentKit/OnchainKit integration.
  - AVS integration.
- What nabuOS should reuse conceptually:
  - Agent template model.
  - Character/config JSON deploy flow.
  - Deployment progress UI.
  - Secure env var binding pattern.
- nabuOS adaptation:
  - Replace generic one-click agent deploy with Guard-gated deploy.
  - Run refuses unsafe skills.
  - Vault owns secrets.
  - Mind attaches decision traces to deployments.

#### SecretAgent-style secret management

- ETHGlobal project: https://ethglobal.com/showcase/secretagent-nkz1u
- Repo from ETHGlobal API result: https://github.com/dmno-dev/secret-agent
- Relevant product idea:
  - Secrets management for crypto-native AI agents.
  - Won "Best Combination of AgentKit and OnchainKit."
- What nabuOS should inspect:
  - Secret reference model.
  - Agent-facing secret API.
  - Any policy/audit-log primitives.
- nabuOS adaptation:
  - Use Infisical/Vault as provider.
  - Expose secret handles only.
  - Apply per-agent policy.

#### Whal-E-style intelligence app

- ETHGlobal project: https://ethglobal.com/showcase/whal-e-awzsa
- Repo from ETHGlobal API result: https://github.com/Wakushi/whale-seek-back
- Live demo: https://whal-e-eight.vercel.app
- Relevant product idea:
  - Whale tracking.
  - Trade analysis.
  - Copying multi-agent system.
  - Discovers whale wallets, evaluates performance, maintains curated trader list.
  - Agent analyzes portfolio composition, market data, and news before copying.
- nabuOS adaptation:
  - Defer direct trading until Vault policies and execution controls exist.
  - Reuse the pattern for future Pulse market intelligence.
  - Do not use fake trading data.

#### Apollo-style research meta-agent

- Microsoft AI Agents Hackathon page: https://microsoft.github.io/AI_Agents_Hackathon/winners/
- Project name: Apollo — Deep Research Meta Agent.
- Public repo was not found in web search results.
- Relevant architecture from winner page:
  - Coordinator agent.
  - Research engine agent.
  - Analyzer agent.
  - Self-reflective RAG with PostgreSQL/pgvector.
  - Gap checking.
  - Two-stage synthesis.
  - State machine and async workflow.
- nabuOS adaptation:
  - Implement the pattern, not a direct code reuse.
  - Replace Azure OpenAI with BTL Runtime.
  - Replace/local augment vector memory with RetainDB.

#### AgentOS-style infrastructure

- Colosseum project page: https://colosseum.com/agent-hackathon/projects/agentos
- Public repo link was not exposed by fetched page.
- Relevant product idea:
  - Autonomous infrastructure for AI agents.
  - Provision phone numbers, email, compute, domains, inter-agent messaging.
  - USDC/x402 payment per API call on Solana.
  - Agent reputation system.
  - Real-time webhooks.
  - Swagger documentation.
- nabuOS adaptation:
  - Keep job execution, webhooks, usage, and agent lifecycle.
  - Drop phone/email/domains from v1.
  - Drop x402 from critical path.
  - Use account credits/API keys first.

### 2.1 BTL Runtime

Use for every LLM call.

**v0 status (2026-07-04):** Integrated. Package `@nabuos/btl-runtime`; smoke test `pnpm smoke:btl`; mind `/readyz` probes `GET /v1/models`. Default model `btl-2`. See `docs/btl-runtime.md` and **Implementation Progress** for temperature and header notes.

Docs:

- https://runtime.badtheorylabs.com/docs
- https://www.badtheorylabs.com/runtime
- https://runtime.badtheorylabs.com/brief

Confirmed details:

- OpenAI-compatible base URL: `https://api.badtheorylabs.com/v1`
- Primary routes:
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
  - `GET /v1/models`
  - `GET /v1/providers`
  - `GET /v1/account/pricing`
  - `GET /v1/usage/summary`
- Auth: `Authorization: Bearer $GATEWAY_API_KEY`
- Machine key should be created with `inference` scope.
- Headers include request and cost proof:
  - `x-btl-request-id`
  - `x-btl-cache-tier`
  - `x-btl-benchmark-cost`
  - `x-btl-customer-charge`
  - `x-btl-saved`

nabuOS requirements:

- Store every BTL request ID with the nabu trace ID.
- Persist BTL cost headers on every Mind/Guard decision.
- Expose model cost and latency on user dashboards.
- Use BTL cache-friendly prompts:
  - Stable system prompts.
  - Structured JSON schemas.
  - Deterministic low-temperature triage.
  - Package inventory separated from variable user text.

### 2.2 RetainDB

Use for persistent memory and context.

**v0 status (2026-07-04):** Deferred — no API key provisioned. Mind/Guard do not call RetainDB yet. Evidence returned live in HTTP responses until Postgres + RetainDB integration lands (Sprint 5 / Epic 5.2).

Docs and repo:

- https://github.com/RetainDB/RetainDB
- https://www.retaindb.com/docs/api/memory
- https://www.retaindb.com/docs/api/agent-memory
- https://www.retaindb.com/docs/start/http-quickstart

Confirmed routes:

- Memory:
  - `POST /v1/memory`
  - `POST /v1/memory/bulk`
  - `POST /v1/memory/search`
  - `POST /v1/memory/ingest/session`
  - `GET /v1/memory/jobs/:jobId`
  - `GET /v1/memory/profile/:userId`
  - `GET /v1/memory/session/:sessionId`
  - `GET /v1/memory/:memoryId`
  - `PUT /v1/memory/:memoryId`
  - `DELETE /v1/memory/:memoryId`
- Agent memory:
  - `POST /v1/agent/memory/events`
  - `POST /v1/agent/memory/context`
  - `POST /v1/agent/memory/handoffs`
  - `GET /v1/agent/memory/handoffs/:handoffId`
  - `POST /v1/agent/memory/handoffs/:handoffId/resume`
- Auth:
  - `Authorization: Bearer $RETAINDB_API_KEY`
  - or `X-API-Key`
- Idempotency:
  - Send `Idempotency-Key` for retryable event and handoff writes.

nabuOS requirements:

- Store user preferences:
  - risk tolerance
  - package ecosystems they care about
  - minimum Guard score
  - packages previously approved/blocked
- Store agent task memories:
  - every Guard decision
  - every Mind critique
  - every deployment policy decision
- Use `include_pending: true` after async memory writes when same job immediately needs recall.
- Use stable scopes:
  - `project = "nabuos"`
  - `user_id`
  - `agent_id`
  - `task_id`
  - `session_id`

### 2.3 npm Registry

Use for real npm package metadata and tarball downloads.

Docs and repos:

- https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
- https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
- https://github.com/npm/types

Confirmed endpoints:

- Full packument:
  - `GET https://registry.npmjs.org/:package`
- Abbreviated install metadata:
  - `GET https://registry.npmjs.org/:package`
  - Header: `Accept: application/vnd.npm.install-v1+json`
- Specific version:
  - `GET https://registry.npmjs.org/:package/:version`
- Search:
  - `GET https://registry.npmjs.org/-/v1/search`

Important metadata fields:

- `dist.tarball`
- `dist.shasum`
- `dist.integrity`
- `dist.fileCount`
- `dist.unpackedSize`
- `dist.npm-signature`
- `repository`
- `dependencies`
- `devDependencies`
- `scripts`
- `bin`
- `exports`
- `main`
- `time.created`
- `time.modified`

nabuOS requirements:

- Never trust user-provided package metadata.
- Fetch npm metadata directly from `registry.npmjs.org`.
- Download the tarball from `dist.tarball`.
- Verify `dist.integrity` when available.
- Fall back to `dist.shasum` only as legacy verification and mark as weaker.
- Store package metadata snapshot and tarball hash for reproducibility.
- Audit `package.json` scripts, especially:
  - `preinstall`
  - `install`
  - `postinstall`
  - `prepublish`
  - `prepare`
  - `prepack`
  - `postpack`
- Extract and inspect tarball contents before any execution.

### 2.4 PyPI

Use for real Python package metadata and distribution downloads.

Docs and repos:

- https://docs.pypi.org/api/json/
- https://github.com/pypi/warehouse/blob/main/docs/user/api/json.md
- https://docs.pypi.org/api/index-api/
- https://packaging.python.org/en/latest/specifications/simple-repository-api/
- https://peps.python.org/pep-0691/
- https://github.com/pypa/packaging.python.org/blob/main/source/specifications/simple-repository-api.rst

Confirmed endpoints:

- Project JSON:
  - `GET https://pypi.org/pypi/<project_name>/json`
- Release JSON:
  - `GET https://pypi.org/pypi/<project_name>/<version>/json`
- Simple JSON index:
  - `GET https://pypi.org/simple/<project>/`
  - Header: `Accept: application/vnd.pypi.simple.v1+json`

Important fields:

- File URLs
- `digests.md5`
- `digests.sha256`
- `digests.blake2b_256`
- `requires_python`
- `yanked`
- `yanked_reason`
- distribution type:
  - wheel
  - sdist
- upload time

nabuOS requirements:

- Prefer PyPI Simple JSON API for distribution discovery.
- Use PyPI JSON release API when detailed release metadata is needed.
- Download actual wheel/sdist files from PyPI file URLs.
- Verify SHA256 digest.
- Mark `yanked` files as at least `warn`.
- Inspect:
  - `setup.py`
  - `pyproject.toml`
  - `setup.cfg`
  - package entry points
  - console scripts
  - native extensions
  - suspicious import-time behavior

### 2.5 OSV

Use for known vulnerabilities.

Docs:

- https://google.github.io/osv.dev/api/
- https://google.github.io/osv.dev/post-v1-query/
- https://google.github.io/osv.dev/post-v1-querybatch/
- https://osv.dev/

Confirmed endpoints:

- Single query:
  - `POST https://api.osv.dev/v1/query`
- Batch query:
  - `POST https://api.osv.dev/v1/querybatch`
- Vulnerability details:
  - `GET https://api.osv.dev/v1/vulns/{id}`

Important details:

- Ecosystem names are case-sensitive.
- Use `PyPI`, not `pypi`.
- Supports package name + ecosystem + version.
- Batch query returns vulnerability IDs and modified timestamps; fetch full details separately.
- OSV docs state no current API rate limit.

nabuOS requirements:

- Use `querybatch` for dependency trees to reduce latency.
- Cache OSV result by:
  - ecosystem
  - package
  - version
  - OSV modified timestamp
- Fetch full vulnerability details only for vulnerability IDs not already cached.
- OSV known vulnerabilities are deterministic signals, not LLM findings.

### 2.6 deps.dev

Use for dependency graphs, version metadata, licenses, advisory linkage, and package-source metadata.

Docs and repo:

- https://docs.deps.dev/
- https://docs.deps.dev/api/v3/
- https://github.com/google/deps.dev

Confirmed endpoints:

- Get package:
  - `GET https://api.deps.dev/v3/systems/{system}/packages/{package}`
- Get version:
  - `GET https://api.deps.dev/v3/systems/{system}/packages/{package}/versions/{version}`
- Get dependencies:
  - `GET https://api.deps.dev/v3/systems/{system}/packages/{package}/versions/{version}:dependencies`
- Get advisory:
  - `GET https://api.deps.dev/v3/advisories/{advisoryKey}`

Supported systems include:

- npm
- PyPI
- Cargo
- Go
- Maven
- NuGet
- RubyGems

nabuOS requirements:

- Use deps.dev `GetDependencies` for dependency graph instead of resolving dependencies locally where possible.
- Use exact versions from deps.dev graph for transitive OSV batch checks.
- Cache dependency graph by package version.
- Record relation:
  - SELF
  - DIRECT
  - INDIRECT
- Use deps.dev as a latency optimization:
  - one API call can return a resolved graph.
  - avoids slow install-time dependency resolution.

### 2.7 Semgrep

Use for static analysis on extracted package source.

Docs and repos:

- https://docs.semgrep.dev/getting-started/cli
- https://docs.semgrep.dev/customize-semgrep-ce
- https://semgrep.dev/docs/semgrep-appsec-platform/json-and-sarif
- https://github.com/semgrep/semgrep-interfaces/blob/main/semgrep_output_v1.atd

Confirmed commands:

- `semgrep scan --json --json-output=semgrep.json`
- Output formats include:
  - text
  - json
  - sarif
  - gitlab-sast
  - gitlab-secrets
  - junit-xml

nabuOS requirements:

- Run Semgrep against extracted package source.
- Use JSON output only for machine ingestion.
- Use a minimal trusted rulepack first:
  - JavaScript/TypeScript dangerous APIs
  - Python dangerous APIs
  - shell execution
  - network exfiltration patterns
  - credential reads
  - install-script abuse
- Persist raw Semgrep JSON artifact.
- Apollo/Mind may summarize Semgrep output, but must not replace raw findings.

### 2.8 gVisor

Use for sandboxed execution where dynamic analysis is enabled.

Docs and repo:

- https://github.com/google/gvisor
- https://gvisor.dev/
- https://gvisor.dev/docs/
- https://gvisor.dev/docs/architecture_guide/intro/

Confirmed details:

- gVisor provides an OCI runtime called `runsc`.
- Integrates with Docker, Kubernetes, and containerd.
- Provides stronger isolation than normal containers by intercepting syscalls.
- Rootless mode exists for some networkless use cases:
  - `runsc --rootless --network=none do echo Hello world`
- Official docs warn `runsc do` is a convenience command and real usage should define strict OCI/Docker mounts.

nabuOS requirements:

- Dynamic package execution must run in gVisor-backed containers, not normal Docker alone.
- Default sandbox network is disabled.
- Default sandbox filesystem is read-only except a scratch directory.
- No host Docker socket in sandbox.
- No secrets mounted into sandbox.
- CPU, memory, process, file, and wall-clock limits are mandatory.
- Every sandbox run produces:
  - stdout
  - stderr
  - exit code
  - duration
  - resource usage
  - file writes summary
  - network attempt summary where possible

### 2.9 Secrets Management

Candidate A: HashiCorp Vault.

Docs and repo references:

- https://docs.hashicorp.com/vault/api-docs/secret/kv/kv-v2
- https://github.com/hashicorp/web-unified-docs/blob/main/content/vault/v2.x/content/api-docs/index.mdx
- https://github.com/hashicorp/web-unified-docs/blob/main/content/vault/v2.x/content/docs/secrets/kv/index.mdx

Confirmed Vault KV v2 details:

- API routes are prefixed with `/v1/`.
- KV v2 read/write requires `/data/` segment:
  - `/v1/secret/data/:path`
- Metadata uses `/metadata/` segment:
  - `/v1/secret/metadata/:path`
- KV v2 provides versioning and check-and-set.

Candidate B: Infisical.

Docs and repo:

- https://github.com/Infisical/infisical
- https://infisical.com/docs/api-reference
- https://infisical.com/docs/api-reference/overview/introduction

Confirmed Infisical details:

- Open-source secrets management platform.
- Cloud and self-hosted options.
- Public REST API.
- Supports secret CRUD, access control, audit logs.
- Cloud rate limits:
  - Free read: 200/minute
  - Free write: 90/minute
  - Free secret: 120/minute

Decision:

- Start with Infisical Cloud or self-hosted Infisical if speed matters.
- Abstract with a `VaultProvider` interface so HashiCorp Vault can replace it for enterprise deployments.

**v0 implementation (2026-07-04):** Infisical not provisioned. `@nabuos/env-secrets` maps `secret://env/gateway-api-key` → `GATEWAY_API_KEY` in process environment. Vault service exposes handles only; resolve endpoint returns `configured: true`, never raw values. Upgrade path: implement `InfisicalProvider` behind same interface when credentials exist.

nabuOS requirements:

- Secrets are referenced by opaque handles:
  - `secret://project/env/key`
- Raw secrets never enter:
  - prompts
  - logs
  - traces
  - RetainDB memories
  - Guard reports
- Every secret read produces an audit event.
- Secret policies include:
  - allowed agent IDs
  - allowed tools
  - allowed destinations
  - max request count
  - expiry

### 2.10 OpenTelemetry

Use for traces, metrics, and logs across all services.

Docs and repos:

- https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- https://github.com/open-telemetry/opentelemetry-js
- https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/metrics.md

Confirmed details:

- Node packages:
  - `@opentelemetry/sdk-node`
  - `@opentelemetry/api`
  - `@opentelemetry/auto-instrumentations-node`
  - `@opentelemetry/sdk-metrics`
  - `@opentelemetry/sdk-trace-node`
- Node instrumentation must initialize before application code via `--import` or `--require`.
- Prometheus metrics exporter is supported.

nabuOS requirements:

- Every public request gets a trace ID.
- Every BTL Runtime call includes:
  - nabu trace ID
  - BTL request ID
  - model
  - cache tier
  - benchmark cost
  - charged cost
  - saved cost
- Every Guard audit includes spans:
  - registry metadata fetch
  - file download
  - hash verification
  - deps.dev graph
  - OSV batch
  - Semgrep
  - BTL triage
  - sandbox execution
- Every Run deployment includes spans:
  - policy validation
  - Guard checks
  - secret binding
  - agent startup

## 3. Architecture

### 3.1 Service Map

Services:

1. `api-gateway`
   - Public REST API.
   - Auth, rate limits, request IDs.
   - Routes to Guard, Mind, Vault, Run, Apps.

2. `guard-service`
   - Package metadata ingestion.
   - Artifact download and hash verification.
   - Static inventory.
   - OSV/deps.dev enrichment.
   - Semgrep scans.
   - Sandbox job scheduling.
   - Final verdict production.

3. `mind-service`
   - Apollo decision kernel.
   - Calls BTL Runtime.
   - Reads/writes RetainDB.
   - Produces structured decisions.

4. `vault-service`
   - Wraps Infisical/Vault.
   - Secret handle resolution.
   - Policy checks.
   - Secret audit logs.

5. `run-service`
   - Agent deployment.
   - Agent lifecycle.
   - Job scheduling.
   - Guard-gated dependency/skill install.
   - Vault-gated secret use.

6. `sandbox-workers`
   - gVisor-backed dynamic analysis.
   - No network by default.
   - Strict quotas.

7. `pulse-app`
   - First app layer.
   - Consumes Guard, Mind, Vault, Run.
   - Must be real integrations only.

### 3.2 Data Stores

Primary DB:

- PostgreSQL.

Tables:

- `users`
- `api_keys`
- `projects`
- `packages`
- `package_versions`
- `artifacts`
- `audit_jobs`
- `audit_phases`
- `audit_findings`
- `audit_verdicts`
- `dependency_nodes`
- `dependency_edges`
- `osv_vulnerabilities`
- `semgrep_runs`
- `sandbox_runs`
- `mind_runs`
- `mind_steps`
- `secret_refs`
- `secret_access_events`
- `agents`
- `agent_deployments`
- `agent_jobs`
- `usage_events`
- `webhook_deliveries`

Object storage:

- S3-compatible bucket.
- Stores:
  - downloaded package artifacts
  - extracted normalized inventories
  - Semgrep JSON output
  - sandbox stdout/stderr
  - Mind decision JSON
  - generated reports

Queue:

- Redis + BullMQ or Postgres-backed queue if minimizing infra.
- Queue names:
  - `guard.audit`
  - `guard.download`
  - `guard.semgrep`
  - `guard.sandbox`
  - `mind.run`
  - `run.deploy`
  - `webhook.deliver`

Recommendation:

- Use BullMQ only if the team is comfortable operating Redis.
- Otherwise start with Postgres advisory-lock queue to reduce services.

### 3.3 Latency Strategy

Primary latency problem:

- Package audit can be slow because it involves registry fetches, downloads, dependency graph calls, vulnerability lookups, static analysis, LLM calls, and sandbox runs.

Latency design:

1. Split audit into fast and deep phases:
   - Fast verdict: metadata + hash + OSV + deps.dev + inventory + BTL triage.
   - Deep verdict: Semgrep + sandbox + Apollo investigation.

2. Cache immutable artifacts:
   - npm package version tarballs are immutable after publication except unusual registry events.
   - PyPI files have stable hashes.
   - Cache by ecosystem/name/version/artifact hash.

3. Use deps.dev instead of local dependency resolution:
   - `GetDependencies` returns a resolved graph.
   - This avoids expensive install/resolve work in our service.

4. Use OSV batch:
   - One `querybatch` for all graph nodes.
   - Fetch vulnerability details only on cache miss.

5. Use BTL Runtime cache:
   - Stable prompts.
   - Stable JSON schema.
   - Separate package inventory from variable user context.

6. Avoid sandbox unless required:
   - Sandbox only if:
     - install scripts exist
     - Semgrep high severity finding exists
     - BTL triage score crosses threshold
     - user explicitly requests deep audit

7. Return progressive results:
   - `status = running`
   - `fast_verdict = allow|warn|block`
   - `deep_verdict = pending|allow|warn|block`

8. Do not block public `check` on deep audit:
   - `GET /guard/check` returns cached completed result if available.
   - If no result, API says `not_found` and user can trigger audit.

Target latency SLOs:

- Cached check: p95 < 150 ms.
- Fast audit npm/PyPI no artifact download cache: p95 < 8 s.
- Fast audit with artifact cached: p95 < 3 s.
- Deep audit with Semgrep: p95 < 60 s.
- Sandbox audit: p95 < 180 s.

## 4. Public API Design

### 4.1 Auth

Use account-scoped nabu API keys.

Headers:

- `Authorization: Bearer nabu_...`
- `Idempotency-Key` for mutating job creation.

### 4.2 Guard API

Create package audit:

```http
POST /v1/guard/audits
Content-Type: application/json
Authorization: Bearer nabu_...
Idempotency-Key: audit:npm:axios:1.6.0

{
  "ecosystem": "npm",
  "name": "axios",
  "version": "1.6.0",
  "depth": "fast"
}
```

Allowed values:

- `ecosystem`: `npm`, `pypi`
- `depth`: `fast`, `deep`, `sandbox`

Get audit:

```http
GET /v1/guard/audits/{audit_id}
```

Check cached verdict:

```http
GET /v1/guard/check?ecosystem=npm&name=axios&version=1.6.0
```

Audit response shape:

```json
{
  "audit_id": "aud_...",
  "status": "running",
  "ecosystem": "npm",
  "name": "axios",
  "version": "1.6.0",
  "artifact": {
    "url": "https://registry.npmjs.org/axios/-/axios-1.6.0.tgz",
    "sha256": "...",
    "integrity_verified": true
  },
  "fast_verdict": {
    "verdict": "warn",
    "score": 72,
    "reasons": []
  },
  "deep_verdict": null,
  "phases": []
}
```

No fake scores:

- `score` must be computed from deterministic signals + BTL triage output.
- The scoring formula must be versioned and stored as `scoring_version`.

### 4.3 Mind API

Run decision:

```http
POST /v1/mind/runs
Authorization: Bearer nabu_...
Idempotency-Key: mind:...

{
  "goal": "Should I use axios 1.6.0 in a production agent?",
  "context_refs": [
    { "type": "guard_audit", "id": "aud_..." }
  ],
  "mode": "brief"
}
```

Modes:

- `brief`
- `deep`
- `policy`
- `incident`

Response:

```json
{
  "mind_run_id": "mind_...",
  "status": "completed",
  "decision": "use_with_constraints",
  "confidence": 0.82,
  "summary": "...",
  "evidence": [],
  "bt_runtime": {
    "request_ids": [],
    "total_charge": 0.0,
    "total_saved": 0.0
  }
}
```

### 4.4 Vault API

Create secret reference:

```http
POST /v1/vault/secrets
{
  "project_id": "proj_...",
  "name": "btl-runtime-key",
  "value": "...",
  "policy": {
    "allowed_agent_ids": ["agent_..."],
    "expires_at": "2026-08-01T00:00:00Z"
  }
}
```

Never return raw secret values through public API after creation.

### 4.5 Run API

Deploy agent:

```http
POST /v1/run/agents
{
  "name": "pulse-wallet-watch",
  "template": "pulse",
  "skills": [
    { "ecosystem": "npm", "name": "viem", "version": "2.21.0" }
  ],
  "secrets": [
    "secret://proj/prod/btl-runtime-key"
  ],
  "policy": {
    "guard_min_score": 75,
    "allow_warn": false
  }
}
```

Run must:

- call Guard for every skill
- reject blocked dependencies
- request Vault handles only after policy passes
- create RetainDB agent memory event
- create OpenTelemetry trace

## 5. Scoring Model

Scoring must be transparent and versioned.

Initial scoring version: `guard-score-v0.1`

Inputs:

1. Registry integrity:
   - hash verified
   - missing integrity
   - yanked release
   - tarball unavailable

2. Known vulnerability:
   - OSV vulnerability severity
   - advisory count
   - affected transitive dependencies

3. Dependency graph risk:
   - dependency count
   - transitive count
   - unknown packages
   - recently published package versions

4. Install-time risk:
   - npm install scripts
   - PyPI setup.py execution
   - native extensions
   - shell commands

5. Static analysis:
   - Semgrep severity
   - rule category
   - suspicious patterns

6. BTL Runtime triage:
   - structured JSON risk assessment
   - must cite concrete files/fields
   - must not invent files

7. Sandbox:
   - unexpected network attempts
   - filesystem writes
   - process spawning
   - suspicious output

Verdicts:

- `allow`: score >= 80 and no hard-block findings.
- `warn`: score 50-79 or uncertain findings.
- `block`: score < 50 or hard-block finding.

Hard-block findings:

- hash verification failed
- known active malicious package signal
- package download mismatch
- hidden postinstall executing remote code
- sandbox detects credential exfiltration attempt
- Semgrep high confidence secret exfiltration or arbitrary code execution in install path

## 6. Agile Roadmap

Cadence:

- 1-week sprints.
- Every sprint ends with deployable software.
- Every story has real-service acceptance criteria.
- No story is accepted if it only works with fake fixtures.
- Unit tests can use local deterministic fixtures, but integration acceptance must call real upstream services in a staging environment.

Definition of Done for every story:

- Code merged.
- Tests pass.
- OpenTelemetry spans emitted.
- Errors logged with trace IDs.
- No secret printed in logs.
- API documented.
- Real integration tested against at least one public npm package and one public PyPI package where applicable.
- Latency measured and recorded.

## 7. Sprint 0: Product and Infrastructure Foundation

Duration: 1 week.

Goal:

- Establish repo, environments, service skeletons, CI, deployment, and integration keys.

**Sprint 0 progress:** Epic 0.1 complete. Epic 0.2 partial (BTL + env secrets only; RetainDB and Infisical deferred). Epic 0.3 not started. See **Implementation Progress** at top of document.

### Epic 0.1: Repository and Service Skeleton — **DONE**

Stories:

1. ✅ Create monorepo structure.
   - `apps/web`
   - `services/api-gateway`
   - `services/guard`
   - `services/mind`
   - `services/vault`
   - `services/run`
   - `services/sandbox-worker`
   - `packages/sdk`
   - `packages/types`
   - `infra`
   - `docs`
   - Also shipped: `packages/service-kit`, `packages/btl-runtime`, `packages/npm-registry`, `packages/env-secrets`

2. ✅ Add shared TypeScript types.
   - `AuditJob`
   - `AuditVerdict`
   - `MindRun`
   - `SecretRef`
   - `AgentDeployment`
   - Also: `BtlResponseHeaders`, `BtlChatCompletionResult`, `HealthResponse`, `ReadinessCheck`

3. ✅ Add service health endpoints:
   - `GET /healthz`
   - `GET /readyz`
   - `mind` `/readyz` additionally probes live BTL `GET /v1/models`
   - `vault` `/readyz` checks env secret handles

Acceptance:

- ✅ All services start locally (`pnpm build`, `node dist/index.js` per service).
- ✅ Health endpoints return actual process readiness (and BTL readiness on mind).
- ✅ No route returns fake product data.

### Epic 0.2: Environment and Secrets — **PARTIAL**

Stories:

1. ✅ Provision BTL Runtime workspace and machine key.
   - Implemented: `@nabuos/btl-runtime`, `GATEWAY_API_KEY` in `.env`, `pnpm smoke:btl`
   - Docs: `docs/btl-runtime.md`
2. ⏸️ Provision RetainDB API key. **Deferred** — no key yet.
3. ⏸️ Provision Infisical project or Vault dev/staging instance. **Deferred** — replaced by `@nabuos/env-secrets` env hack.
4. ✅ Store secrets outside repository.
   - `.env` gitignored; `.env.example` committed with variable names only.

Acceptance:

- ✅ A smoke test calls BTL Runtime `POST /v1/chat/completions` (`pnpm smoke:btl`, model `btl-2`).
- ⏸️ A smoke test writes and searches RetainDB memory. **Waived until key provisioned.**
- ✅ A smoke test writes and reads one secret through selected secret provider.
   - v0: `GET /v1/vault/resolve?handle=secret://env/gateway-api-key` when `GATEWAY_API_KEY` set (configured flag only).
- ✅ No `.env` committed.

### Epic 0.3: Observability — **NOT STARTED**

Stories:

1. Add OpenTelemetry SDK to Node services.
2. Add trace IDs to logs.
3. Add Prometheus metrics endpoint or OTLP exporter.

Acceptance:

- A Guard audit request creates a distributed trace across gateway and guard.
- Trace includes external call spans.
- Logs include `trace_id`.

## 8. Sprint 1: Guard Fast Audit for npm

Duration: 1 week.

Goal:

- Public API can audit a real npm package version with real metadata, real tarball hash verification, OSV, deps.dev, inventory, and BTL triage.

**Sprint 1 progress:** Epic 1.1 core client and guard HTTP routes done; metadata snapshot persistence and Epics 1.2–1.6 not started.

### Epic 1.1: npm Metadata Adapter — **DONE** (routes + client; DB snapshot pending)

Stories:

1. ✅ Implement `NpmRegistryClient.getPackument(name)`.
   - Calls `https://registry.npmjs.org/:package`.
   - Uses `Accept: application/vnd.npm.install-v1+json` for fast metadata.
   - Package: `@nabuos/npm-registry`
   - Route: `GET /v1/guard/npm/:name`

2. ✅ Implement `NpmRegistryClient.getVersion(name, version)`.
   - Finds exact version.
   - Extracts `dist.tarball`, `dist.integrity`, `dist.shasum`.
   - Route: `GET /v1/guard/npm/:name/:version`

3. ✅ Implement scoped package name encoding.
   - Example: `@scope/pkg` must be URL encoded correctly (`encodeURIComponent`).
   - Verified: `@babel/core` in `pnpm smoke:npm`

Acceptance:

- ✅ Fetches real metadata for:
  - `axios`
  - `lodash`
  - `@babel/core`
- ⏳ Stores raw metadata snapshot. **Not started** — responses are live JSON; Postgres/object storage in a later story.
- ✅ Handles 404 as `package_not_found`.

### Epic 1.2: Artifact Download and Integrity — **NOT STARTED**

Stories:

1. Download npm tarball to object storage.
2. Verify SRI `dist.integrity`.
3. Compute SHA256 for nabu artifact identity.
4. Extract tarball to isolated temp directory.

Acceptance:

- `axios@1.6.0` tarball downloads from npm.
- Hash verification succeeds.
- Tampered local artifact fails verification in test.
- Extracted files are listed from real tarball contents.

### Epic 1.3: Inventory

Stories:

1. Parse `package.json`.
2. Extract scripts.
3. Extract dependencies.
4. Extract entrypoints.
5. Compute file stats:
   - file count
   - total size
   - extension histogram

Acceptance:

- Inventory for real npm package includes real scripts/deps/files.
- No LLM involved in inventory.

### Epic 1.4: deps.dev and OSV

Stories:

1. Call deps.dev `GetDependencies`.
2. Build dependency graph table.
3. Call OSV `querybatch` for root and dependencies.
4. Fetch full OSV vulnerability details for cache misses.

Acceptance:

- Real dependency graph returned for a known npm package version.
- OSV batch request sent with exact versions.
- Results cached.
- Missing deps.dev graph does not crash audit; marks phase as degraded.

### Epic 1.5: BTL Runtime Triage

Stories:

1. Create stable triage prompt.
2. Input only:
   - metadata
   - inventory
   - scripts
   - OSV summary
   - Semgrep placeholder omitted until Sprint 3
3. Require JSON schema:
   - `risk_score`
   - `verdict_recommendation`
   - `findings`
   - `uncertainties`
   - `required_next_phase`

Acceptance:

- Calls BTL Runtime.
- Persists BTL request ID and cost headers.
- Rejects invalid JSON and retries once with repair prompt.
- Findings cite concrete metadata fields or file paths.

### Epic 1.6: Public Guard API

Stories:

1. `POST /v1/guard/audits`.
2. `GET /v1/guard/audits/:id`.
3. `GET /v1/guard/check`.

Acceptance:

- User can audit a real npm package.
- User can retrieve status.
- Cached check returns completed verdict.

## 9. Sprint 2: Guard Fast Audit for PyPI

Duration: 1 week.

Goal:

- Public API can audit real PyPI package versions.

### Epic 2.1: PyPI Metadata Adapter

Stories:

1. Implement Simple JSON client:
   - `GET https://pypi.org/simple/<project>/`
   - `Accept: application/vnd.pypi.simple.v1+json`

2. Implement release metadata fallback:
   - `GET https://pypi.org/pypi/<project>/<version>/json`

3. Normalize package names per Python packaging rules.

Acceptance:

- Fetches real metadata for:
  - `requests`
  - `flask`
  - `django`
- Handles yanked files.

### Epic 2.2: PyPI Artifact Download and Hash

Stories:

1. Select artifact:
   - Prefer wheel for inventory.
   - Also support sdist.
2. Download file from PyPI file URL.
3. Verify SHA256 digest.
4. Extract wheel/sdist safely.

Acceptance:

- `requests==2.31.0` downloads and verifies.
- Digest mismatch test fails.
- Yanked package warns.

### Epic 2.3: Python Inventory

Stories:

1. Parse:
   - `pyproject.toml`
   - `setup.py`
   - `setup.cfg`
   - `PKG-INFO`
   - `METADATA`
2. Extract:
   - dependencies
   - entry points
   - console scripts
   - native extensions
   - declared Python version

Acceptance:

- Inventory uses real extracted files.
- setup.py is read, not executed.

### Epic 2.4: deps.dev and OSV PyPI

Stories:

1. Call deps.dev for PyPI graph.
2. Call OSV with ecosystem `PyPI`.
3. Cache results.

Acceptance:

- Real graph and vulnerability calls for PyPI package.
- Ecosystem casing is correct.

## 10. Sprint 3: Static Analysis with Semgrep

Duration: 1 week.

Goal:

- Deep audit includes real static analysis.

### Epic 3.1: Semgrep Worker

Stories:

1. Install Semgrep in worker image.
2. Run `semgrep scan --json --json-output=semgrep.json`.
3. Use rulepacks for:
   - JavaScript/TypeScript
   - Python
   - shell injection
   - credential access
   - network exfiltration

Acceptance:

- Runs against extracted real npm package.
- Runs against extracted real PyPI package.
- Stores raw JSON output.

### Epic 3.2: Semgrep Finding Ingestion

Stories:

1. Parse Semgrep JSON.
2. Store findings with:
   - rule ID
   - severity
   - path
   - start/end lines
   - message
   - metadata
3. Link findings to audit job.

Acceptance:

- User can see raw findings in API.
- Mind can summarize findings but raw data remains available.

### Epic 3.3: Deep Verdict

Stories:

1. Update scoring model with Semgrep findings.
2. Trigger Apollo/Mind investigation when high-risk static findings exist.

Acceptance:

- Deep audit improves or worsens verdict based on real Semgrep findings.
- No hardcoded package-specific outcomes.

## 11. Sprint 4: Sandbox Dynamic Analysis

Duration: 1 week.

Goal:

- High-risk packages can be dynamically analyzed in a gVisor-backed sandbox.

### Epic 4.1: gVisor Runtime

Stories:

1. Build sandbox worker host with Docker + `runsc`.
2. Register Docker runtime `runsc`.
3. Create hardened base images:
   - Node
   - Python

Acceptance:

- Worker runs `docker run --runtime=runsc`.
- Normal Docker runtime is not used for untrusted execution.

### Epic 4.2: Networkless Execution

Stories:

1. Disable network by default.
2. Mount extracted artifact read-only.
3. Provide writable scratch directory.
4. Enforce timeout.
5. Enforce memory/CPU limits.

Acceptance:

- Package install script cannot access host filesystem.
- Package install script cannot access network by default.
- Timeout kills execution.

### Epic 4.3: npm Dynamic Phase

Stories:

1. Run install lifecycle in sandbox for npm package when requested.
2. Capture:
   - stdout
   - stderr
   - exit code
   - files written
   - spawned processes where visible

Acceptance:

- Real npm package lifecycle is executed in sandbox.
- No host secrets are present.

### Epic 4.4: PyPI Dynamic Phase

Stories:

1. Run safe install/build command for PyPI artifact in sandbox.
2. Capture same outputs.

Acceptance:

- Real PyPI artifact is analyzed.
- setup.py is not executed outside sandbox.

### Epic 4.5: Sandbox Verdict

Stories:

1. Feed sandbox summary to Mind.
2. Update final verdict.

Acceptance:

- Sandbox evidence appears in final report.
- If sandbox detects hard-block behavior, verdict becomes `block`.

## 12. Sprint 5: nabu Mind Production Kernel

Duration: 1 week.

Goal:

- Apollo-style Mind is reusable across Guard, Vault, Run, and Apps.

### Epic 5.1: Mind Step Engine

Stories:

1. Implement step types:
   - `plan`
   - `gather`
   - `critique`
   - `decide`
   - `report`
2. Store every step.
3. Attach evidence refs.

Acceptance:

- Every Mind run has inspectable steps.
- Every BTL call is tied to a step.

### Epic 5.2: RetainDB Memory

Stories:

1. Write decision memory after completed Mind run.
2. Search prior memories before decision.
3. Store user policy preferences.

Acceptance:

- Same user preferences affect later decisions.
- Memory search calls RetainDB, not local fake memory.

### Epic 5.3: Mind API

Stories:

1. `POST /v1/mind/runs`.
2. `GET /v1/mind/runs/:id`.
3. Support context refs:
   - Guard audit
   - package version
   - deployment policy

Acceptance:

- User can ask if a real package should be used in production.
- Mind cites Guard evidence.

## 13. Sprint 6: nabu Vault

Duration: 1 week.

Goal:

- SecretAgent layer protects keys and enables scoped agent execution.

### Epic 6.1: Secret Provider Adapter

Stories:

1. Implement `SecretProvider` interface.
2. Implement Infisical provider.
3. Optional: implement Vault KV v2 provider.

Acceptance:

- Store secret.
- Resolve secret by handle internally.
- Public API never returns raw secret after creation.

### Epic 6.2: Policy Engine

Stories:

1. Define secret policies:
   - allowed agents
   - allowed tools
   - max reads
   - expiry
2. Enforce policies on every secret read.

Acceptance:

- Unauthorized agent cannot read secret.
- Expired secret cannot be used.

### Epic 6.3: Secret Audit Logs

Stories:

1. Record every secret access.
2. Emit OpenTelemetry span.
3. Write RetainDB agent memory event for important secret accesses.

Acceptance:

- User can see which agent used a secret and when.
- No secret values in logs.

## 14. Sprint 7: nabu Run

Duration: 1 week.

Goal:

- Deploy real agents with Guard and Vault enforced.

### Epic 7.1: Agent Model

Stories:

1. Create `agents` table.
2. Create `agent_deployments` table.
3. Create `agent_jobs` table.

Acceptance:

- Agent can be created through API.
- Agent deployment persists.

### Epic 7.2: Skill Install Gate

Stories:

1. Agent deployment includes skills.
2. Run calls Guard for every skill.
3. Deployment fails if policy fails.

Acceptance:

- Blocked package prevents deployment.
- Warn package requires explicit policy allowing warn.
- Allowed package proceeds.

### Epic 7.3: Vault Binding

Stories:

1. Deployment binds secret handles.
2. Agent job runtime resolves secrets only through Vault.

Acceptance:

- Agent can call BTL Runtime using a scoped secret.
- Agent cannot print secret.

### Epic 7.4: Job Execution

Stories:

1. Enqueue agent job.
2. Execute actual job.
3. Persist logs, trace, usage.

Acceptance:

- Job calls BTL Runtime.
- Job writes RetainDB memory.
- Job result is retrievable.

## 15. Sprint 8: nabu Apps - Pulse

Duration: 1 week.

Goal:

- First user-facing app proves the OS works.

Pulse should avoid fake trading. It should produce real intelligence from real data sources selected during implementation.

Minimum viable real app:

- User configures:
  - watchlist of public package names and/or GitHub repos initially
  - later wallet/token watchlist if reliable data provider is selected
- Pulse runs scheduled Mind jobs.
- Pulse emits webhooks or dashboard alerts.

Recommended first Pulse domain:

- Package/security intelligence, not DeFi, because Guard is already in v1.

Pulse v1 use case:

- "Watch these npm/PyPI packages and alert me if a new version increases risk."

Why this is better than fake market data:

- Uses same Guard layer.
- Uses real registries.
- Uses real OSV/deps.dev.
- Immediately useful.
- Lower data-provider risk.

Stories:

1. User creates Pulse watchlist.
2. Pulse checks latest versions from npm/PyPI.
3. Pulse triggers Guard audit on new version.
4. Mind compares previous version vs new version.
5. User receives alert.

Acceptance:

- Real package release data.
- Real Guard audit.
- Real Mind comparison.
- Real webhook delivery.

## 16. Sprint 9: Public Developer Experience

Duration: 1 week.

Goal:

- nabuOS is usable by external developers.

### Epic 9.1: CLI

Commands:

- `nabu auth login`
- `nabu guard audit npm axios@1.6.0`
- `nabu guard audit pypi requests==2.31.0`
- `nabu guard check npm axios@1.6.0`
- `nabu mind run --audit aud_...`
- `nabu run deploy agent.yaml`

Acceptance:

- CLI calls real hosted API.
- CLI never contains local fake scanner.

### Epic 9.2: SDK

Package:

- `@nabuos/sdk`

Methods:

- `guard.audit()`
- `guard.check()`
- `mind.run()`
- `vault.createSecret()`
- `run.deployAgent()`

Acceptance:

- SDK examples work against staging.

### Epic 9.3: Docs

Docs:

- Quickstart.
- Guard npm.
- Guard PyPI.
- Mind decision.
- Run agent.
- Vault policies.
- Webhooks.

Acceptance:

- Every docs example works against staging with real packages.

## 17. Sprint 10: Latency and Reliability Hardening

Duration: 1 week.

Goal:

- Make nabuOS feel fast enough for real use.

Stories:

1. Add Redis or in-memory edge cache for `GET /guard/check`.
2. Add request coalescing:
   - same audit requested concurrently returns same job.
3. Add artifact cache.
4. Add OSV/deps.dev cache TTL policy.
5. Add BTL prompt cache optimization.
6. Add background refresh for popular packages.

Acceptance:

- Cached check p95 < 150 ms.
- Duplicate audit request does not trigger duplicate upstream calls.
- Deep audit runs async.

## 18. Sprint 11: Security Hardening

Duration: 1 week.

Goal:

- Make the security product itself defensible.

Stories:

1. API key scopes.
2. Rate limiting.
3. Input validation for package names.
4. SSRF protection for artifact downloads.
5. Object storage malware-safe handling.
6. Sandbox escape monitoring.
7. Secret leak tests.
8. Prompt injection checks for package README/content.

Acceptance:

- Package metadata cannot force arbitrary URL downloads outside registry URLs.
- README text cannot override Guard system prompt.
- Secret value never appears in logs/traces/reports.

## 19. Sprint 12: Beta Launch

Duration: 1 week.

Goal:

- Launch nabu Guard + Mind + Pulse beta.

Launch scope:

- Public Guard API for npm and PyPI.
- Public Mind API over Guard audits.
- Pulse package watch app.
- Run private beta.
- Vault internal.

Acceptance:

- 10 real npm packages audited.
- 10 real PyPI packages audited.
- 3 package watchlists running.
- All audits use real upstreams.
- Public status page exists.

## 20. Backlog After Beta

High priority:

1. MCP/agent skill manifest auditing.
2. GitHub repository audit from package repository metadata.
3. GitHub Actions workflow scan.
4. npm provenance/signature verification where available.
5. PyPI trusted publishing/provenance checks where available.
6. SBOM generation.
7. SARIF export.
8. GitHub App integration.
9. CI gate:
   - GitHub Action
   - GitLab CI
   - npm preinstall hook
10. Enterprise Vault provider.

Medium priority:

1. Wallet/on-chain agent policy.
2. x402 payments.
3. Agent marketplace.
4. DeFi Pulse app.
5. Public report pages.
6. IPFS report publication.

Low priority:

1. Custom domains.
2. Phone/email provisioning.
3. Full AgentOS-style 50+ endpoint infra.

## 21. Risk Register

### Risk: LLM hallucination in Guard

Mitigation:

- LLM cannot create deterministic findings.
- LLM can only classify and explain evidence produced by deterministic phases.
- Every LLM finding must cite file path/metadata field.
- Invalid citation lowers confidence.

### Risk: Sandbox escape

Mitigation:

- gVisor runtime.
- No host Docker socket.
- No secrets.
- Network disabled by default.
- Resource limits.
- Dedicated worker hosts.

### Risk: Upstream API outage

Mitigation:

- Cache successful results.
- Phase status can be degraded.
- Guard reports include source availability.

### Risk: Slow audits

Mitigation:

- Progressive verdicts.
- Fast/deep/sandbox tiers.
- deps.dev graph.
- OSV batch.
- artifact cache.
- request coalescing.

### Risk: Secret leak

Mitigation:

- Secret handles only.
- Log redaction.
- OTel attribute allowlist.
- Vault audit events.

### Risk: Bad package names causing SSRF/path traversal

Mitigation:

- Strict ecosystem-specific name validation.
- Only download registry-declared tarballs/file URLs.
- Verify URLs match allowed hosts:
  - `registry.npmjs.org`
  - npm tarball host from metadata
  - `files.pythonhosted.org`
  - `pypi.org`
- Extract archives with zip-slip/tar-slip protection.

## 22. Concrete First Build Order

If starting today:

1. ~~Build `guard-service` npm fast audit.~~ **In progress** — Epic 1.1 done; continue 1.2 artifact download.
2. Add OSV/deps.dev.
3. Add BTL triage.
4. Add PyPI adapter.
5. Add Mind API over Guard reports.
6. Add Semgrep deep phase.
7. Add Vault (Infisical provider when provisioned; env-secrets covers v0).
8. Add Run.
9. Add Pulse package watch.
10. Add gVisor sandbox.

**Completed so far (2026-07-04):** Sprint 0 foundation, BTL client, env-based vault hack, npm metadata adapter + guard routes.

Reason:

- Guard is both public service and OS gate.
- Mind becomes useful once Guard has real evidence.
- Vault/Run need Guard to be meaningful.
- Pulse package watch is the first app that avoids fake data and uses real product layers.

## 23. Engineering Principles

- Deterministic before probabilistic.
- Registry truth before LLM interpretation.
- Store raw evidence before summaries.
- Every user-visible verdict must be reproducible.
- Every external call has timeout, retry policy, and trace span.
- Every async job is idempotent.
- Every artifact has a content hash.
- Every secret access has an audit event.
- Every agent install is Guard-gated.
- Every agent decision is Mind-mediated.

## 24. Final MVP Definition

nabuOS MVP is complete when:

- A public user can audit a real npm package.
- A public user can audit a real PyPI package.
- A public user can ask Mind to decide whether a package should be used.
- nabuOS Run refuses to deploy an agent with a blocked package.
- nabuOS Vault stores and scopes real BTL Runtime keys.
- nabuOS Pulse watches real package releases and alerts on risk changes.
- All LLM calls go through BTL Runtime.
- RetainDB stores user and agent memory.
- OpenTelemetry traces show end-to-end audit and decision latency.
- No demo path depends on fake data, mocks, or simulations.
