/**
 * Data-level repair for orphaned Pro subscriptions.
 *
 * ─── What this is for ────────────────────────────────────────────────────
 * A campaign's Stripe subscription id lives in exactly one place, the JSONB
 * key `campaign.details->'subscriptionId'`. There is no subscription table and
 * no constraint. Several now-fixed defects lost that key (the read-modify-write
 * in `patchCampaignDetails`, ENG-11084's email-only checkout minting a second
 * customer, `deleteUser` cancelling after its cascade), and the subscription
 * webhooks answered 502 on a lookup miss instead of recording the drift. The
 * result is a customer Stripe is still billing who has no Pro access and — the
 * part that matters most — **no way to cancel**, because Manage Subscription
 * resolves off their own campaign and their campaign does not know about the
 * subscription.
 *
 * `stripe-campaign-reconcile.ts` (#1945) finds them. This repairs the three
 * classes that are pure data corrections. It writes to Postgres only; it
 * cannot touch Stripe (see § The read-only Stripe guard).
 *
 * ─── What it repairs ─────────────────────────────────────────────────────
 * | Class                         | Fixes                                    |
 * |-------------------------------|------------------------------------------|
 * | `RELINK_ORPHANED_ACTIVE`      | Writes `details.subscriptionId` back and  |
 * |                               | sets `is_pro`, so a paying customer gets  |
 * |                               | Pro and can cancel themselves. Repoints   |
 * |                               | `user.metaData.customerId` in the same    |
 * |                               | transaction when it disagrees, because    |
 * |                               | the billing portal opens the STORED       |
 * |                               | customer — re-linking without that gives  |
 * |                               | them Pro but still no cancel path.        |
 * | `CORRECT_MISMATCHED_CUSTOMER` | The campaign carries the subscription,    |
 * |                               | but its owner stores a different Stripe   |
 * |                               | customer than the one actually billing.   |
 * |                               | A subscription cannot be reparented       |
 * |                               | between customers, so the database moves. |
 * | `NORMALIZE_CANCELED_AT`       | `details.subscriptionCanceledAt` is       |
 * |                               | written in two units by two handlers.     |
 * |                               | Rewrites the seconds-stamped rows as      |
 * |                               | milliseconds. Separate pass,              |
 * |                               | `--normalize-canceled-at`.                |
 *
 * ─── What it refuses to do, and why ─────────────────────────────────────
 * Every refusal below is reported, never acted on. A refusal is an output, not
 * an error: the population is small and each one is a human decision.
 *
 * **De-Pro / STALE_PRO.** #1955 proved that classification wrong on the only
 * two rows it ever flagged. Both had a SIBLING subscription on a different
 * Stripe customer, the campaign carried the sibling, and the sibling's
 * cancellation had already correctly run `persistCampaignProCancellation` —
 * corroborated by a CRM sync emitting `pro_candidate: "No"`. De-Pro-ing would
 * have removed Pro from correctly-billed campaigns. Nothing in the schema
 * distinguishes a comped campaign from genuine drift either, so this class
 * cannot be automated at all. `REFUSED_STALE_PRO`.
 *
 * **Anything at Stripe.** No cancels, no refunds, no customer merges. Sizing a
 * refund is a judgement about how far back to go and what we tell the
 * customer. The guard that makes this a property rather than a promise is
 * described below.
 *
 * **Hard-deleted campaigns.** `deleteUser` cascades with no archive, so there
 * is no row to re-link to. `REFUSED_NO_CAMPAIGN` — refund-and-cancel only.
 *
 * **Granting the free-texts offer.** `setIsPro` grants `hasFreeTextsOffer` on a
 * genuine non-Pro -> Pro transition. A re-link is not a new sale, and handing
 * out a product perk is a product decision, so the repair restores linkage and
 * Pro access and nothing else.
 *
 * ─── Safety ──────────────────────────────────────────────────────────────
 * 1. **Dry-run by default.** Writing requires `--apply`. The default output is
 *    the exact statements it would run, their bound parameters, and the
 *    before/after value of every field.
 * 2. **Driven by a reviewed input list.** `--json <reconcile.json>` (the
 *    `--json` output of `stripe-campaign-reconcile.ts`) or `--subscription
 *    sub_x`, repeatable. It never derives its own population: these
 *    classifications have been wrong once already, so a human reviews the list
 *    before anything writes.
 * 3. **The file is a list of ids, never evidence.** Every row is re-read from
 *    Stripe and from Postgres at plan time, in the same process that writes,
 *    and each statement additionally re-asserts the precondition it depends on
 *    in its own `WHERE` clause (see `assertSingleRow`). A stale file, or a
 *    webhook landing mid-run, produces a refusal rather than a wrong write.
 * 4. **The sibling trap.** Before re-linking, the target campaign must carry
 *    NO `subscriptionId`. If it carries a different one, re-linking would
 *    orphan *that* subscription — which is the ENG-11084 double-billing
 *    mechanism itself, pointed the other way. Refused loudly, and the
 *    `WHERE details->>'subscriptionId' IS NULL` predicate means the statement
 *    could not do it even if the planner were wrong.
 * 5. **The atomic merge.** `details = details || $n::jsonb`, the shape #1942
 *    moved the application to. A read-modify-write here is the bug that caused
 *    this incident; there is none in this file.
 * 6. **Idempotent.** A second run is a no-op, and that is how an operator
 *    verifies the first one worked.
 * 7. **One transaction per subscription**, not one per run. A failure halfway
 *    leaves a coherent partial repair: every subscription is either fully
 *    repaired or untouched.
 * 8. **Audit log.** Every applied change appends a JSON line carrying the
 *    timestamp, campaign id, user id, subscription id, field, before, after,
 *    and how ownership was resolved.
 * 9. **Demo campaigns are skipped.** They are seeded Pro deliberately.
 *
 * ─── The read-only Stripe guard ──────────────────────────────────────────
 * The Stripe client is built with #1945's `createReadOnlyHttpClient`, which
 * runs `assertReadOnlyRequest` in front of the socket, so a non-GET cannot
 * leave the process. The only Stripe surface this file can reach is
 * `StripeReader`, whose methods are all reads. Both layers are #1945's, reused
 * rather than reimplemented.
 *
 * ─── How to run ──────────────────────────────────────────────────────────
 *   cd packages/gp-api
 *   export STRIPE_SECRET_KEY='sk_live_...'
 *   export DATABASE_URL='postgresql://...@<host>:5432/gpdb'
 *
 *   # 1. the population, reviewed by a human
 *   npx tsx scripts/stripe-campaign-reconcile.ts --json > drift.json
 *
 *   # 2. dry run — prints the statements and the before/after of every field
 *   npx tsx scripts/repair-orphaned-pro-subscriptions.ts --json drift.json
 *
 *   # 3. apply, after reading the diff
 *   npx tsx scripts/repair-orphaned-pro-subscriptions.ts --json drift.json --apply
 *
 *   # 4. verify: the repaired rows drop out of the reconcile report
 *   npx tsx scripts/stripe-campaign-reconcile.ts
 *
 * `DATABASE_URL` must be a role that can write, so the `readonly_user` role the
 * reconcile runbook asks for will not do for step 3 — which is deliberate: the
 * dry run works with it, and only the apply needs the stronger credential.
 *
 * Operator procedure, including the access request that getting these
 * credentials is: `packages/runbooks/books/repair-orphaned-pro-subscriptions.md`.
 */
import 'dotenv/config'
import { formatISO } from 'date-fns'
import { appendFileSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import Stripe from 'stripe'
import { PrismaClient } from '../src/generated/prisma'
import { requireEnv } from '../src/shared/util/env.util'
import {
  createReadOnlyHttpClient,
  createStripeReader,
  isLiveStatus,
  normalizeEmail,
  proProductIdForKey,
  type ReconcileReport,
  type StripeReader,
  type SubscriptionSnapshot,
} from './stripe-campaign-reconcile'

const DEFAULT_AUDIT_LOG = join(
  __dirname,
  'output',
  'repair-orphaned-pro-subscriptions-audit.jsonl',
)

// ── Repair and refusal vocabulary ───────────────────────────────────────────

export const RepairClass = {
  RelinkOrphanedActive: 'RELINK_ORPHANED_ACTIVE',
  CorrectMismatchedCustomer: 'CORRECT_MISMATCHED_CUSTOMER',
  NormalizeCanceledAt: 'NORMALIZE_CANCELED_AT',
} as const
export type RepairClass = (typeof RepairClass)[keyof typeof RepairClass]

/**
 * Why a row was not repaired. `NOOP_*` means the repair is already in place,
 * which is what a second run of a successful repair reports. `REFUSED_*` means
 * a human has to decide.
 */
export const Outcome = {
  Apply: 'APPLY',
  /** Carried by a campaign whose owner stores the customer that is billing
   * it — i.e. what a successful repair looks like on the second run. */
  NoopAlreadyLinked: 'NOOP_ALREADY_LINKED',
  NoopAlreadyMilliseconds: 'NOOP_ALREADY_MILLISECONDS',
  /** The target campaign carries a DIFFERENT subscription id. See § safety 4. */
  RefusedSiblingSubscription: 'REFUSED_SIBLING_SUBSCRIPTION',
  RefusedStalePro: 'REFUSED_STALE_PRO',
  RefusedNoOwner: 'REFUSED_NO_OWNER',
  RefusedNoCampaign: 'REFUSED_NO_CAMPAIGN',
  RefusedAmbiguousCampaign: 'REFUSED_AMBIGUOUS_CAMPAIGN',
  RefusedDemoCampaign: 'REFUSED_DEMO_CAMPAIGN',
  RefusedNotLive: 'REFUSED_NOT_LIVE',
  RefusedNotAtStripe: 'REFUSED_NOT_AT_STRIPE',
  RefusedLinkedElsewhere: 'REFUSED_LINKED_ELSEWHERE',
  RefusedNonIntegerStamp: 'REFUSED_NON_INTEGER_STAMP',
  /** The row changed between plan and apply. Re-run to re-plan against it. */
  RefusedRacedPrecondition: 'REFUSED_RACED_PRECONDITION',
} as const
export type Outcome = (typeof Outcome)[keyof typeof Outcome]

export const isApplicable = (outcome: Outcome): boolean =>
  outcome === Outcome.Apply

export const isRefusal = (outcome: Outcome): boolean =>
  outcome.startsWith('REFUSED_')

/**
 * How the owning user was established. Metadata first and email second is not
 * a preference: candidates type arbitrary addresses at checkout (payments
 * AGENTS.md § "Debugging Pro billing issues"), so the email on the Stripe
 * customer can belong to a different human than the account that paid.
 */
export const OwnershipSource = {
  SubscriptionMetadata: 'subscription-metadata',
  StripeCustomerEmail: 'stripe-customer-email',
  /** The campaign already carries the subscription; nothing was resolved. */
  CampaignLinkage: 'campaign-linkage',
} as const
export type OwnershipSource =
  (typeof OwnershipSource)[keyof typeof OwnershipSource]

// ── Plans ───────────────────────────────────────────────────────────────────

/** A parameterised statement, kept apart from its parameters so the dry run
 * prints what would run rather than a string somebody might paste. */
export interface Statement {
  sql: string
  params: unknown[]
  /** What this statement must still be true of, enforced in its WHERE. */
  precondition: string
}

export interface FieldChange {
  entity: 'campaign' | 'user'
  entityId: number
  field: string
  before: string | number | boolean | null
  after: string | number | boolean | null
}

export interface RepairPlan {
  repairClass: RepairClass
  outcome: Outcome
  subscriptionId: string | null
  campaignId: number | null
  userId: number | null
  ownershipSource: OwnershipSource | null
  /** One sentence an operator can act on without reading this file. */
  detail: string
  statements: Statement[]
  changes: FieldChange[]
}

const plan = (
  repairClass: RepairClass,
  outcome: Outcome,
  detail: string,
  fields: Omit<Partial<RepairPlan>, 'repairClass' | 'outcome' | 'detail'> = {},
): RepairPlan => ({
  subscriptionId: null,
  campaignId: null,
  userId: null,
  ownershipSource: null,
  statements: [],
  changes: [],
  ...fields,
  repairClass,
  outcome,
  detail,
})

// ── Database access ─────────────────────────────────────────────────────────

/**
 * The database surface this script needs, narrow enough that the tests drive
 * the real statements against a Postgres testcontainer through the same seam
 * the script uses in production. Mocking this would only assert the mock — the
 * whole risk in a JSONB merge is whether the SQL is right.
 */
export interface SqlRunner {
  query<T>(sql: string, params: unknown[]): Promise<T[]>
  execute(sql: string, params: unknown[]): Promise<number>
}

export interface Database extends SqlRunner {
  /** One per repaired subscription, never one per run. See § safety 7. */
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>
}

type RawSqlClient = {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>
}

const asRunner = (client: RawSqlClient): SqlRunner => ({
  query: <T>(sql: string, params: unknown[]) =>
    client.$queryRawUnsafe<T[]>(sql, ...params),
  execute: (sql: string, params: unknown[]) =>
    client.$executeRawUnsafe(sql, ...params),
})

export const createDatabase = (prisma: PrismaClient): Database => ({
  ...asRunner(prisma),
  transaction: (fn) => prisma.$transaction((tx) => fn(asRunner(tx))),
})

/**
 * The reads the planner needs, named rather than expressed as SQL.
 *
 * Same split as #1945's `StripeReader`, for the same reason: the planner's
 * decisions and the statements that implement them fail in different ways and
 * are worth testing separately. A test can hand the planner five typed
 * fixtures, while the SQL underneath is checked against a real Postgres, where
 * a wrong column or a predicate that matches nothing actually shows up.
 */
export interface RepairReader {
  campaignsBySubscriptionId(subscriptionId: string): Promise<CampaignRow[]>
  campaignsByUserId(userId: number): Promise<CampaignRow[]>
  userById(id: number): Promise<UserRow | null>
  userByEmail(email: string): Promise<UserRow | null>
  campaignsWithCanceledAtStamp(): Promise<CanceledAtRow[]>
}

export const createRepairReader = (db: SqlRunner): RepairReader => ({
  campaignsBySubscriptionId: (subscriptionId) =>
    findCampaignsBySubscriptionId(db, subscriptionId),
  campaignsByUserId: (userId) => findCampaignsByUserId(db, userId),
  userById: (id) => findUserById(db, id),
  userByEmail: (email) => findUserByEmail(db, email),
  campaignsWithCanceledAtStamp: () => findCampaignsWithCanceledAtStamp(db),
})

export interface CampaignRow {
  id: number
  slug: string | null
  userId: number | null
  isPro: boolean
  isDemo: boolean
  subscriptionId: string | null
  /** `user.metaData.customerId` of the campaign's owner. */
  storedCustomerId: string | null
}

// `->>` on a non-object `details` yields NULL rather than raising, so the
// jsonb_typeof guard is not about safety here — it is so a malformed row reads
// as "no linkage" consistently with `patchCampaignDetails`' own guard.
const CAMPAIGN_COLUMNS = `
    c.id                        AS "id",
    c.slug                      AS "slug",
    c.user_id                   AS "userId",
    COALESCE(c.is_pro, false)   AS "isPro",
    COALESCE(c.is_demo, false)  AS "isDemo",
    c.details->>'subscriptionId' AS "subscriptionId",
    u.meta_data->>'customerId'  AS "storedCustomerId"`

export const findCampaignsBySubscriptionId = (
  db: SqlRunner,
  subscriptionId: string,
): Promise<CampaignRow[]> =>
  db.query<CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS}
     FROM campaign c
     LEFT JOIN "user" u ON u.id = c.user_id
     WHERE jsonb_typeof(c.details) = 'object'
       AND c.details->>'subscriptionId' = $1
     ORDER BY c.id`,
    [subscriptionId],
  )

export const findCampaignsByUserId = (
  db: SqlRunner,
  userId: number,
): Promise<CampaignRow[]> =>
  db.query<CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS}
     FROM campaign c
     LEFT JOIN "user" u ON u.id = c.user_id
     WHERE c.user_id = $1
     ORDER BY c.id`,
    [userId],
  )

export interface UserRow {
  id: number
  storedCustomerId: string | null
  isDeleted: boolean
}

export const findUserById = async (
  db: SqlRunner,
  id: number,
): Promise<UserRow | null> => {
  const [row] = await db.query<UserRow>(
    `SELECT id                                         AS "id",
            meta_data->>'customerId'                   AS "storedCustomerId",
            COALESCE((meta_data->>'isDeleted')::boolean, false) AS "isDeleted"
     FROM "user" WHERE id = $1`,
    [id],
  )
  return row ?? null
}

/**
 * Case-insensitive, matching `UsersService.findUserByEmail` and the
 * `LOWER(email)` unique index that makes it resolve to at most one account.
 * More than one match is treated as no match: the whole reason this is the
 * weaker signal is that one human can hold two accounts.
 */
export const findUserByEmail = async (
  db: SqlRunner,
  email: string,
): Promise<UserRow | null> => {
  const rows = await db.query<UserRow>(
    `SELECT id                                         AS "id",
            meta_data->>'customerId'                   AS "storedCustomerId",
            COALESCE((meta_data->>'isDeleted')::boolean, false) AS "isDeleted"
     FROM "user" WHERE LOWER(email) = LOWER($1)
     ORDER BY id`,
    [email],
  )
  return rows.length === 1 ? rows[0] : null
}

export interface CanceledAtRow {
  id: number
  slug: string | null
  userId: number | null
  subscriptionId: string | null
  /** The raw JSON number, as text, so a fractional value stays inspectable. */
  canceledAtRaw: string | null
}

export const findCampaignsWithCanceledAtStamp = (
  db: SqlRunner,
): Promise<CanceledAtRow[]> =>
  db.query<CanceledAtRow>(
    `SELECT c.id                                     AS "id",
            c.slug                                   AS "slug",
            c.user_id                                AS "userId",
            c.details->>'subscriptionId'             AS "subscriptionId",
            c.details->>'subscriptionCanceledAt'     AS "canceledAtRaw"
     FROM campaign c
     WHERE jsonb_typeof(c.details) = 'object'
       AND jsonb_typeof(c.details->'subscriptionCanceledAt') = 'number'
     ORDER BY c.id`,
    [],
  )

/**
 * `details.subscriptionCanceledAt` is written in two units by two handlers:
 * `customerSubscriptionDeletedHandler` writes `Date.now()` (milliseconds) and
 * `customerSubscriptionUpdatedHandler` writes Stripe's `canceled_at` verbatim
 * (Unix seconds). Both are in the column. Read as milliseconds, a seconds
 * value lands in January 1970, which never postdates an upgrade — so the
 * comparison silently resolves false rather than erroring, and the row escapes
 * `pro-without-subscription-drift.ts`' PRO_AFTER_CANCELLATION check.
 *
 * **Milliseconds is the canonical unit**, for three reasons that point the same
 * way: `PrismaJson.CampaignDetails` declares it a `number` that the web app
 * passes to `new Date(...)`, which is milliseconds; `Date.now()` is what the
 * delete handler — the path that fires on every completed cancellation —
 * already writes; and it is the unit `toEpochMs` in
 * `pro-without-subscription-drift.ts` normalises TO when reading.
 *
 * 1e11 as milliseconds is 1973-03-03 and as seconds is the year 5138, so every
 * real stamp in either unit is unambiguously on one side of it. This is the
 * same threshold and the same reasoning as `toEpochMs`, kept identical on
 * purpose: the reader and the repair must agree about which rows are seconds.
 */
export const SECONDS_CEILING = 1e11

// ── Statement builders ──────────────────────────────────────────────────────

/**
 * Re-links a campaign to its subscription and grants Pro in one statement.
 *
 * `details || $2::jsonb` is #1942's atomic merge — the row is re-read under its
 * own lock and the patch merges onto the committed result, so a concurrent
 * webhook writing a different key of the same blob cannot be clobbered. The
 * read-modify-write this replaced is the defect that produced the population
 * this script repairs, so there is deliberately none here.
 *
 * `details->>'subscriptionId' IS NULL` is the sibling trap as a predicate. The
 * planner refuses this case before it ever builds a statement; this is the
 * second layer, and it is the one that holds if a subscription lands on the
 * campaign between the plan and the apply.
 *
 * `is_pro` and the `isProUpdatedAt` stamp commit together with the linkage,
 * which is #1952's rule: a flip that commits without its stamp cannot be
 * repaired by a redelivery, because the redelivery sees `is_pro = true` and
 * skips the transition.
 */
export const relinkCampaignStatement = (
  campaignId: number,
  patch: Record<string, unknown>,
): Statement => ({
  sql: `UPDATE campaign
        SET details = details || $2::jsonb,
            is_pro = true,
            updated_at = NOW()
        WHERE id = $1
          AND jsonb_typeof(details) = 'object'
          AND details->>'subscriptionId' IS NULL`,
  params: [campaignId, JSON.stringify(patch)],
  precondition: 'campaign still carries no subscriptionId',
})

/**
 * Repoints the owner's stored Stripe customer at the one actually billing.
 *
 * The compare-and-swap on the before value is what makes a stale input file
 * safe: if anything moved `customerId` since the plan was built, this matches
 * no row and the run reports a raced precondition instead of overwriting a
 * newer value. An absent stored id compares as `''`, so "nobody has set one"
 * is a precondition like any other rather than a hole in the check.
 *
 * The `CASE jsonb_typeof` is not defensive noise, and `COALESCE(meta_data,
 * '{}')` is not enough in its place. `metaData` is `Json?`, and writing
 * `null` through Prisma stores the JSON value `null` — `jsonb_typeof` reports
 * `'null'`, the column is not SQL NULL, and `null || '{...}'` raises
 * `cannot concatenate a non-object`. A user who has never had a customer id
 * is the ordinary case for these orphans, so that row shape is the one this
 * statement most has to work on. The CASE covers SQL NULL, JSON null and any
 * scalar, and is the same shape `setIsPro` uses on `details`.
 */
export const repointCustomerStatement = (
  userId: number,
  expectedCustomerId: string | null,
  customerId: string,
): Statement => ({
  sql: `UPDATE "user"
        SET meta_data = CASE jsonb_typeof(meta_data)
              WHEN 'object' THEN meta_data
              ELSE '{}'::jsonb
            END || $3::jsonb,
            updated_at = NOW()
        WHERE id = $1
          AND COALESCE(meta_data->>'customerId', '') = $2`,
  params: [userId, expectedCustomerId ?? '', JSON.stringify({ customerId })],
  precondition: `user still stores customerId ${expectedCustomerId ?? '(none)'}`,
})

/**
 * Rewrites a seconds-stamped `subscriptionCanceledAt` as milliseconds.
 *
 * Two predicates carry the safety. `< SECONDS_CEILING` is what makes a second
 * run a no-op: the value it wrote is above the ceiling, so it selects nothing
 * and cannot multiply twice. The equality on the observed value is the
 * compare-and-swap — a cancellation webhook landing mid-run writes its own
 * stamp in its own unit, and this must then refuse rather than scale a value
 * it never read.
 */
export const normalizeCanceledAtStatement = (
  campaignId: number,
  observedSeconds: number,
): Statement => ({
  sql: `UPDATE campaign
        SET details = details || jsonb_build_object(
              'subscriptionCanceledAt',
              (details->>'subscriptionCanceledAt')::bigint * 1000
            ),
            updated_at = NOW()
        WHERE id = $1
          AND jsonb_typeof(details) = 'object'
          AND jsonb_typeof(details->'subscriptionCanceledAt') = 'number'
          AND (details->>'subscriptionCanceledAt') ~ '^-?[0-9]+$'
          AND abs((details->>'subscriptionCanceledAt')::bigint) < ${SECONDS_CEILING}
          AND (details->>'subscriptionCanceledAt')::bigint = $2`,
  params: [campaignId, observedSeconds],
  precondition: `campaign still stores ${observedSeconds} (seconds)`,
})

// ── subscriptionCanceledAt units ────────────────────────────────────────────

export const CanceledAtUnit = {
  Seconds: 'seconds',
  Milliseconds: 'milliseconds',
  /** Not an integer epoch at all; nothing safe to infer. */
  Unknown: 'unknown',
} as const
export type CanceledAtUnit =
  (typeof CanceledAtUnit)[keyof typeof CanceledAtUnit]

export const classifyCanceledAt = (raw: string | null): CanceledAtUnit => {
  if (raw === null || !/^-?\d+$/.test(raw.trim())) return CanceledAtUnit.Unknown
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) return CanceledAtUnit.Unknown
  return Math.abs(value) < SECONDS_CEILING
    ? CanceledAtUnit.Seconds
    : CanceledAtUnit.Milliseconds
}

export const planCanceledAtNormalization = (row: CanceledAtRow): RepairPlan => {
  const unit = classifyCanceledAt(row.canceledAtRaw)
  const shared = {
    campaignId: row.id,
    userId: row.userId,
    subscriptionId: row.subscriptionId,
  }

  if (unit === CanceledAtUnit.Unknown) {
    return plan(
      RepairClass.NormalizeCanceledAt,
      Outcome.RefusedNonIntegerStamp,
      `details.subscriptionCanceledAt is ${row.canceledAtRaw ?? 'null'}, ` +
        `which is not an integer epoch in either unit. Nothing safe to infer.`,
      shared,
    )
  }

  if (unit === CanceledAtUnit.Milliseconds) {
    return plan(
      RepairClass.NormalizeCanceledAt,
      Outcome.NoopAlreadyMilliseconds,
      `details.subscriptionCanceledAt is already in milliseconds ` +
        `(${row.canceledAtRaw}).`,
      shared,
    )
  }

  const seconds = Number(row.canceledAtRaw)
  return plan(
    RepairClass.NormalizeCanceledAt,
    Outcome.Apply,
    `details.subscriptionCanceledAt is ${seconds} — Unix seconds from ` +
      `customerSubscriptionUpdatedHandler, which reads as ` +
      `${new Date(seconds).toISOString()} when parsed as milliseconds. ` +
      `Rewriting as ${seconds * 1000} (${new Date(
        seconds * 1000,
      ).toISOString()}).`,
    {
      ...shared,
      statements: [normalizeCanceledAtStatement(row.id, seconds)],
      changes: [
        {
          entity: 'campaign',
          entityId: row.id,
          field: 'details.subscriptionCanceledAt',
          before: seconds,
          after: seconds * 1000,
        },
      ],
    },
  )
}

// ── Ownership resolution ────────────────────────────────────────────────────

export interface OwnerResolution {
  user: UserRow | null
  source: OwnershipSource | null
  detail: string
}

/**
 * Establishes which app user is paying for an orphaned subscription.
 *
 * `subscription.metadata.userId` first. It is the only signal written by our
 * own code rather than typed by a human, so where it exists it settles the
 * question. Note that it is `{}` on every subscription the 2026-09-17
 * reconciliation examined — a Pro checkout writes `userId` onto the checkout
 * session, not the subscription — so in practice the fallback carries this.
 *
 * The email on the billing Stripe customer second, and only second. Candidates
 * type arbitrary addresses at checkout, so a match is evidence about a human
 * and not proof about an account; a single unambiguous match is required, and
 * the source is recorded on the plan and in the audit log so a later reviewer
 * can see which of the two justified a write.
 */
export const resolveOwner = async (
  reader: RepairReader,
  stripe: StripeReader,
  subscription: SubscriptionSnapshot,
): Promise<OwnerResolution> => {
  const rawUserId = subscription.metadata.userId
  if (rawUserId) {
    // A non-numeric or unknown id is reported rather than silently falling
    // through to the weaker signal: metadata that does not resolve means our
    // own write was wrong, which an operator should see.
    const parsed = Number(rawUserId)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return {
        user: null,
        source: null,
        detail: `subscription.metadata.userId is ${rawUserId}, not a user id`,
      }
    }
    const user = await reader.userById(parsed)
    if (!user) {
      return {
        user: null,
        source: null,
        detail: `subscription.metadata.userId ${parsed} matches no user row`,
      }
    }
    if (user.isDeleted) {
      return {
        user: null,
        source: null,
        detail: `subscription.metadata.userId ${parsed} is a deleted account`,
      }
    }
    return {
      user,
      source: OwnershipSource.SubscriptionMetadata,
      detail: `resolved from subscription.metadata.userId ${parsed}`,
    }
  }

  if (!subscription.customerId) {
    return {
      user: null,
      source: null,
      detail: 'subscription carries no metadata.userId and no customer',
    }
  }

  const email = normalizeEmail(
    await stripe.retrieveCustomerEmail(subscription.customerId),
  )
  if (!email) {
    return {
      user: null,
      source: null,
      detail:
        `no metadata.userId, and Stripe customer ` +
        `${subscription.customerId} reports no email (a deleted customer ` +
        `carries none)`,
    }
  }

  const user = await reader.userByEmail(email)
  if (!user) {
    return {
      user: null,
      source: null,
      detail:
        `no metadata.userId, and the email on Stripe customer ` +
        `${subscription.customerId} matches no single live user`,
    }
  }
  if (user.isDeleted) {
    return {
      user: null,
      source: null,
      detail:
        `no metadata.userId, and the email on Stripe customer ` +
        `${subscription.customerId} matches a deleted account`,
    }
  }
  return {
    user,
    source: OwnershipSource.StripeCustomerEmail,
    detail:
      `resolved from the email on Stripe customer ` +
      `${subscription.customerId} (weaker signal: candidates enter ` +
      `arbitrary addresses at checkout)`,
  }
}

// ── The planner ─────────────────────────────────────────────────────────────

/**
 * Turns one subscription id into exactly one plan, from state read now rather
 * than from the input file. Ordering matters and is not arbitrary:
 *
 * 1. Gone from Stripe — nothing to repair, and a stored id Stripe never heard
 *    of is a finding of its own.
 * 2. Some campaign already carries it — then it is not orphaned, whatever the
 *    file said, and the only repair in scope is the customer pointer. A dead
 *    subscription on a Pro campaign lands here as the STALE_PRO refusal.
 * 3. Not live — money has stopped, so there is no access to restore and the
 *    remaining decision (refund) is a human's.
 * 4. Owner, then campaign, then the sibling check. Each step narrows to a
 *    single unambiguous target or refuses.
 */
export const planSubscriptionRepair = async (
  reader: RepairReader,
  stripe: StripeReader,
  subscriptionId: string,
): Promise<RepairPlan> => {
  const subscription = await stripe.retrieveSubscription(subscriptionId)
  if (!subscription) {
    return plan(
      RepairClass.RelinkOrphanedActive,
      Outcome.RefusedNotAtStripe,
      `Stripe has no subscription ${subscriptionId}. Either the id is wrong ` +
        `or it belongs to another mode (test vs live).`,
      { subscriptionId },
    )
  }

  const carriers = await reader.campaignsBySubscriptionId(subscriptionId)
  if (carriers.length > 0) {
    return planCarriedSubscription(subscription, carriers)
  }

  if (!isLiveStatus(subscription.status)) {
    return plan(
      RepairClass.RelinkOrphanedActive,
      Outcome.RefusedNotLive,
      `Subscription is ${subscription.status} at Stripe and no campaign ` +
        `carries it. Money has stopped, so there is no Pro access to ` +
        `restore; what is left is a refund decision, which is a human's.`,
      { subscriptionId, campaignId: null },
    )
  }

  const owner = await resolveOwner(reader, stripe, subscription)
  if (!owner.user) {
    return plan(
      RepairClass.RelinkOrphanedActive,
      Outcome.RefusedNoOwner,
      `Subscription is ${subscription.status} and unlinked, but the owning ` +
        `account cannot be established: ${owner.detail}. Re-link would be a ` +
        `guess; treat as refund-and-cancel.`,
      { subscriptionId },
    )
  }

  const campaigns = await reader.campaignsByUserId(owner.user.id)
  if (campaigns.length === 0) {
    return plan(
      RepairClass.RelinkOrphanedActive,
      Outcome.RefusedNoCampaign,
      `Owner (user ${owner.user.id}, ${owner.detail}) has no campaign row. ` +
        `deleteUser cascades with no archive, so there is nothing to ` +
        `re-link to — refund-and-cancel only.`,
      {
        subscriptionId,
        userId: owner.user.id,
        ownershipSource: owner.source,
      },
    )
  }

  // Seeded Pro on purpose. Writing a real subscription id onto one would make
  // a fixture look like a paying customer to every report that reads it.
  const repairable = campaigns.filter((campaign) => !campaign.isDemo)
  if (repairable.length === 0) {
    return plan(
      RepairClass.RelinkOrphanedActive,
      Outcome.RefusedDemoCampaign,
      `Owner (user ${owner.user.id}) has only demo campaigns, which are ` +
        `seeded Pro deliberately.`,
      {
        subscriptionId,
        userId: owner.user.id,
        ownershipSource: owner.source,
      },
    )
  }

  if (repairable.length > 1) {
    return plan(
      RepairClass.RelinkOrphanedActive,
      Outcome.RefusedAmbiguousCampaign,
      `Owner (user ${owner.user.id}, ${owner.detail}) has ` +
        `${repairable.length} non-demo campaigns ` +
        `(${repairable.map((c) => c.id).join(', ')}). Which one the ` +
        `subscription paid for is not derivable from the data, and guessing ` +
        `grants Pro to the wrong campaign.`,
      {
        subscriptionId,
        userId: owner.user.id,
        ownershipSource: owner.source,
      },
    )
  }

  const target = repairable[0]

  // The sibling trap, and the single most important refusal in this file.
  // Overwriting a non-null subscriptionId orphans whatever it pointed at, and
  // that orphaned subscription keeps billing with no cancel path — which is
  // the ENG-11084 double-billing mechanism, reproduced by the repair meant to
  // fix it. #1955 found this shape on both subscriptions it examined: each had
  // a sibling on a different Stripe customer that the campaign carried.
  if (target.subscriptionId) {
    return plan(
      RepairClass.RelinkOrphanedActive,
      Outcome.RefusedSiblingSubscription,
      `SIBLING TRAP: campaign ${target.id} already carries ` +
        `${target.subscriptionId}. Re-linking ${subscriptionId} would ` +
        `overwrite it and orphan that subscription — the ENG-11084 ` +
        `double-billing mechanism. Establish which of the two the customer ` +
        `should keep, in Stripe, before anything writes here.`,
      {
        subscriptionId,
        campaignId: target.id,
        userId: owner.user.id,
        ownershipSource: owner.source,
      },
    )
  }

  const statements: Statement[] = []
  const changes: FieldChange[] = []

  const patch: Record<string, unknown> = { subscriptionId }
  changes.push({
    entity: 'campaign',
    entityId: target.id,
    field: 'details.subscriptionId',
    before: null,
    after: subscriptionId,
  })
  if (!target.isPro) {
    changes.push({
      entity: 'campaign',
      entityId: target.id,
      field: 'isPro',
      before: false,
      after: true,
    })
    // Only a genuine non-Pro -> Pro transition may stamp this: the CRM sync
    // publishes it as HubSpot's `pro_upgrade_date`, and re-stamping an
    // already-Pro campaign would overwrite a real upgrade date with today.
    // Same rule as setIsPro.
    const stampedAt = formatISO(new Date())
    patch.isProUpdatedAt = stampedAt
    changes.push({
      entity: 'campaign',
      entityId: target.id,
      field: 'details.isProUpdatedAt',
      before: null,
      after: stampedAt,
    })
  }
  statements.push(relinkCampaignStatement(target.id, patch))

  // Without this the customer gets Pro and still cannot cancel: the billing
  // portal opens `user.metaData.customerId`, so a stored pointer at a
  // different Stripe customer sends them to a page that does not hold their
  // subscription. Same transaction as the re-link, because a re-link that
  // leaves the pointer wrong has not finished the job.
  const billingCustomerId = subscription.customerId
  if (billingCustomerId && owner.user.storedCustomerId !== billingCustomerId) {
    statements.push(
      repointCustomerStatement(
        owner.user.id,
        owner.user.storedCustomerId,
        billingCustomerId,
      ),
    )
    changes.push({
      entity: 'user',
      entityId: owner.user.id,
      field: 'metaData.customerId',
      before: owner.user.storedCustomerId,
      after: billingCustomerId,
    })
  }

  return plan(
    RepairClass.RelinkOrphanedActive,
    Outcome.Apply,
    `Subscription is ${subscription.status} at Stripe with no campaign ` +
      `carrying it. Re-linking to campaign ${target.id} (user ` +
      `${owner.user.id}, ${owner.detail}). They are paying, so they get Pro ` +
      `and Manage Subscription starts working — which is how they cancel ` +
      `without us.`,
    {
      subscriptionId,
      campaignId: target.id,
      userId: owner.user.id,
      ownershipSource: owner.source,
      statements,
      changes,
    },
  )
}

/**
 * A subscription some campaign already carries. Not orphaned, so the only
 * repair in scope is the customer pointer — and if it is dead while the
 * campaign is Pro, this is the class #1955 proved cannot be automated.
 */
const planCarriedSubscription = (
  subscription: SubscriptionSnapshot,
  carriers: CampaignRow[],
): RepairPlan => {
  // Two campaigns carrying one subscription id is its own incident: only one
  // of them can be the sale, and a repair would have to decide which.
  if (carriers.length > 1) {
    return plan(
      RepairClass.CorrectMismatchedCustomer,
      Outcome.RefusedLinkedElsewhere,
      `${carriers.length} campaigns carry ${subscription.id} ` +
        `(${carriers.map((c) => c.id).join(', ')}). One subscription paid ` +
        `for one campaign; which is not derivable here.`,
      { subscriptionId: subscription.id },
    )
  }

  const campaign = carriers[0]
  const shared = {
    subscriptionId: subscription.id,
    campaignId: campaign.id,
    userId: campaign.userId,
    ownershipSource: OwnershipSource.CampaignLinkage,
  }

  if (!isLiveStatus(subscription.status)) {
    // Deliberately a refusal even when the campaign is not Pro, because the
    // interesting half of this shape is the Pro one and an operator reading
    // the report should see the whole class in one place.
    return plan(
      RepairClass.CorrectMismatchedCustomer,
      Outcome.RefusedStalePro,
      `Campaign ${campaign.id} carries ${subscription.id}, which is ` +
        `${subscription.status} at Stripe (campaign isPro=${campaign.isPro}). ` +
        `This script will not de-Pro anything. #1955 examined both rows this ` +
        `class ever flagged: each had a sibling subscription on a different ` +
        `Stripe customer, the campaign was correctly Pro from the sibling, ` +
        `and de-Pro-ing would have removed Pro from a paying customer. ` +
        `Nothing in the schema distinguishes a comped campaign from drift ` +
        `either. Human decision, via the admin console so the CRM sync runs.`,
      shared,
    )
  }

  if (campaign.userId === null) {
    return plan(
      RepairClass.CorrectMismatchedCustomer,
      Outcome.RefusedNoOwner,
      `Campaign ${campaign.id} carries a live ${subscription.id} but has no ` +
        `user_id, so there is no metaData.customerId to correct.`,
      shared,
    )
  }

  if (
    !subscription.customerId ||
    campaign.storedCustomerId === subscription.customerId
  ) {
    return plan(
      RepairClass.CorrectMismatchedCustomer,
      Outcome.NoopAlreadyLinked,
      `Campaign ${campaign.id} carries ${subscription.id} and its owner ` +
        `stores the Stripe customer that is billing it. Nothing to repair.`,
      shared,
    )
  }

  // A MISMATCH with nothing stored is a backfill, not a correction: the portal
  // recovers from the campaign's subscriptionId on first click
  // (recoverCustomerIdFromSubscription), so this is not broken — but storing
  // it removes a Stripe round trip and one more way to get it wrong.
  return plan(
    RepairClass.CorrectMismatchedCustomer,
    Outcome.Apply,
    `Subscription ${subscription.id} (${subscription.status}) is billed to ` +
      `Stripe customer ${subscription.customerId}, while its owner (user ` +
      `${campaign.userId}) stores ` +
      `${campaign.storedCustomerId ?? '(none)'}. The subscription's real ` +
      `customer is authoritative — a subscription cannot be reparented ` +
      `between Stripe customers — so the database moves. The billing portal ` +
      `opens the stored one, which is why this is what stops Manage ` +
      `Subscription landing on a customer that holds nothing.`,
    {
      ...shared,
      statements: [
        repointCustomerStatement(
          campaign.userId,
          campaign.storedCustomerId,
          subscription.customerId,
        ),
      ],
      changes: [
        {
          entity: 'user',
          entityId: campaign.userId,
          field: 'metaData.customerId',
          before: campaign.storedCustomerId,
          after: subscription.customerId,
        },
      ],
    },
  )
}

// ── Applying ───────────────────────────────────────────────────────────────

export class RacedPreconditionError extends Error {
  constructor(precondition: string) {
    super(
      `precondition no longer holds (${precondition}); the row changed ` +
        `between the plan and the write, so nothing was applied`,
    )
    this.name = 'RacedPreconditionError'
  }
}

/**
 * Every statement in this file carries its own precondition in its WHERE
 * clause, so a zero rowcount is not a missing row — it is the precondition
 * having stopped being true since the plan was built. Throwing rolls the
 * transaction back, which is the point: a two-statement repair must not
 * half-land because a webhook moved one of the two rows.
 */
const assertSingleRow = async (
  tx: SqlRunner,
  statement: Statement,
): Promise<void> => {
  const affected = await tx.execute(statement.sql, statement.params)
  if (affected !== 1) throw new RacedPreconditionError(statement.precondition)
}

export interface AuditEntry {
  at: string
  repairClass: RepairClass
  subscriptionId: string | null
  campaignId: number | null
  userId: number | null
  entity: FieldChange['entity']
  entityId: number
  field: string
  before: FieldChange['before']
  after: FieldChange['after']
  ownershipSource: OwnershipSource | null
}

export const toAuditEntries = (
  repairPlan: RepairPlan,
  at: string,
): AuditEntry[] =>
  repairPlan.changes.map((change) => ({
    at,
    repairClass: repairPlan.repairClass,
    subscriptionId: repairPlan.subscriptionId,
    campaignId: repairPlan.campaignId,
    userId: repairPlan.userId,
    entity: change.entity,
    entityId: change.entityId,
    field: change.field,
    before: change.before,
    after: change.after,
    ownershipSource: repairPlan.ownershipSource,
  }))

export type AuditSink = (entries: AuditEntry[]) => void

const noopAudit: AuditSink = () => {
  // For callers that only want the plans back. `main` always passes the file
  // sink when applying, so a real run is never silently unaudited.
}

/** Appends one JSON line per applied field change, flushed per row rather than
 * buffered: this is a payments repair, and a crash must not cost the record of
 * what already committed. */
export const createFileAuditSink =
  (path: string): AuditSink =>
  (entries) => {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(
      path,
      entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''),
    )
  }

export interface ApplyResult {
  plan: RepairPlan
  applied: boolean
  error: string | null
}

/**
 * Applies one plan in one transaction, then records it. Ordering is
 * deliberate: the audit line is written after the commit, so the log can
 * under-report a crash but can never claim a change that rolled back.
 */
export const applyPlan = async (
  db: Database,
  repairPlan: RepairPlan,
  audit: AuditSink,
): Promise<ApplyResult> => {
  if (!isApplicable(repairPlan.outcome) || repairPlan.statements.length === 0) {
    return { plan: repairPlan, applied: false, error: null }
  }

  try {
    await db.transaction(async (tx) => {
      for (const statement of repairPlan.statements) {
        await assertSingleRow(tx, statement)
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      plan:
        error instanceof RacedPreconditionError
          ? { ...repairPlan, outcome: Outcome.RefusedRacedPrecondition }
          : repairPlan,
      applied: false,
      error: message,
    }
  }

  audit(toAuditEntries(repairPlan, new Date().toISOString()))
  return { plan: repairPlan, applied: true, error: null }
}

// ── Input list ──────────────────────────────────────────────────────────────

/**
 * The subscription ids in a reconcile report, in report order, deduplicated.
 *
 * Every id the report names is taken, including `relatedSubscriptionIds` on
 * the duplicate classes: those rows are exactly where an orphan hides behind
 * a sibling, and the planner refuses the ones that must not be touched. What
 * is deliberately NOT done is deriving a population from anything other than
 * the operator's file.
 */
export const subscriptionIdsFromReport = (
  report: ReconcileReport,
): string[] => {
  const ids: string[] = []
  const seen = new Set<string>()
  const take = (id: string | null) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const finding of report.findings) {
    take(finding.subscriptionId)
    for (const related of finding.relatedSubscriptionIds) take(related)
  }
  return ids
}

/**
 * STALE_PRO findings whose campaign carries no subscription id at all. They
 * cannot be keyed by subscription, so they would otherwise vanish from a
 * subscription-driven run — and vanishing is the wrong outcome for the one
 * class this script exists to refuse out loud.
 */
export const stalePlansFromReport = (report: ReconcileReport): RepairPlan[] =>
  report.findings
    .filter(
      (finding) =>
        finding.driftClass === 'STALE_PRO' && !finding.subscriptionId,
    )
    .map((finding) =>
      plan(
        RepairClass.CorrectMismatchedCustomer,
        Outcome.RefusedStalePro,
        `Campaign ${finding.campaignId} is Pro with no subscriptionId. ` +
          `Reported, not repaired: de-Pro is not automated here (see the ` +
          `#1955 sibling finding), and a comped campaign is indistinguishable ` +
          `from drift in this schema.`,
        { campaignId: finding.campaignId },
      ),
    )

const isReconcileReport = (value: unknown): value is ReconcileReport =>
  typeof value === 'object' &&
  value !== null &&
  'findings' in value &&
  Array.isArray(value.findings)

export const parseReport = (contents: string): ReconcileReport => {
  const parsed: unknown = JSON.parse(contents)
  if (!isReconcileReport(parsed)) {
    throw new Error(
      'Input is not a stripe-campaign-reconcile report: no "findings" array. ' +
        'Generate it with `stripe-campaign-reconcile.ts --json`.',
    )
  }
  return parsed
}

// ── CLI ────────────────────────────────────────────────────────────────────

export interface Args {
  apply: boolean
  reportPath: string | null
  subscriptionIds: string[]
  normalizeCanceledAt: boolean
  auditLogPath: string
}

const USAGE = `Usage:
  npx tsx scripts/repair-orphaned-pro-subscriptions.ts [options]

Input (at least one required):
  --json <path>            A stripe-campaign-reconcile.ts --json report
  --subscription <sub_id>  One subscription id; repeatable
  --normalize-canceled-at  Also scan for seconds-stamped
                           details.subscriptionCanceledAt and rewrite as ms

Options:
  --apply                  Write. Without it, nothing is written.
  --audit-log <path>       Where applied changes are appended as JSONL`

export const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    apply: false,
    reportPath: null,
    subscriptionIds: [],
    normalizeCanceledAt: false,
    auditLogPath: DEFAULT_AUDIT_LOG,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const valueOf = (): string => {
      const value = argv[++index]
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} needs a value.\n\n${USAGE}`)
      }
      return value
    }

    switch (arg) {
      case '--apply':
        args.apply = true
        break
      case '--json':
        args.reportPath = valueOf()
        break
      case '--subscription':
        args.subscriptionIds.push(valueOf())
        break
      case '--normalize-canceled-at':
        args.normalizeCanceledAt = true
        break
      case '--audit-log':
        args.auditLogPath = valueOf()
        break
      default:
        throw new Error(`Unrecognized option: ${arg}.\n\n${USAGE}`)
    }
  }

  // Refusing an empty run is the difference between a tool that repairs a
  // reviewed list and one that decides for itself what to repair.
  if (
    !args.reportPath &&
    args.subscriptionIds.length === 0 &&
    !args.normalizeCanceledAt
  ) {
    throw new Error(
      `No input. This script never derives its own population — pass the ` +
        `reviewed reconcile report or explicit subscription ids.\n\n${USAGE}`,
    )
  }

  return args
}

/**
 * The three seams a run needs, in one place: what it can read from Stripe,
 * what it can read from Postgres, and what it can write to. Nothing else in
 * the process is reachable from `run`.
 */
export interface RepairContext {
  db: Database
  reader: RepairReader
  stripe: StripeReader
}

export const createRepairContext = (
  prisma: PrismaClient,
  stripe: StripeReader,
): RepairContext => {
  const db = createDatabase(prisma)
  return { db, reader: createRepairReader(db), stripe }
}

export interface RunOptions {
  apply: boolean
  subscriptionIds: string[]
  normalizeCanceledAt: boolean
  reportPlans?: RepairPlan[]
  audit?: AuditSink
}

export interface RunReport {
  plans: RepairPlan[]
  results: ApplyResult[]
  applied: number
  refused: number
  noop: number
  failed: number
}

/**
 * Plans every input row, then applies the applicable ones when `apply` is set.
 * Planning is complete before any write, so the printed plan is the plan that
 * ran — and in dry run the write loop is simply not entered, which is a
 * stronger guarantee than a flag threaded through each statement.
 */
export const run = async (
  { db, reader, stripe }: RepairContext,
  options: RunOptions,
): Promise<RunReport> => {
  const plans: RepairPlan[] = [...(options.reportPlans ?? [])]

  for (const subscriptionId of options.subscriptionIds) {
    plans.push(await planSubscriptionRepair(reader, stripe, subscriptionId))
  }

  if (options.normalizeCanceledAt) {
    for (const row of await reader.campaignsWithCanceledAtStamp()) {
      plans.push(planCanceledAtNormalization(row))
    }
  }

  const results: ApplyResult[] = []
  if (options.apply) {
    const audit = options.audit ?? noopAudit
    for (const repairPlan of plans) {
      results.push(await applyPlan(db, repairPlan, audit))
    }
  }

  const finalPlans = options.apply
    ? results.map((result) => result.plan)
    : plans

  return {
    plans: finalPlans,
    results,
    applied: results.filter((result) => result.applied).length,
    refused: finalPlans.filter((p) => isRefusal(p.outcome)).length,
    noop: finalPlans.filter((p) => p.outcome.startsWith('NOOP_')).length,
    failed: results.filter((result) => result.error !== null).length,
  }
}

// ── Output ─────────────────────────────────────────────────────────────────

const out = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}

export const formatPlan = (repairPlan: RepairPlan): string[] => {
  const lines = [
    `${repairPlan.outcome}  ${repairPlan.repairClass}`,
    `  subscription: ${repairPlan.subscriptionId ?? '(none)'}` +
      `  campaign: ${repairPlan.campaignId ?? '(none)'}` +
      `  user: ${repairPlan.userId ?? '(none)'}`,
    `  ownership: ${repairPlan.ownershipSource ?? '(not resolved)'}`,
    `  ${repairPlan.detail}`,
  ]

  for (const change of repairPlan.changes) {
    lines.push(
      `  ${change.entity} ${change.entityId} ${change.field}: ` +
        `${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`,
    )
  }
  for (const statement of repairPlan.statements) {
    lines.push(`  -- requires: ${statement.precondition}`)
    for (const sqlLine of statement.sql.split('\n')) {
      lines.push(`  ${sqlLine.trim()}`)
    }
    lines.push(`  -- params: ${JSON.stringify(statement.params)}`)
  }
  return lines
}

const printReport = (report: RunReport, apply: boolean): void => {
  out()
  out('══════════════════════════════════════════════')
  out(
    `  Orphaned Pro subscription repair — ${
      apply ? 'APPLY' : 'DRY RUN (nothing written)'
    }`,
  )
  out('══════════════════════════════════════════════')

  const applicable = report.plans.filter((p) => isApplicable(p.outcome))
  const refusals = report.plans.filter((p) => isRefusal(p.outcome))
  const noops = report.plans.filter((p) => p.outcome.startsWith('NOOP_'))

  for (const [heading, group] of [
    [apply ? 'Applied' : 'Would apply', applicable],
    ['Refused — a human decides these', refusals],
    ['Already repaired (no-op)', noops],
  ] as const) {
    if (group.length === 0) continue
    out(`\n── ${heading} (${group.length}) ──────────────────`)
    for (const repairPlan of group) {
      out()
      for (const line of formatPlan(repairPlan)) out(line)
    }
  }

  const failures = report.results.filter((result) => result.error !== null)
  if (failures.length > 0) {
    out(`\n── Failed (${failures.length}) ──────────────────`)
    for (const failure of failures) {
      out(
        `  ${failure.plan.subscriptionId ?? failure.plan.campaignId}: ` +
          `${failure.error}`,
      )
    }
  }

  out(`\nPlanned: ${report.plans.length}`)
  out(`  ${apply ? 'applied' : 'would apply'}: ${applicable.length}`)
  out(`  refused: ${refusals.length}`)
  out(`  no-op:   ${noops.length}`)
  if (apply) out(`  failed:  ${report.failed}`)
  if (!apply && applicable.length > 0) {
    out(`\nNothing was written. Re-run with --apply once the diff above reads`)
    out(`correctly, then re-run stripe-campaign-reconcile.ts to verify.`)
  }
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))

  const secretKey = requireEnv('STRIPE_SECRET_KEY')
  const stripe = createStripeReader(
    new Stripe(secretKey, {
      maxNetworkRetries: 5,
      // #1945's guard: a non-GET cannot reach the wire from this process.
      httpClient: createReadOnlyHttpClient(Stripe.createNodeHttpClient()),
    }),
    proProductIdForKey(secretKey),
  )

  const subscriptionIds = [...args.subscriptionIds]
  const reportPlans: RepairPlan[] = []
  if (args.reportPath) {
    const report = parseReport(readFileSync(args.reportPath, 'utf8'))
    process.stderr.write(
      `Read ${report.findings.length} finding(s) from ${args.reportPath} ` +
        `(generated ${report.generatedAt}). Every row is re-verified against ` +
        `Stripe and the database below; the file supplies ids only.\n`,
    )
    for (const id of subscriptionIdsFromReport(report)) {
      if (!subscriptionIds.includes(id)) subscriptionIds.push(id)
    }
    reportPlans.push(...stalePlansFromReport(report))
  }

  const prisma = new PrismaClient()
  try {
    const report = await run(createRepairContext(prisma, stripe), {
      apply: args.apply,
      subscriptionIds,
      normalizeCanceledAt: args.normalizeCanceledAt,
      reportPlans,
      audit: args.apply ? createFileAuditSink(args.auditLogPath) : undefined,
    })
    printReport(report, args.apply)
    if (args.apply && report.applied > 0) {
      out(`\nAudit log: ${args.auditLogPath}`)
    }
    if (report.failed > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

// Only when invoked directly: under vitest this file is imported for its
// exports and must not open a Prisma client or reach for credentials.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `repair-orphaned-pro-subscriptions failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    process.exit(1)
  })
}
