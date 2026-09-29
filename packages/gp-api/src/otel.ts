import { metrics } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_INSTANCE_ID } from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import {
  AggregationType,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordProcessor,
} from '@opentelemetry/sdk-logs'
import type { SdkLogRecord } from '@opentelemetry/sdk-logs/build/src/export/SdkLogRecord'
import type { Attributes, Context } from '@opentelemetry/api'
import { PrismaInstrumentation } from '@prisma/instrumentation'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core'
import { HostMetrics } from '@opentelemetry/host-metrics'
import { FastifyOtelInstrumentation } from '@fastify/otel'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
// Relative, not the `@/` alias: this module is preloaded with `node -r` before
// any path-alias resolver is registered.
import { isDbxStatementPoll } from './observability/otel/dbxStatementPoll'
import { otelResourceAttributes } from './observability/otel/resource'

/**
 * Why we want this:
 *
 * The default pino instrumentation packages parse the JSON log body, and
 * take this behavior:
 * - send the `msg` key as the log body
 * - send the rest of the keys as attributes/"labels"
 *
 * This is problematic for us, for a few reasons:
 * - Grafana prices based on cardinality of labels
 * - by removing non-msg keys, you can't easily use simple "line contains" queries
 *   (e.g. "show me all logs containing 'error' or '500')
 *
 * By taking this approach, we get:
 * - controlled cost, by reducing label cardinality
 * - ability to use simple "line contains" queries
 * - still flexibilty to do structured queries by just adding a
 *   "json parse" step to any Loki query
 *
 * It also folds `service_instance_id` into that body. The log resource
 * deliberately omits `service.instance.id` (see the resource comment below),
 * and this is the only place the value survives on a log line:
 * `| json | service_instance_id = "..."` still narrows to one task.
 */
class JsonBodyLogRecordProcessor implements LogRecordProcessor {
  constructor(
    private readonly delegate: LogRecordProcessor,
    private readonly serviceInstanceId: string | undefined,
  ) {}

  onEmit(logRecord: SdkLogRecord, context?: Context): void {
    const jsonBody: Record<string, unknown> = {}
    if (logRecord.body !== undefined) {
      jsonBody.msg = logRecord.body
    }
    for (const [key, value] of Object.entries(logRecord.attributes)) {
      jsonBody[key] = value
    }
    jsonBody.service_instance_id = this.serviceInstanceId
    logRecord.setBody(JSON.stringify(jsonBody))
    this.delegate.onEmit(logRecord, context)
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush()
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown()
  }
}

const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS

declare global {
  var __fastifyOtelInstrumentation: FastifyOtelInstrumentation | undefined
}

if (!headers) {
  console.warn('OpenTelemetry disabled: Missing OTEL_EXPORTER_OTLP_HEADERS')
} else {
  const endpoint = 'https://otlp-gateway-prod-us-east-3.grafana.net/otlp'
  const fastifyOtelInstrumentation = new FastifyOtelInstrumentation()
  global.__fastifyOtelInstrumentation = fastifyOtelInstrumentation

  const parsedHeaders = Object.fromEntries(
    headers.split(',').map((pair) => {
      const idx = pair.indexOf('=')
      return [pair.slice(0, idx), pair.slice(idx + 1)]
    }),
  )

  // Every exporting process MUST be its own metric series, and this attribute
  // is the only thing that makes it one. Prod runs two tasks (service.ts
  // `desiredCount`), and with `autoDetectResources: false` they otherwise
  // export byte-identical resource attributes — so both tasks' CUMULATIVE
  // counters land on a single Prometheus series that oscillates between the two
  // running totals. Every step down reads as a counter reset to rate() and
  // increase(), which then add the whole subsequent value again.
  //
  // That is not a rounding error. On person_profile.completion_request_event
  // the raw series ran 1..3 over 24h while increase()[24h] returned 1702, and
  // the 1702 cleared a `> 20` volume floor that existed precisely to stop a
  // ratio alert firing on a handful of samples. Any rate()/increase() rule over
  // a gp-api counter was reading invented numbers before this.
  //
  // os.hostname() is the container id under ECS awsvpc and is stable for the
  // task's lifetime, so series churn when a task is replaced (a real new
  // instance, whose counters genuinely start at zero) rather than per export.
  // The cost is one series per task per metric, which is the price of the
  // counters being arithmetic rather than decorative.
  //
  // This resource carries METRICS and TRACES only. Logs get `logResource`
  // below — the same attributes minus the instance id — because Loki
  // promotes a fixed set of resource attributes to stream labels and
  // service.instance.id is one of them
  // (https://grafana.com/docs/loki/latest/send-data/otel/#format-considerations).
  // On logs it therefore multiplies our stream count by the fleet size against
  // a hard account cap of 5,000 active streams
  // (`max_global_streams_per_user`, measured), which is a different failure
  // than the metric one above and pulls the opposite way.
  const resourceAttributes = otelResourceAttributes({
    includeInstanceId: true,
  })
  const resource = resourceFromAttributes(resourceAttributes)

  const prismaConnectionMetricProcessor: SpanProcessor = {
    onStart: () => undefined,
    onEnd: (span: ReadableSpan) => {
      if (span.name !== 'prisma:engine:connection') return
      const durationMs =
        (span.endTime[0] - span.startTime[0]) * 1e3 +
        (span.endTime[1] - span.startTime[1]) / 1e6
      prismaConnectionDuration.record(durationMs)
      if (durationMs > 150) {
        prismaSlowConnections.add(1)
      }
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }

  const HIGH_CARDINALITY_SPAN_ATTRS = [
    'net.host.name',
    'net.host.ip',
    'net.peer.name',
    'net.peer.ip',
    'http.host',
    'host.name',
    'host.id',
    // SPAN attributes only, which is why this does not contradict the
    // service.instance.id on the resource above: per-span instance identity is
    // unbounded churn on traces, while the RESOURCE attribute is one value per
    // task and is what keeps the metric counters addable.
    'service.instance.id',
    // Undici emits stable-semconv names, so the old list above does not reach
    // it. `url.full` and `url.query` carry statement ids, chunk indexes and
    // bearer-adjacent query strings; `network.peer.*` is a resolved IP that
    // changes per connection. `server.address` is deliberately NOT scrubbed —
    // it is the bounded set of vendor hostnames, and it is the whole reason
    // these spans are worth having.
    'url.full',
    'url.query',
    'network.peer.address',
    'network.peer.port',
  ]
  const cardinalityScrubProcessor: SpanProcessor = {
    onStart: () => undefined,
    onEnd: (span: ReadableSpan) => {
      const attrs = span.attributes as Attributes
      for (const attr of HIGH_CARDINALITY_SPAN_ATTRS) {
        delete attrs[attr]
      }
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }

  // HttpInstrumentation only patches node's `http`/`https`. Everything that
  // talks over global fetch — the Databricks voter path, the Anthropic calls
  // behind the AI SDK, Clerk, @google/genai — was therefore invisible in Tempo,
  // showing up as an unexplained gap between spans rather than a named
  // dependency. That gap is the dominant cost on the contacts routes, so the
  // traces were missing the one span worth looking at.
  //
  // Databricks statement polling is excluded: `startCsvExport` uses
  // `wait_timeout: 0s` and then polls every 500ms up to the 60s ceiling, which
  // is ~120 identical GETs for a single export. Traces are unsampled, so that
  // is real ingest for no information — the wait is already covered end to end
  // by the `databricks.statement` span in PeopleDbxStatementClient. The submit
  // POST and the chunk fetches are NOT excluded; those carry the payload.
  const undiciInstrumentation = new UndiciInstrumentation({
    ignoreRequestHook: (request) =>
      isDbxStatementPoll(request.method, request.path),
  })

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers: parsedHeaders,
  })

  // Logs are exported through a LoggerProvider we own, registered globally
  // BEFORE NodeSDK is constructed, because NodeSDK has exactly one `resource`
  // and would build the log pipeline from the one above. Two things make this
  // hold, and both are load-bearing:
  //   - OTEL_LOGS_EXPORTER=none makes NodeSDK's env-driven log config return
  //     without configuring anything, so start() never overwrites the global
  //     provider set here. It is read in the NodeSDK constructor, so it has to
  //     be set before that line, not before start().
  //   - registerInstrumentations() falls back to logs.getLoggerProvider(), so
  //     PinoInstrumentation binds to this provider as long as it is global
  //     first.
  // Get the order wrong and gp-api ships no logs at all.
  const logResource = resourceFromAttributes(
    otelResourceAttributes({ includeInstanceId: false }),
  )
  const loggerProvider = new LoggerProvider({
    resource: logResource,
    processors: [
      new JsonBodyLogRecordProcessor(
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: `${endpoint}/v1/logs`,
            headers: parsedHeaders,
          }),
        ),
        resourceAttributes[ATTR_SERVICE_INSTANCE_ID],
      ),
    ],
  })
  logs.setGlobalLoggerProvider(loggerProvider)
  process.env.OTEL_LOGS_EXPORTER = 'none'

  const sdk = new NodeSDK({
    autoDetectResources: false,
    resource,
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
        headers: parsedHeaders,
      }),
      exportIntervalMillis: 60_000,
    }),
    views: [
      {
        instrumentName: 'http.server.*',
        aggregation: { type: AggregationType.DROP },
      },
      {
        instrumentName: 'http.client.*',
        aggregation: { type: AggregationType.DROP },
      },
    ],
    spanProcessors: [
      cardinalityScrubProcessor,
      new BatchSpanProcessor(traceExporter),
      prismaConnectionMetricProcessor,
    ],
    instrumentations: [
      new HttpInstrumentation(),
      undiciInstrumentation,
      new NestInstrumentation(),
      new PrismaInstrumentation(),
      new PinoInstrumentation(),
      new RuntimeNodeInstrumentation(),
      fastifyOtelInstrumentation,
    ],
  })

  sdk.start()

  const prismaConnectionDuration = metrics
    .getMeter('gp-api')
    .createHistogram('prisma.connection.duration', {
      description: 'Duration of prisma:engine:connection spans in milliseconds',
      unit: 'ms',
    })

  const prismaSlowConnections = metrics
    .getMeter('gp-api')
    .createCounter('prisma.connection.slow', {
      description: 'Count of prisma:engine:connection spans exceeding 150ms',
    })

  const hostMetrics = new HostMetrics()
  hostMetrics.start()

  process.on('SIGTERM', () => {
    Promise.all([sdk.shutdown(), loggerProvider.shutdown()]).catch((err) =>
      console.error('OTel shutdown error', err),
    )
  })
}
