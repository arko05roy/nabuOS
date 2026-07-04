import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BasicTracerProvider, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const resource = new Resource({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'nabuos',
});

const instrumentations = [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { requireParentSpan: true },
  }),
];

function createTraceExporter() {
  const kind = process.env.OTEL_TRACES_EXPORTER ?? 'console';
  if (kind === 'none') return undefined;
  if (kind === 'otlp') return new OTLPTraceExporter();
  return new ConsoleSpanExporter();
}

const exporterKind = process.env.OTEL_TRACES_EXPORTER ?? 'console';

const shutdown =
  exporterKind === 'none'
    ? (() => {
        const provider = new BasicTracerProvider({ resource });
        provider.register();
        registerInstrumentations({ instrumentations });
        return () => provider.shutdown();
      })()
    : (() => {
        const sdk = new NodeSDK({
          resource,
          traceExporter: createTraceExporter(),
          instrumentations,
        });
        sdk.start();
        return () => sdk.shutdown();
      })();

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});
