import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

function createTraceExporter() {
  const kind = process.env.OTEL_TRACES_EXPORTER ?? 'console';
  if (kind === 'none') return undefined;
  if (kind === 'otlp') return new OTLPTraceExporter();
  return new ConsoleSpanExporter();
}

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'nabuos',
  }),
  traceExporter: createTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { requireParentSpan: true },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  void sdk.shutdown().finally(() => process.exit(0));
});
