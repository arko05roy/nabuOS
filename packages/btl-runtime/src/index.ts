import type { BtlChatCompletionResult, BtlResponseHeaders } from '@nabuos/types';

const DEFAULT_BASE_URL = 'https://api.badtheorylabs.com/v1';

export interface BtlRuntimeConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class BtlRuntimeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'BtlRuntimeError';
  }
}

/** Parse x-btl-* proof headers from a live Runtime response. */
export function parseBtlHeaders(headers: Headers): BtlResponseHeaders {
  const num = (key: string) => {
    const v = headers.get(key);
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return {
    request_id: headers.get('x-btl-request-id') ?? undefined,
    cache_tier: headers.get('x-btl-cache-tier') ?? undefined,
    benchmark_cost: num('x-btl-benchmark-cost'),
    customer_charge: num('x-btl-customer-charge'),
    saved: num('x-btl-saved'),
  };
}

export function createBtlRuntime(config: BtlRuntimeConfig) {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...init?.headers,
      },
    });
    return res;
  }

  /** Lightweight readiness probe — lists models without a completion charge. */
  async function ping(): Promise<{ ok: true; model_count: number }> {
    const res = await request('/models');
    if (!res.ok) {
      const body = await res.text();
      throw new BtlRuntimeError(
        `BTL GET /models failed: ${res.status}`,
        res.status,
        body,
      );
    }
    const data = (await res.json()) as { data?: unknown[] };
    return { ok: true, model_count: data.data?.length ?? 0 };
  }

  async function chatCompletion(input: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
  }): Promise<BtlChatCompletionResult> {
    const payload: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
    };
    if (input.temperature !== undefined) {
      payload.temperature = input.temperature;
    }

    const res = await request('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const headers = parseBtlHeaders(res.headers);
    const raw = await res.json();

    if (!res.ok) {
      throw new BtlRuntimeError(
        `BTL POST /chat/completions failed: ${res.status}`,
        res.status,
        JSON.stringify(raw),
      );
    }

    const completion = raw as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    return {
      model: completion.model ?? input.model,
      content: completion.choices?.[0]?.message?.content ?? null,
      headers,
      raw,
    };
  }

  return { ping, chatCompletion, parseBtlHeaders };
}

/** ponytail: smallest check that header parsing did not rot */
export function parseBtlHeadersSelfCheck(): void {
  const parsed = parseBtlHeaders(
    new Headers({
      'x-btl-request-id': 'req_test',
      'x-btl-cache-tier': 'exact_response_cache',
      'x-btl-customer-charge': '0.01',
      'x-btl-saved': 'not-a-number',
    }),
  );
  if (parsed.request_id !== 'req_test' || parsed.customer_charge !== 0.01) {
    throw new Error('parseBtlHeadersSelfCheck failed');
  }
  if (parsed.saved !== undefined) {
    throw new Error('parseBtlHeadersSelfCheck: invalid numeric should be omitted');
  }
}

export function btlRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof createBtlRuntime> | null {
  const apiKey = env.GATEWAY_API_KEY;
  if (!apiKey) return null;
  return createBtlRuntime({
    apiKey,
    baseUrl: env.BTL_RUNTIME_BASE_URL,
  });
}
