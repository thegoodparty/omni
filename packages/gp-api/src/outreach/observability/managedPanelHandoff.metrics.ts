import { Logger } from '@nestjs/common'
import { metrics } from '@opentelemetry/api'

// Same meter pattern as managedPanelFunding.metrics.ts: no-op without OTLP
// export, and a record can never break the caller.
const logger = new Logger('ManagedPanelHandoffMetrics')

const isOtelEnabled = (): boolean =>
  Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)

const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

// Prometheus (via Grafana Cloud OTLP) exposes this as
// managed_panel_handoff_alarm_count_total{kind=...}.
export const MANAGED_PANEL_HANDOFF_ALARM_METRIC =
  'managed_panel_handoff_alarm_count_total'

const alarmCounter = metrics
  .getMeter('gp-api')
  .createCounter('managed_panel.handoff_alarm.count', {
    description:
      'Text hand-off rows that need a person, by kind. Each sweep adds the ' +
      'rows it finds, so a row that stays stuck keeps the alarm firing',
  })

// needs_human: `queued` rows flagged overdue, until their replies come in
export type ManagedPanelHandoffAlarm = 'needs_human'

const ALARMS: ManagedPanelHandoffAlarm[] = ['needs_human']

// Prometheus `increase()` cannot see the first sample of a new series, so
// write a zero at boot for the first real event to rise from.
if (isOtelEnabled()) {
  for (const kind of ALARMS) {
    alarmCounter.add(0, { kind, environment: environment() })
  }
}

export const recordManagedPanelHandoffAlarm = (
  kind: ManagedPanelHandoffAlarm,
  count: number,
): void => {
  if (!isOtelEnabled() || count === 0) return
  try {
    alarmCounter.add(count, { kind, environment: environment() })
  } catch (error) {
    logger.error('Failed to record managed panel handoff alarm', error)
  }
}
