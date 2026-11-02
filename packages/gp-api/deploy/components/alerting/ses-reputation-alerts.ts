import { Alert } from './alerts.types'

/**
 * SES account reputation, read from CloudWatch. Both rules sit below SES's own
 * review lines (5% bounces, 0.1% complaints), so they warn before SES acts on
 * the whole account. Per-organization pauses are handled in the app and by SES
 * tenants; these two watch the account as a whole.
 *
 * Absence is healthy: the metrics have no datapoints when nothing was sent,
 * and `noDataState: OK` (grafana.ts) keeps that quiet. A query that cannot run
 * (CloudWatch throttling, the data source's role) keeps the last real answer
 * through `execErrState: KeepLast` instead of paging on a number nobody read;
 * `alerting-rule-evaluations-failing` reports a broken query path.
 *
 * The metric is published in 5-minute buckets, so `for: 15m` is three buckets
 * above the line in a row. One noisy datapoint, a small send with a bad
 * start, does not page.
 */
export const sesReputationAlerts: Alert[] = [
  {
    slug: 'ses-bounce-rate',
    name: 'SES account bounce rate high',
    type: 'cloudwatch',
    cloudwatchNamespace: 'AWS/SES',
    expr: 'Reputation.BounceRate',
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
    type: 'cloudwatch',
    cloudwatchNamespace: 'AWS/SES',
    expr: 'Reputation.ComplaintRate',
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
