import { metrics } from '@opentelemetry/api'
import type { SesAccountReputation } from '../services/ses.service'

// The SES account's Reputation.BounceRate and Reputation.ComplaintRate, as
// observable gauges the `ses-bounce-rate` and `ses-complaint-rate` Grafana
// rules read. Prometheus (via Grafana Cloud OTLP) exposes them as:
//   ses_account_bounce_rate{service_name="gp-api",deployment_environment_name}
//   ses_account_complaint_rate{...}
//
// Observable, not a plain gauge, so a rate CloudWatch has no datapoint for
// stops being exported instead of repeating forever. A plain gauge keeps
// exporting its last value for the life of the task.
const environment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT || 'local'

let latest: SesAccountReputation = { bounceRate: null, complaintRate: null }

export const setSesAccountReputation = (
  reputation: SesAccountReputation,
): void => {
  latest = reputation
}

export const sesAccountReputation = (): SesAccountReputation => latest

const meter = metrics.getMeter('gp-api')

meter
  .createObservableGauge('ses_account_bounce_rate', {
    description: 'SES account Reputation.BounceRate, latest datapoint',
  })
  .addCallback((result) => {
    if (latest.bounceRate === null) return
    result.observe(latest.bounceRate, { environment: environment() })
  })

meter
  .createObservableGauge('ses_account_complaint_rate', {
    description: 'SES account Reputation.ComplaintRate, latest datapoint',
  })
  .addCallback((result) => {
    if (latest.complaintRate === null) return
    result.observe(latest.complaintRate, { environment: environment() })
  })
