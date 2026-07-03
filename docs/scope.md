# nabuOS v0 scope cut

Sprint 0 external dependencies are **BTL Runtime only**.

| Planned | Status | Workaround |
|---------|--------|------------|
| BTL Runtime | **Active** | `GATEWAY_API_KEY` in `.env`, `@nabuos/btl-runtime` |
| RetainDB | **Deferred** | No memory persistence until key arrives; Mind/Guard store evidence in Postgres later |
| Infisical / Vault | **Deferred** | `secret://env/*` handles resolve from process env only |

Secrets never enter prompts, logs, or API responses. Vault service exposes handles only.
