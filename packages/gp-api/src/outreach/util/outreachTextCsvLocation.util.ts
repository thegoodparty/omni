/**
 * Where the recipient CSVs live. The dedicated name is preferred so the
 * shared layer is not spelled after one of its two products, with the poll
 * bucket as the fallback that already exists in every environment — the
 * object is an idempotency record, not a deliverable, so the two products
 * sharing one bucket is fine. Split them by setting the first var.
 */
/**
 * Namespaces the recipient CSV per deployment, because the bucket is NOT
 * per-deployment: preview stacks and local machines both read and write
 * `serve-analyze-data-dev`. Outreach ids are per-database and every preview
 * database starts at 1, so without this an unrelated stack's `1-1.csv` is a
 * cache hit — `runClaimedSend` would skip audience resolution, parse someone
 * else's recipients, capture them against THIS org, and hand their phone
 * numbers to fulfilment.
 *
 * Derived from the queue name rather than OTEL_SERVICE_ENVIRONMENT because
 * that is only ever 'preview' for every PR stack at once, and a local .env
 * routinely sets it to 'prod'. `SQS_QUEUE` is already unique per deployment
 * AND per developer — `pr-2025-Queue.fifo`, `develop-Queue.fifo`,
 * `StephenT_Queue.fifo`.
 *
 * Throws when unset, matching resolveBucket: a missing value here is a
 * deploy misconfiguration, and guessing a prefix is how the collision this
 * exists to prevent comes back.
 */
export const resolveSendKeyPrefix = (): string => {
  const queue = process.env.SQS_QUEUE
  if (!queue) {
    throw new Error(
      'SQS_QUEUE is required to hand off a text send: it namespaces the ' +
        'recipient CSV so deployments sharing one bucket cannot collide',
    )
  }
  return queue.replace(/[-_]?Queue\.fifo$/i, '').replace(/[^A-Za-z0-9_-]/g, '-')
}

export const resolveBucket = (): string => {
  const bucket =
    process.env.OUTREACH_TEXT_CSVS_BUCKET || process.env.TEVYN_POLL_CSVS_BUCKET
  if (!bucket) {
    throw new Error(
      'OUTREACH_TEXT_CSVS_BUCKET (or TEVYN_POLL_CSVS_BUCKET) is required to ' +
        'hand off a text send',
    )
  }
  return bucket
}
