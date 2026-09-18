/**
 * Pro-without-subscription drift report.
 *
 * Finds campaigns that are `is_pro = true` while the campaign's own recorded
 * history says no subscription is behind it. Read-only: SELECTs, no writes, and
 * no Stripe calls at all.
 *
 * Usage:
 *   npx tsx scripts/pro-without-subscription-drift.ts
 *   npx tsx scripts/pro-without-subscription-drift.ts --json > drift-$(date +%F).json
 *
 * Requires DATABASE_URL. Prefer the `readonly_user` role (scripts/setup-readonly-role.sh).
 *
 * Why this exists alongside the Stripe reconciliation
 * ---------------------------------------------------
 * `stripe-campaign-reconcile.ts` is the authority on divergence, but it needs a
 * live Stripe secret key, which lives in the `GP_API_PROD` AWS secret. That
 * secret is not readable by the default `EngineerAccess` SSO role
 * (`secretsmanager:GetSecretValue` is denied), so the reconciliation cannot be
 * run by most engineers and has no scheduled runner.
 *
 * The two classes below need neither Stripe nor the secret: they are cases
 * where the campaign row contradicts *itself*, so DATABASE_URL alone settles
 * them. That makes this cheap enough to run on a schedule and to hand to
 * whoever is on call, which is the difference between drift being noticed in
 * days rather than months.
 *
 * This reports. It does not repair. Both classes below can also be produced
 * deliberately by a comped campaign (see "Comps" in the class table), so the
 * output is a list a human triages, never an input to an automated write.
 */
import 'dotenv/config'
import pg from 'pg'

/** One campaign row, as selected by {@link SQL}. */
export type CampaignProRow = {
  campaignId: number
  slug: string | null
  userId: number | null
  email: string | null
  isDemo: boolean
  subscriptionId: string | null
  customerId: string | null
  /** `details.isProUpdatedAt` — an ISO-8601 string written by `setIsPro`. */
  isProUpdatedAt: string | null
  /**
   * `details.subscriptionCanceledAt` — epoch, but in **either** seconds or
   * milliseconds depending on which handler wrote it. See {@link toEpochMs}.
   */
  subscriptionCanceledAt: number | null
}

export const ProDriftClass = {
  /**
   * The campaign recorded a subscription cancellation *after* its last genuine
   * non-Pro -> Pro transition, and is still Pro. The row disagrees with itself:
   * `customerSubscriptionDeletedHandler` stamps `subscriptionCanceledAt` and,
   * via `persistCampaignProCancellation`, also sets `isPro = false` — so a row
   * carrying a later cancellation than upgrade should not still be Pro.
   */
  ProAfterCancellation: 'PRO_AFTER_CANCELLATION',
  /**
   * The campaign is Pro with no `details.subscriptionId` at all. Nothing in the
   * product can reach this subscription: `findBySubscriptionId` is the only
   * lookup and there is no id to match. Weaker than the class above because a
   * campaign that was never paid for (comped, seeded) looks the same.
   */
  ProNoSubscriptionId: 'PRO_NO_SUBSCRIPTION_ID',
} as const

export type ProDriftClass = (typeof ProDriftClass)[keyof typeof ProDriftClass]

export type ProDriftFinding = {
  driftClass: ProDriftClass
  campaignId: number
  slug: string | null
  userId: number | null
  email: string | null
  subscriptionId: string | null
  customerId: string | null
  isProUpdatedAt: string | null
  subscriptionCanceledAt: string | null
  /** Human-readable statement of what contradicts what. */
  reason: string
}

/**
 * `details.isProUpdatedAt` is an ISO string (`formatISO(new Date())` in
 * `setIsPro`), so it parses directly.
 *
 * `details.subscriptionCanceledAt` is written in **two different units** by
 * two different handlers, and both are in the column:
 *
 * - `customerSubscriptionDeletedHandler` writes `Date.now()` — milliseconds.
 * - `customerSubscriptionUpdatedHandler` writes Stripe's `canceled_at`
 *   verbatim — Unix **seconds**, the Stripe API convention.
 *
 * Reading a seconds value as milliseconds puts it in January 1970, so it would
 * never postdate a real upgrade and the row would silently escape
 * PRO_AFTER_CANCELLATION — the exact miss this report exists to catch. Anything
 * below the threshold is therefore treated as seconds and scaled.
 *
 * A value that does not parse must be treated as absent rather than as `NaN`:
 * `NaN` comparisons are always false, which would also silently drop the row
 * instead of reporting it.
 */
// 1e11 as ms is 1973-03-03 and as seconds is the year 5138. Every real stamp in
// either unit is on the correct side, and no plausible date is ambiguous.
const SECONDS_CEILING = 1e11

export function toEpochMs(value: string | number | null): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Math.abs(value) < SECONDS_CEILING ? value * 1000 : value
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Classifies one campaign row, or returns `null` when it is not drifted.
 *
 * A row lands in at most one class, most-specific first, so an operator reading
 * the report never has to notice that two lines are the same campaign.
 */
export function classifyRow(row: CampaignProRow): ProDriftFinding | null {
  // Demo campaigns are seeded Pro on purpose and would otherwise be most of
  // the output. Same exclusion the Stripe reconciliation makes.
  if (row.isDemo) return null

  const canceledAtMs = toEpochMs(row.subscriptionCanceledAt)
  const upgradedAtMs = toEpochMs(row.isProUpdatedAt)

  const base = {
    campaignId: row.campaignId,
    slug: row.slug,
    userId: row.userId,
    email: row.email,
    subscriptionId: row.subscriptionId,
    customerId: row.customerId,
    isProUpdatedAt: row.isProUpdatedAt,
    subscriptionCanceledAt:
      canceledAtMs === null ? null : new Date(canceledAtMs).toISOString(),
  }

  // Strongest signal first: we recorded the cancellation ourselves, after the
  // upgrade, and the row is still Pro.
  //
  // `upgradedAtMs === null` still qualifies: a campaign with a recorded
  // cancellation and no recorded upgrade cannot have a later upgrade than
  // cancellation. Requiring a non-null upgrade stamp here would drop exactly
  // the oldest rows, whose upgrade predates `isProUpdatedAt` being written.
  if (canceledAtMs !== null) {
    if (upgradedAtMs === null || canceledAtMs > upgradedAtMs) {
      return {
        ...base,
        driftClass: ProDriftClass.ProAfterCancellation,
        reason:
          upgradedAtMs === null
            ? 'isPro is true and a subscription cancellation is recorded, with no recorded Pro upgrade to postdate it'
            : `isPro is true but the recorded cancellation (${new Date(canceledAtMs).toISOString()}) is later than the recorded Pro upgrade (${new Date(upgradedAtMs).toISOString()})`,
      }
    }
    // A cancellation older than the upgrade is the normal residue of
    // cancel-then-resubscribe. Not drift.
    return null
  }

  if (!row.subscriptionId) {
    return {
      ...base,
      driftClass: ProDriftClass.ProNoSubscriptionId,
      reason:
        'isPro is true with no details.subscriptionId, so no webhook or reconciliation can resolve this campaign from Stripe',
    }
  }

  return null
}

/** Report ordering: the self-contradicting class first, then by campaign id. */
const CLASS_PRIORITY: ProDriftClass[] = [
  ProDriftClass.ProAfterCancellation,
  ProDriftClass.ProNoSubscriptionId,
]

export function buildReport(rows: CampaignProRow[]): ProDriftFinding[] {
  const findings = rows
    .map(classifyRow)
    .filter((f): f is ProDriftFinding => f !== null)

  return findings.sort((a, b) => {
    const byClass =
      CLASS_PRIORITY.indexOf(a.driftClass) -
      CLASS_PRIORITY.indexOf(b.driftClass)
    return byClass !== 0 ? byClass : a.campaignId - b.campaignId
  })
}

// ---------------------------------------------------------------------------
// SQL — every Pro campaign plus the three details keys that decide the class.
//
// `jsonb_typeof(details) = 'object'` guards the `->` reads: a scalar or array
// `details` would make the key reads meaningless rather than raise, and such a
// row cannot carry the keys this report reasons about anyway.
//
// It does NOT need an `IS NULL` arm. `jsonb_typeof(NULL)` is NULL, so such a
// row would be dropped by three-valued logic — but the column is
// `"details" JSONB NOT NULL DEFAULT '{}'` (20241121223807_add_campaigns, never
// relaxed since; `Json` not `Json?` in campaign.prisma), so no row can be NULL
// and an `IS NULL` arm would be dead. This report is only ever run against a
// database that has had that migration applied. What DOES exist is a Pro
// campaign whose details is `{}` — that passes this guard, reads all three keys
// as NULL, and is classified PRO_NO_SUBSCRIPTION_ID, which is correct.
// ---------------------------------------------------------------------------
export const SQL = `
  SELECT
    c.id                                        AS campaign_id,
    c.slug                                      AS slug,
    c.user_id                                   AS user_id,
    u.email                                     AS email,
    COALESCE(c.is_demo, false)                  AS is_demo,
    c.details->>'subscriptionId'                AS subscription_id,
    u.meta_data->>'customerId'                  AS customer_id,
    c.details->>'isProUpdatedAt'                AS is_pro_updated_at,
    c.details->>'subscriptionCanceledAt'        AS subscription_canceled_at
  FROM campaign c
  LEFT JOIN "user" u ON u.id = c.user_id
  WHERE c.is_pro = true
    AND jsonb_typeof(c.details) = 'object'
  ORDER BY c.id
`

/** `pg` hands back `unknown`; take the value only when it really is text. */
function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Maps a raw `pg` row onto {@link CampaignProRow}. */
export function mapRow(raw: Record<string, unknown>): CampaignProRow {
  const canceledRaw = raw.subscription_canceled_at
  return {
    campaignId: Number(raw.campaign_id),
    slug: asText(raw.slug),
    userId: raw.user_id === null ? null : Number(raw.user_id),
    email: asText(raw.email),
    isDemo: raw.is_demo === true,
    subscriptionId: asText(raw.subscription_id),
    customerId: asText(raw.customer_id),
    isProUpdatedAt: asText(raw.is_pro_updated_at),
    // Stored as a JSON number but read out via `->>`, so it arrives as text.
    subscriptionCanceledAt:
      canceledRaw === null || canceledRaw === undefined
        ? null
        : Number(canceledRaw),
  }
}

function formatTable(findings: ProDriftFinding[]): string {
  if (findings.length === 0) {
    return 'No Pro-without-subscription drift found.'
  }
  const lines: string[] = []
  for (const cls of CLASS_PRIORITY) {
    const inClass = findings.filter((f) => f.driftClass === cls)
    if (inClass.length === 0) continue
    lines.push(`\n── ${cls} (${inClass.length}) ─────────────────────`)
    for (const f of inClass) {
      lines.push(
        `  campaign ${f.campaignId}  slug=${f.slug ?? '—'}  user=${f.userId ?? '—'}  ${f.email ?? '—'}`,
      )
      lines.push(
        `    subscriptionId=${f.subscriptionId ?? '—'}  customerId=${f.customerId ?? '—'}`,
      )
      lines.push(`    ${f.reason}`)
    }
  }
  lines.push(`\nTotal: ${findings.length}`)
  return lines.join('\n')
}

async function main() {
  const asJson = process.argv.includes('--json')
  const connectionString = process.env.DATABASE_URL
  // Without this, an unset or empty DATABASE_URL makes `pg` fall back to a
  // local socket and fail with a connection stack trace, which reads like the
  // report is broken rather than unconfigured.
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required. This report is read-only and needs no Stripe key;\n' +
        'point it at a prod read replica, e.g.\n' +
        "  DATABASE_URL='postgresql://readonly_user:<pw>@<host>:5432/gpdb' \\\n" +
        '    npx tsx scripts/pro-without-subscription-drift.ts',
    )
  }
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query(SQL)
    const findings = buildReport(rows.map(mapRow))
    // Report to stdout, progress to stderr, so `--json >file` captures only JSON.
    process.stderr.write(`Scanned ${rows.length} Pro campaigns.\n`)
    process.stdout.write(
      asJson
        ? `${JSON.stringify(findings, null, 2)}\n`
        : `${formatTable(findings)}\n`,
    )
  } finally {
    await client.end()
  }
}

// Only run when invoked directly, so the tests can import the pure functions.
if (process.argv[1]?.includes('pro-without-subscription-drift')) {
  main().catch((e: unknown) => {
    // A missing DATABASE_URL is operator error, not a crash — print the
    // instruction, not a stack trace.
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
