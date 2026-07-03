#!/usr/bin/env node
/**
 * Live BTL Runtime smoke test — calls POST /v1/chat/completions for real.
 * Usage: node --env-file=.env scripts/smoke-btl.mjs
 */
import { createBtlRuntime } from '../packages/btl-runtime/dist/index.js';

const apiKey = process.env.GATEWAY_API_KEY;
if (!apiKey) {
  console.error('GATEWAY_API_KEY is required. Copy .env.example to .env and add your machine key.');
  process.exit(1);
}

const model = process.env.BTL_SMOKE_MODEL ?? 'btl-2';
const client = createBtlRuntime({
  apiKey,
  baseUrl: process.env.BTL_RUNTIME_BASE_URL,
});

console.log(`ping GET /models...`);
const ping = await client.ping();
console.log(`models: ${ping.model_count}`);

console.log(`chat POST /chat/completions model=${model}...`);
let result;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    result = await client.chatCompletion({
      model,
      messages: [
        { role: 'user', content: 'Say hello from my Runtime workspace.' },
      ],
    });
    break;
  } catch (err) {
    if (attempt === 2) throw err;
    console.warn(`attempt ${attempt} failed, retrying...`, err instanceof Error ? err.message : err);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

console.log(
  JSON.stringify(
    {
      model: result.model,
      content: result.content,
      btl: result.headers,
    },
    null,
    2,
  ),
);

if (!result.content) {
  console.error('empty completion content');
  process.exit(1);
}

if (!result.headers.request_id) {
  console.warn('warn: x-btl-request-id absent on this response (cost headers may still be present)');
}

console.log('btl smoke ok');
