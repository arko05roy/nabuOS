# BTL Runtime (Epic 0.2)

nabuOS routes every LLM call through [BTL Runtime](https://runtime.badtheorylabs.com/docs).

## Provision a workspace key

1. Create a workspace at [runtime.badtheorylabs.com](https://runtime.badtheorylabs.com/docs) → **Create workspace**.
2. Open **Dashboard / API keys** and create a **machine key** with the **`inference`** scope.
3. Copy the key into your local `.env` (never commit it):

```bash
cp .env.example .env
# edit .env:
GATEWAY_API_KEY=your_machine_key_here
```

Optional override:

```bash
BTL_RUNTIME_BASE_URL=https://api.badtheorylabs.com/v1
BTL_SMOKE_MODEL=btl-2
```

## API surface (OpenAI-compatible)

| Route | Purpose |
|-------|---------|
| `POST /v1/chat/completions` | Primary inference path |
| `POST /v1/responses` | Responses API |
| `GET /v1/models` | Model catalog (used for readiness) |
| `GET /v1/providers` | Connected providers |
| `GET /v1/account/pricing` | Pricing |
| `GET /v1/usage/summary` | Usage |

Base URL: `https://api.badtheorylabs.com/v1`  
Auth: `Authorization: Bearer $GATEWAY_API_KEY`

## Response proof headers

Every completion returns economics headers nabuOS persists on Mind/Guard decisions:

- `x-btl-request-id`
- `x-btl-cache-tier`
- `x-btl-benchmark-cost`
- `x-btl-customer-charge`
- `x-btl-saved`

## Smoke test

```bash
pnpm build
node --env-file=.env scripts/smoke-btl.mjs
```

## Client package

`@nabuos/btl-runtime` wraps live HTTP — no mocked responses.

**Note:** Do not send `temperature: 0` to `btl-2` unless required — BTL can return `gateway_internal_error` (500). Omit `temperature` for triage/smoke; set explicitly only when needed.

```typescript
import { createBtlRuntime } from '@nabuos/btl-runtime';

const btl = createBtlRuntime({ apiKey: process.env.GATEWAY_API_KEY! });
const result = await btl.chatCompletion({
  model: 'btl-2',
  messages: [{ role: 'user', content: '...' }],
});
// result.headers.request_id → store with nabu trace ID
```

## mind-service readiness

`GET /readyz` on mind (port 3002) calls live `GET /v1/models`. Without `GATEWAY_API_KEY` it returns **503** with `checks.btl_runtime: fail` — not a fake ready state.
