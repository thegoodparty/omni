import { Alert } from './alerts.types'

/**
 * SES account reputation. Both rules sit below SES's own review lines (5%
 * bounces, 0.1% complaints), so they warn before SES acts on the whole
 * account. Per-organization pauses are handled in the app and by SES tenants;
 * these two watch the account as a whole.
 *
 * gp-api reads the account's `AWS/SES` `Reputation.*` metrics from CloudWatch
 * every 5 minutes on every prod task (`SesReputationReportService`) and
 * exports the newest datapoint from the last 3 hours as a gauge. `max` across
 * tasks, since every task reads the same account number.
 *
 * Absence is healthy: with no datapoint in 3 hours a task stops exporting the
 * gauge, and `noDataState: OK` (grafana.ts) keeps that quiet. A failed read
 * keeps exporting the last real answer, and `last_over_time` carries each
 * task's last answer across a deploy or a missed read, so neither resolves a
 * firing alert on a number nobody read.
 *
 * The metric is published in 5-minute buckets, so `for: 15m` is three buckets
 * above the line in a row. One noisy datapoint, a small send with a bad
 * start, does not page.
 */
const SELECTOR = 'service_name="gp-api", deployment_environment_name="$ENV"'

const latestReading = (metric: string) =>
  `max(last_over_time(${metric}{${SELECTOR}}[15m]))`

export const sesReputationAlerts: Alert[] = [
  {
    slug: 'ses-bounce-rate',
    name: 'SES account bounce rate high',
    type: 'metric',
    expr: latestReading('ses_account_bounce_rate'),
    threshold: 0.03,
    for: '15m',
    execErrState: 'KeepLast',
    timeRangeSeconds: 10800,
    message: [
      'The SES account bounce rate is above **3%**. SES puts an account under review at 5%.',
      'Outreach email sends as one SES tenant per organization, so find the send driving it: in CloudWatch, `AWS/SES` `Bounce` by the `outreachEmailId` dimension, then pause that send from the gp-admin Email sends page.',
    ].join('\n\n'),
  },
  {
    slug: 'ses-complaint-rate',
    name: 'SES account complaint rate high',
    type: 'metric',
    expr: latestReading('ses_account_complaint_rate'),
    threshold: 0.0006,
    for: '15m',
    execErrState: 'KeepLast',
    timeRangeSeconds: 10800,
    message: [
      'The SES account complaint rate is above **0.06%**. SES puts an account under review at 0.1%.',
      'Outreach email sends as one SES tenant per organization, so find the send driving it: in CloudWatch, `AWS/SES` `Complaint` by the `outreachEmailId` dimension, then pause that send from the gp-admin Email sends page.',
    ].join('\n\n'),
  },
]
