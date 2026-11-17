import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// Every way an agent can fail to produce its output, logged and counted. It is
// the failure nothing else would notice: the run ends, the product's table
// simply does not change, and the only trace is a row nobody is watching.
// Daniel asked for a sustained rate of these to page, which is the rule in
// deploy/components/alerting/agent-alerts.ts reading this counter.
//
// Follows the gp-api meter pattern (observability/grafana/otel.client.ts): one
// module-scoped meter, a no-op without OTLP export, and every record wrapped so
// instrumentation can never break a run.
const logger = new Logger('AgentMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const meter = metrics.getMeter('gp-api')

// Prometheus (via Grafana Cloud OTLP) exposes this as
//   agent_output_failure_total{agent=...,stage=...,environment=...}
const outputFailureCounter = meter.createCounter('agent.output_failure', {
  description: 'Agent submissions and runs that produced no accepted output',
})

/**
 * Where the output was refused:
 *  - `submitOutput`: the model submitted output that failed the output schema.
 *    It is told what was wrong and retries, so one is routine; a sustained rate
 *    means a prompt or a schema the model cannot satisfy.
 *  - `noOutput`: the run gave up without an accepted output — its nudges, its
 *    step budget or the output limit ran out.
 */
export type OutputFailureStage = 'submitOutput' | 'noOutput'

export const recordOutputFailure = (
  agentName: string,
  stage: OutputFailureStage,
  detail: string,
): void => {
  logger.warn({ agent: agentName, stage, detail }, 'agent produced no output')
  if (!isOtelEnabled()) return
  try {
    outputFailureCounter.add(1, {
      agent: agentName,
      stage,
      environment: process.env.OTEL_SERVICE_ENVIRONMENT || 'local',
    })
  } catch (error) {
    logger.error('Failed to record an agent output failure', error)
  }
}
