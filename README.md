# nabuOS

Agent operating system: Guard (package security), Vault (secrets), Run (deploy), Mind (decisions), Apps (Pulse).

See [nabuOS_AGILE_PLAN.md](./nabuOS_AGILE_PLAN.md) for the full roadmap.

**v0 scope:** BTL Runtime only as external service. RetainDB and Infisical deferred — see [docs/scope.md](./docs/scope.md).

## Sprint 0 — monorepo skeleton

```bash
pnpm install
pnpm build
```

Start a service (example):

```bash
pnpm --filter @nabuos/guard dev
curl http://127.0.0.1:3001/healthz
```

Default ports:

| Service         | Port | `/readyz` checks        |
|-----------------|------|-------------------------|
| api-gateway     | 3100 | process                 |
| guard           | 3001 | process                 |
| mind            | 3002 | process + BTL `/models` |
| vault           | 3003 | process                 |
| run             | 3004 | process                 |
| sandbox-worker  | 3005 | process                 |

Verify health (services must be running):

```bash
pnpm health:check
```

BTL smoke test (requires `GATEWAY_API_KEY` in `.env`):

```bash
pnpm smoke:btl
```

See [docs/btl-runtime.md](./docs/btl-runtime.md) for key provisioning.

## Layout

```
apps/web              # Pulse UI (later)
services/api-gateway  # Public REST entry
services/guard        # Package audit pipeline
services/mind         # Apollo decision kernel
services/vault        # SecretAgent layer
services/run          # Synapze deploy plane
services/sandbox-worker
packages/types        # Shared domain types
packages/sdk          # Public client (stub)
packages/service-kit  # Health/readiness helpers
infra/                # Deployment manifests
docs/                 # Developer docs
```
