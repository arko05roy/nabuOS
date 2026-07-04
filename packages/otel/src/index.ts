import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Span,
} from '@opentelemetry/api';
import type { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

export function getTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}

export function getSpanId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().spanId;
}

/** Inject W3C trace context into outbound fetch headers. */
export function injectTraceHeaders(headers: Headers): void {
  propagation.inject(context.active(), headers, {
    set(carrier, key, value) {
      carrier.set(key, value);
    },
  });
}

function finishSpan(span: Span, status: number, err?: unknown) {
  if (err instanceof Error) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  } else {
    span.setStatus({
      code: status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
  }
  span.setAttribute('http.status_code', status);
  span.end();
}

/** HTTP span per request; sets `x-trace-id` on responses. */
export function otelMiddleware(service?: string) {
  const tracer = trace.getTracer(service ?? 'nabuos');

  return createMiddleware(async (c, next) => {
    const parent = propagation.extract(context.active(), c.req.raw.headers);
    const route = `${c.req.method} ${c.req.path}`;

    return tracer.startActiveSpan(route, {}, parent, async (span) => {
      if (service) span.setAttribute('nabu.service', service);

      const traceId = span.spanContext().traceId;
      c.header('x-trace-id', traceId);

      try {
        await next();
        finishSpan(span, c.res.status);
      } catch (err) {
        finishSpan(span, 500, err);
        throw err;
      }
    });
  });
}

export function withTelemetry(app: Hono, service: string): Hono {
  app.use('*', otelMiddleware(service));
  return app;
}

export type NabuLogger = {
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
};

/** JSON logs with `trace_id` when a span is active. */
export function createLogger(service: string): NabuLogger {
  const write = (level: string, message: string, extra?: Record<string, unknown>) => {
    const line = JSON.stringify({
      level,
      service,
      trace_id: getTraceId(),
      span_id: getSpanId(),
      message,
      ...extra,
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    info: (message, extra) => write('info', message, extra),
    warn: (message, extra) => write('warn', message, extra),
    error: (message, extra) => write('error', message, extra),
  };
}
