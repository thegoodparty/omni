/**
 * Stripe ↔ campaign Pro-subscription reconciliation report.
 *
 * STRICTLY READ-ONLY. It issues GETs to Stripe and SELECTs to Postgres, and
 * nothing else. It never refunds, never cancels, never writes a row. Two
 * things enforce that rather than merely promising it: the only Stripe surface
 * the report can reach is `StripeReader`, whose four methods are all reads,
 * and the SDK is handed an http client that runs `assertReadOnlyRequest` in
 * front of the socket, so nothing but a GET can reach Stripe at all. The
 * output is a report a human acts on.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────
 * A campaign's Stripe subscription id lives only in the JSONB column
 * `campaign.details->'subscriptionId'`; there is no subscription table, and
 * `CampaignsService.findBySubscriptionId` is the sole lookup. Several defects
 * lose that linkage (`patchCampaignDetails`'s read-modify-write outside its
 * transaction clobbers the key under concurrency; `UsersService.deleteUser`
 * cancels Stripe only for `campaigns[0]` and only AFTER the cascade delete),
 * and the subscription webhooks answer 502 on a lookup miss rather than
 * recording the drift. Loki holds 30 days, so log archaeology cannot find the
 * older ones. A direct Stripe↔database walk can.
 *
 * ─── Drift classes ───────────────────────────────────────────────────────
 * | Class             | Means                                | Remediation   |
 * |-------------------|--------------------------------------|---------------|
 * | DUPLICATE_BY_EMAIL| >1 Stripe customer record sharing    | Merge the     |
 * |                   | one email, holding >1 non-canceled   | customers,    |
 * |                   | Pro sub between them — one human,    | then refund   |
 * |                   | billed twice (pre-ENG-11084          | and cancel    |
 * |                   | email-only checkout)                 | the extras    |
 * | ORPHANED_ACTIVE   | Live at Stripe, no campaign holds    | Refund and    |
 * |                   | the id — paying for nothing          | cancel, or    |
 * |                   |                                      | re-link       |
 * | DUPLICATE         | One customer, >1 non-canceled Pro    | Keep one,     |
 * |                   | sub (the ENG-10771 / ENG-11083       | refund and    |
 * |                   | double-billing shape)                | cancel rest   |
 * | MISMATCH          | Campaign's stored subscription       | Repoint       |
 * |                   | belongs to a different Stripe        | customerId or |
 * |                   | customer than its stored customerId  | subscriptionId|
 * | STALE_PRO         | `isPro` with no live subscription    | De-Pro, or    |
 * |                   | behind it — Pro for free             | leave if comp |
 * | ORPHANED_CANCELED | Not collecting, no campaign — often  | None; check   |
 * |                   | an account deletion                  | the reason    |
 *
 * The first three cost a customer money, so they sort first and are the only
 * classes that pay for the extra Stripe round trips (paid-invoice total,
 * customer email) needed to size a refund.
 *
 * A subscription appears in exactly one finding. The duplicate classes are
 * computed first and claim their subscriptions, so a person billed twice is
 * one row carrying their combined total — not two orphan rows an operator has
 * to notice belong together and add up by hand. That specific failure mode is
 * what let a confirmed $280 double-billing run for 14 months.
 *
 * ─── How to run ──────────────────────────────────────────────────────────
 *   # Read-only prod credentials. STRIPE_SECRET_KEY is in the GP_API_PROD
 *   # AWS secret; a Stripe restricted key with read-only permissions is the
 *   # better choice when you have one. DATABASE_URL should be the
 *   # readonly_user role from scripts/setup-readonly-role.sh (VPN only).
 *   export STRIPE_SECRET_KEY='sk_live_...'
 *   export DATABASE_URL='postgresql://readonly_user:...@<host>:5432/gpdb'
 *
 *   cd packages/gp-api
 *   npx tsx scripts/stripe-campaign-reconcile.ts
 *   npx tsx scripts/stripe-campaign-reconcile.ts --json > drift.json
 *
 * Options:
 *   --json                  Emit the whole report as JSON on stdout. Progress
 *                           always goes to stderr, so stdout stays parseable.
 *   --skip-invoice-totals   Leave `totalChargedCents` null. Faster on an
 *                           account with many orphans; you lose refund sizing.
 *
 * Runbook (what each class means and what to do about it):
 *   packages/runbooks/books/reconcile-stripe-subscriptions.md
 */
import 'dotenv/config'
import { formatISO, fromUnixTime } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import Stripe from 'stripe'
import { PrismaClient } from '../src/generated/prisma'
import { requireEnv } from '../src/shared/util/env.util'

// Mirrors the product ids in StripeService (src/vendors/stripe/services/
// stripe.service.ts), which branches on the same `includes('live')` test.
// Inlined rather than imported because that module is a Nest provider that
// builds a Stripe client at import time and requires env this report does not.
const LIVE_PRODUCT_ID = 'prod_QCGFVVUhD6q2Jo'
const TEST_PRODUCT_ID = 'prod_QAR4xrqUhyHHqX'

// Stripe rate-limits a full-account subscription walk on a live account. The
// SDK's own retry is exponential with jitter and covers 429 plus connection
// faults, which is what stops the walk dying two thirds of the way through.
const MAX_NETWORK_RETRIES = 5

const PAGE_SIZE = 100

// Statuses that are still collecting money, or are one payment retry from it.
const LIVE_STATUSES: Stripe.Subscription.Status[] = [
  'active',
  'trialing',
  'past_due',
]

// Statuses Stripe will never bill again. Everything else (`incomplete`,
// `unpaid`, `paused`) is neither live nor dead — it counts against the
// duplicate check, because two of them on one customer is still a mistake.
const CANCELED_STATUSES: Stripe.Subscription.Status[] = [
  'canceled',
  'incomplete_expired',
]

export type DriftClass =
  | 'DUPLICATE_BY_EMAIL'
  | 'ORPHANED_ACTIVE'
  | 'DUPLICATE'
  | 'MISMATCH'
  | 'STALE_PRO'
  | 'ORPHANED_CANCELED'

// Report order is refund urgency, not the order the checks run in: the first
// three cost a customer money every month they go unnoticed.
//
// DUPLICATE_BY_EMAIL leads because it is the only class nothing else can see.
// A same-customer duplicate is visible to anyone who opens the customer in the
// Stripe dashboard; a duplicate split across two customer records is not
// visible from either one of them, so it survives exactly as long as nobody
// runs this report. It also carries double the per-person exposure by
// definition.
export const DRIFT_CLASSES_BY_PRIORITY: DriftClass[] = [
  'DUPLICATE_BY_EMAIL',
  'ORPHANED_ACTIVE',
  'DUPLICATE',
  'MISMATCH',
  'STALE_PRO',
  'ORPHANED_CANCELED',
]

/**
 * The fields this report reads off a Stripe subscription, and nothing else.
 * Narrow enough that a test can write one as a literal, wide enough that a
 * real `Stripe.Subscription` satisfies it — the precedent is `UserEmailLookup`
 * in amplitude-flag-cohort.ts.
 */
export interface RawSubscription {
  id: string
  customer: string | { id: string } | null
  status: Stripe.Subscription.Status
  currency?: string | null
  start_date?: number | null
  cancel_at?: number | null
  canceled_at?: number | null
  cancellation_details?: { reason?: string | null } | null
  items: {
    data: {
      current_period_end?: number | null
      price?: {
        unit_amount?: number | null
        currency?: string | null
        product?: string | { id: string } | null
      } | null
    }[]
  }
}

export interface SubscriptionSnapshot {
  id: string
  customerId: string | null
  status: Stripe.Subscription.Status
  amountCents: number | null
  currency: string | null
  startDate: number | null
  currentPeriodEnd: number | null
  cancelAt: number | null
  canceledAt: number | null
  cancellationReason: string | null
}

export interface CampaignRow {
  id: number
  slug: string
  isPro: boolean
  isDemo: boolean
  email: string | null
  subscriptionId: string | null
  customerId: string | null
}

export interface Finding {
  driftClass: DriftClass
  subscriptionId: string | null
  subscriptionStatus: string | null
  // The Stripe customer the subscription actually belongs to.
  customerId: string | null
  customerEmail: string | null
  campaignId: number | null
  campaignSlug: string | null
  campaignIsPro: boolean | null
  accountEmail: string | null
  // `user.metaData.customerId` — what we think the customer is.
  storedCustomerId: string | null
  amountCents: number | null
  currency: string | null
  startDate: string | null
  currentPeriodEnd: string | null
  canceledAt: string | null
  cancellationReason: string | null
  totalChargedCents: number | null
  relatedSubscriptionIds: string[]
  // Populated when a finding covers more than one Stripe customer record,
  // i.e. DUPLICATE_BY_EMAIL. `customerId` is null on those, because the whole
  // point of the class is that there is no single customer to name.
  relatedCustomerIds: string[]
  detail: string
}

export interface ReconcileReport {
  generatedAt: string
  proSubscriptionCount: number
  campaignCount: number
  summary: Record<DriftClass, number>
  findings: Finding[]
}

export const proProductIdForKey = (secretKey: string): string =>
  secretKey.includes('live') ? LIVE_PRODUCT_ID : TEST_PRODUCT_ID

export const isLiveStatus = (status: Stripe.Subscription.Status): boolean =>
  LIVE_STATUSES.includes(status)

export const isCanceledStatus = (status: Stripe.Subscription.Status): boolean =>
  CANCELED_STATUSES.includes(status)

/**
 * The join key for "these two Stripe customer records are one human". Case and
 * surrounding whitespace are noise — Stripe stores whatever was typed at
 * checkout, and the same person typing their address twice is exactly the
 * scenario this exists for.
 *
 * Returns null for an absent or blank address, and callers MUST treat null as
 * "no key" rather than as a key. A deleted Stripe customer reports no email at
 * all, so joining on null would collapse every deleted customer on the account
 * into one fabricated person and invent a duplicate finding out of nothing.
 */
export const normalizeEmail = (
  email: string | null | undefined,
): string | null => email?.trim().toLowerCase() || null

// The report only ever needs GETs, so any other verb means an edit introduced
// a write against production billing data — fail the run instead of letting it
// land.
export const assertReadOnlyRequest = (method: string, path: string): void => {
  if (method.toUpperCase() !== 'GET') {
    throw new Error(
      `stripe-campaign-reconcile is read-only; refusing ${method} ${path}`,
    )
  }
}

/**
 * Wraps Stripe's http client so the read-only check runs in front of the
 * socket. The obvious hook, `stripe.on('request')`, cannot do this job:
 * `RequestSender` calls `httpClient.makeRequest` and emits the event
 * afterwards, so a listener there can only watch a mutation leave, not stop
 * it. Here, a non-GET never reaches the wire.
 */
export const createReadOnlyHttpClient = (
  delegate: Stripe.HttpClient,
): Stripe.HttpClient => ({
  getClientName: () => delegate.getClientName(),
  // Async so a refusal surfaces as a rejected promise, the way every other
  // failure out of this method does — a synchronous throw from something
  // declared to return a promise is its own trap.
  makeRequest: async (
    host,
    port,
    path,
    method,
    headers,
    requestData,
    protocol,
    timeout,
  ) => {
    // The SDK reads any throw from its http client as a connection fault: it
    // burns the network retries and then reports its own "error occurred with
    // our connection to Stripe", which would send an operator chasing a
    // network problem that does not exist. Say what actually happened first.
    try {
      assertReadOnlyRequest(method, path)
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      )
      throw error
    }
    return delegate.makeRequest(
      host,
      port,
      path,
      method,
      headers,
      requestData,
      protocol,
      timeout,
    )
  },
})

const idOf = (
  value: string | { id: string } | null | undefined,
): string | null => (typeof value === 'string' ? value : (value?.id ?? null))

export const isProSubscription = (
  subscription: RawSubscription,
  productId: string,
): boolean =>
  subscription.items.data.some(
    (item) => idOf(item.price?.product) === productId,
  )

export const toSnapshot = (
  subscription: RawSubscription,
): SubscriptionSnapshot => {
  // The 2025-03-31 API version moved the billing period off the subscription
  // and onto its items, and the SDK types followed, so the renewal date has to
  // come off the first item (analytics.service.ts reads it the same way). Pro
  // sessions buy one line item, so the first item is the whole subscription.
  const item = subscription.items.data[0]
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer),
    status: subscription.status,
    amountCents: item?.price?.unit_amount ?? null,
    currency: item?.price?.currency ?? subscription.currency ?? null,
    startDate: subscription.start_date ?? null,
    currentPeriodEnd: item?.current_period_end ?? null,
    cancelAt: subscription.cancel_at ?? null,
    canceledAt: subscription.canceled_at ?? null,
    cancellationReason: subscription.cancellation_details?.reason ?? null,
  }
}

// ── Stripe access ────────────────────────────────────────────────────────────

/**
 * The only Stripe surface the reconciliation can reach. Four reads, no
 * writes — there is no method here that could mutate Stripe even if a later
 * edit tried, which is half of what makes "read-only" a property of the code
 * rather than a claim in a comment. The other half is
 * `assertReadOnlyRequest`.
 */
export interface StripeReader {
  listProSubscriptions(): Promise<SubscriptionSnapshot[]>
  retrieveSubscription(id: string): Promise<SubscriptionSnapshot | null>
  sumPaidInvoiceCents(subscriptionId: string): Promise<number>
  retrieveCustomerEmail(customerId: string): Promise<string | null>
}

/**
 * The slice of the Stripe SDK `createStripeReader` needs. The list methods are
 * typed as async iterables because that is the SDK's auto-pagination surface:
 * `for await` over a list result walks every page, so nothing here has to
 * carry a cursor by hand.
 *
 * `deleted?: true | void` on the customer is not a typo — `Stripe.Customer`
 * declares `deleted?: void` and `Stripe.DeletedCustomer` declares
 * `deleted: true`, and this has to accept both.
 */
export interface StripeReadApi {
  subscriptions: {
    list(params: Stripe.SubscriptionListParams): AsyncIterable<RawSubscription>
    retrieve(id: string): Promise<RawSubscription>
  }
  invoices: {
    list(
      params: Stripe.InvoiceListParams,
    ): AsyncIterable<{ amount_paid?: number | null }>
  }
  customers: {
    retrieve(
      id: string,
    ): Promise<{ deleted?: true | void; email?: string | null }>
  }
}

export const createStripeReader = (
  stripe: StripeReadApi,
  productId: string,
): StripeReader => ({
  listProSubscriptions: async () => {
    const snapshots: SubscriptionSnapshot[] = []
    // `status: 'all'` because the canceled ones are two of the five drift
    // classes. No product filter exists on this endpoint and filtering by the
    // current default price would drop anyone still on an older Pro price —
    // exactly the long-lived subscribers most likely to be stranded — so the
    // product match happens here, over every subscription on the account.
    for await (const subscription of stripe.subscriptions.list({
      status: 'all',
      limit: PAGE_SIZE,
    })) {
      if (isProSubscription(subscription, productId)) {
        snapshots.push(toSnapshot(subscription))
      }
    }
    return snapshots
  },

  retrieveSubscription: async (id) => {
    try {
      return toSnapshot(await stripe.subscriptions.retrieve(id))
    } catch (error) {
      // A stored id Stripe has never heard of is a finding, not a failure:
      // it is how a hard-deleted or test-mode subscription id looks.
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === 'resource_missing'
      ) {
        return null
      }
      throw error
    }
  },

  sumPaidInvoiceCents: async (subscriptionId) => {
    let total = 0
    for await (const invoice of stripe.invoices.list({
      subscription: subscriptionId,
      status: 'paid',
      limit: PAGE_SIZE,
    })) {
      total += invoice.amount_paid ?? 0
    }
    return total
  },

  retrieveCustomerEmail: async (customerId) => {
    try {
      const customer = await stripe.customers.retrieve(customerId)
      return customer.deleted ? null : (customer.email ?? null)
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === 'resource_missing'
      ) {
        return null
      }
      throw error
    }
  },
})

// ── Reconciliation ───────────────────────────────────────────────────────────

const EMPTY_FINDING: Omit<Finding, 'driftClass' | 'detail'> = {
  subscriptionId: null,
  subscriptionStatus: null,
  customerId: null,
  customerEmail: null,
  campaignId: null,
  campaignSlug: null,
  campaignIsPro: null,
  accountEmail: null,
  storedCustomerId: null,
  amountCents: null,
  currency: null,
  startDate: null,
  currentPeriodEnd: null,
  canceledAt: null,
  cancellationReason: null,
  totalChargedCents: null,
  relatedSubscriptionIds: [],
  relatedCustomerIds: [],
}

const buildFinding = (
  driftClass: DriftClass,
  detail: string,
  fields: Partial<Finding>,
): Finding => ({ ...EMPTY_FINDING, driftClass, detail, ...fields })

// Stripe's timestamps are UTC instants. Rendering them in whatever zone the
// operator happens to be in moves a renewal date across a day boundary for
// half the world, which is how two people reading the same report disagree
// about when somebody's next charge lands.
const toIsoDate = (unixSeconds: number | null): string | null =>
  unixSeconds === null
    ? null
    : formatInTimeZone(fromUnixTime(unixSeconds), 'UTC', 'yyyy-MM-dd')

export interface ReconcileOptions {
  includeInvoiceTotals?: boolean
}

/**
 * Walks every Pro subscription at Stripe against every billing-relevant
 * campaign row and returns one finding per drift. Async because two classes
 * need extra Stripe reads: a campaign can point at a subscription the Pro
 * walk never saw (deleted, or on another product), and the refund-sizing
 * classes need paid-invoice totals and the customer's email.
 */
export const reconcile = async (
  stripe: StripeReader,
  campaigns: CampaignRow[],
  { includeInvoiceTotals = true }: ReconcileOptions = {},
): Promise<ReconcileReport> => {
  const subscriptions = await stripe.listProSubscriptions()
  const proSubscriptionsById = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription]),
  )

  const campaignsBySubscriptionId = new Map<string, CampaignRow[]>()
  for (const campaign of campaigns) {
    if (!campaign.subscriptionId) continue
    const existing = campaignsBySubscriptionId.get(campaign.subscriptionId)
    if (existing) existing.push(campaign)
    else campaignsBySubscriptionId.set(campaign.subscriptionId, [campaign])
  }

  // A campaign can carry an id the Pro walk never returned, and several
  // campaigns can carry the same id. Cache the individual lookups so a
  // duplicated or repeatedly-checked id costs one request, not one per row.
  const retrieved = new Map<string, SubscriptionSnapshot | null>()
  const resolveSubscription = async (
    id: string,
  ): Promise<SubscriptionSnapshot | null> => {
    const fromWalk = proSubscriptionsById.get(id)
    if (fromWalk) return fromWalk
    if (retrieved.has(id)) return retrieved.get(id) ?? null
    const snapshot = await stripe.retrieveSubscription(id)
    retrieved.set(id, snapshot)
    return snapshot
  }

  const emailByCustomerId = new Map<string, string | null>()
  const emailOf = async (customerId: string): Promise<string | null> => {
    if (emailByCustomerId.has(customerId)) {
      return emailByCustomerId.get(customerId) ?? null
    }
    const email = await stripe.retrieveCustomerEmail(customerId)
    emailByCustomerId.set(customerId, email)
    return email
  }

  const findings: Finding[] = []

  // Duplicate grouping. Every customer holding a non-canceled Pro
  // subscription, grouped over the Pro walk only, since a second subscription
  // is a second sale and so is on the same product by construction. Computed
  // before the orphan pass because a subscription belongs to exactly one
  // finding: two unlinked subscriptions on one person are ONE billing
  // incident, and reporting them separately would both inflate the queue and
  // count the same dollars twice in two classes.
  const byCustomer = new Map<string, SubscriptionSnapshot[]>()
  for (const subscription of subscriptions) {
    if (!subscription.customerId) continue
    if (isCanceledStatus(subscription.status)) continue
    const existing = byCustomer.get(subscription.customerId)
    if (existing) existing.push(subscription)
    else byCustomer.set(subscription.customerId, [subscription])
  }

  // The second grouping, by email, is what makes the pre-ENG-11084 shape
  // visible: an email-only checkout minted a NEW Stripe customer per completed
  // session, so one person checking out twice ends up as two customer records
  // that hold one subscription each. No same-customer check can see that, ours
  // or Stripe's own, which is why the confirmed case ran 14 months.
  //
  // This is why every customer above gets an email lookup rather than only the
  // ones that end up in a finding — the lookup IS the detection. The cost is
  // one cached GET per customer holding a non-canceled Pro subscription.
  const customerIdsByEmail = new Map<string, string[]>()
  for (const customerId of byCustomer.keys()) {
    const email = normalizeEmail(await emailOf(customerId))
    // A null email is not a join key. See normalizeEmail.
    if (!email) continue
    const existing = customerIdsByEmail.get(email)
    if (existing) existing.push(customerId)
    else customerIdsByEmail.set(email, [customerId])
  }
  const emailGroups = [...customerIdsByEmail].filter(
    ([, customerIds]) => customerIds.length > 1,
  )
  const emailGroupedCustomerIds = new Set(
    emailGroups.flatMap(([, customerIds]) => customerIds),
  )

  // A same-customer duplicate inside an email group is already covered by the
  // DUPLICATE_BY_EMAIL row for that person, which spans all their customer
  // records. Reporting it again would split one human across two findings —
  // the exact fragmentation this change exists to remove.
  const duplicateCustomerIds = new Set(
    [...byCustomer]
      .filter(([, customerSubscriptions]) => customerSubscriptions.length > 1)
      .map(([customerId]) => customerId)
      .filter((customerId) => !emailGroupedCustomerIds.has(customerId)),
  )

  /**
   * Rolls a person's subscriptions into the one number an operator acts on.
   * Splitting this across rows is what let the confirmed case sit unnoticed:
   * two $140 rows do not read as $280 taken from one human unless somebody
   * happens to notice they belong together and adds them up.
   */
  const summarizeExposure = async (customerIds: string[]) => {
    const groupSubscriptions = customerIds.flatMap(
      (customerId) => byCustomer.get(customerId) ?? [],
    )

    let totalChargedCents: number | null = null
    if (includeInvoiceTotals) {
      totalChargedCents = 0
      for (const subscription of groupSubscriptions) {
        totalChargedCents += await stripe.sumPaidInvoiceCents(subscription.id)
      }
    }

    return {
      subscriptions: groupSubscriptions,
      totalChargedCents,
      // Combined per-period price, so the row also says how fast the exposure
      // is still growing — every one of these is billing again next month.
      recurringCents: groupSubscriptions.reduce(
        (sum, subscription) => sum + (subscription.amountCents ?? 0),
        0,
      ),
      currency:
        groupSubscriptions.find((subscription) => subscription.currency)
          ?.currency ?? null,
      unlinked: groupSubscriptions.filter(
        (subscription) => !campaignsBySubscriptionId.has(subscription.id),
      ),
    }
  }

  const describeLinkage = (
    subscriptions: SubscriptionSnapshot[],
    unlinked: SubscriptionSnapshot[],
  ): string =>
    unlinked.length === 0
      ? 'Every one of them is linked to a campaign.'
      : unlinked.length === subscriptions.length
        ? `None of them is linked to any campaign.`
        : `${unlinked.length} of them (${unlinked
            .map((subscription) => subscription.id)
            .join(', ')}) is not linked to any campaign.`

  // ORPHANED_ACTIVE / ORPHANED_CANCELED — at Stripe, nowhere in our database.
  for (const subscription of subscriptions) {
    if (campaignsBySubscriptionId.has(subscription.id)) continue

    const live = isLiveStatus(subscription.status)
    // Reported under one of the duplicate classes instead, which carry every
    // subscription id and the combined total. A canceled sibling is in neither
    // grouping, so it still lands below as its own ORPHANED_CANCELED row.
    if (live && subscription.customerId) {
      if (duplicateCustomerIds.has(subscription.customerId)) continue
      if (emailGroupedCustomerIds.has(subscription.customerId)) continue
    }
    const shared = {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      customerId: subscription.customerId,
      amountCents: subscription.amountCents,
      currency: subscription.currency,
      startDate: toIsoDate(subscription.startDate),
      currentPeriodEnd: toIsoDate(subscription.currentPeriodEnd),
      canceledAt: toIsoDate(subscription.canceledAt),
      cancellationReason: subscription.cancellationReason,
    }

    if (!live) {
      findings.push(
        buildFinding(
          'ORPHANED_CANCELED',
          `Subscription is ${subscription.status} at Stripe and no campaign ` +
            `carries its id. Usually an account deletion; the cancellation ` +
            `reason is what tells a real cancellation apart from one.`,
          shared,
        ),
      )
      continue
    }

    findings.push(
      buildFinding(
        'ORPHANED_ACTIVE',
        `Subscription is ${subscription.status} at Stripe and no campaign ` +
          `carries its id. This customer is being billed for nothing.`,
        {
          ...shared,
          customerEmail: subscription.customerId
            ? await emailOf(subscription.customerId)
            : null,
          totalChargedCents: includeInvoiceTotals
            ? await stripe.sumPaidInvoiceCents(subscription.id)
            : null,
        },
      ),
    )
  }

  // DUPLICATE_BY_EMAIL — two or more Stripe customer records, one human.
  for (const [email, customerIds] of emailGroups) {
    const exposure = await summarizeExposure(customerIds)

    findings.push(
      buildFinding(
        'DUPLICATE_BY_EMAIL',
        `${customerIds.length} Stripe customer records share one email and ` +
          `hold ${exposure.subscriptions.length} non-canceled Pro ` +
          `subscriptions between them (${exposure.subscriptions
            .map(
              (subscription) =>
                `${subscription.id} ${subscription.status} on ` +
                `${subscription.customerId}`,
            )
            .join(', ')}). This is the pre-ENG-11084 email-only checkout ` +
          `shape: each completed session minted a new customer, so no ` +
          `same-customer check can see it. One person, billed more than ` +
          `once. ` +
          describeLinkage(exposure.subscriptions, exposure.unlinked) +
          ` Remediation needs the customer records merged as well as the ` +
          `extra subscriptions cancelled and refunded.`,
        {
          customerEmail: email,
          relatedCustomerIds: customerIds,
          relatedSubscriptionIds: exposure.subscriptions.map(({ id }) => id),
          totalChargedCents: exposure.totalChargedCents,
          amountCents: exposure.recurringCents,
          currency: exposure.currency,
        },
      ),
    )
  }

  // DUPLICATE — one customer record holding more than one of them.
  for (const customerId of duplicateCustomerIds) {
    const exposure = await summarizeExposure([customerId])

    findings.push(
      buildFinding(
        'DUPLICATE',
        `Stripe customer holds ${exposure.subscriptions.length} ` +
          `non-canceled Pro subscriptions (${exposure.subscriptions
            .map((subscription) => `${subscription.id} ${subscription.status}`)
            .join(', ')}). This is the ENG-10771 / ENG-11083 ` +
          `double-billing shape — treat as urgent. ` +
          describeLinkage(exposure.subscriptions, exposure.unlinked),
        {
          customerId,
          customerEmail: await emailOf(customerId),
          relatedCustomerIds: [customerId],
          relatedSubscriptionIds: exposure.subscriptions.map(({ id }) => id),
          totalChargedCents: exposure.totalChargedCents,
          amountCents: exposure.recurringCents,
          currency: exposure.currency,
        },
      ),
    )
  }

  // STALE_PRO / MISMATCH — start from the campaign side.
  for (const campaign of campaigns) {
    const subscription = campaign.subscriptionId
      ? await resolveSubscription(campaign.subscriptionId)
      : null

    const campaignFields = {
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      campaignIsPro: campaign.isPro,
      accountEmail: campaign.email,
      storedCustomerId: campaign.customerId,
      subscriptionId: campaign.subscriptionId,
      subscriptionStatus: subscription?.status ?? null,
    }

    // Demo campaigns are excluded: they are seeded Pro on purpose and would
    // otherwise be most of this class.
    if (campaign.isPro && !campaign.isDemo) {
      const staleReason = !campaign.subscriptionId
        ? 'no subscriptionId is stored on the campaign'
        : !subscription
          ? `stored subscription ${campaign.subscriptionId} does not exist ` +
            `at Stripe`
          : !isLiveStatus(subscription.status)
            ? `stored subscription ${campaign.subscriptionId} is ` +
              `${subscription.status} at Stripe`
            : null

      if (staleReason) {
        findings.push(
          buildFinding(
            'STALE_PRO',
            `Campaign is Pro but ${staleReason}. Either Pro for free, or a ` +
              `comped campaign — check before de-Pro-ing.`,
            {
              ...campaignFields,
              customerId: subscription?.customerId ?? null,
              canceledAt: toIsoDate(subscription?.canceledAt ?? null),
              cancellationReason: subscription?.cancellationReason ?? null,
            },
          ),
        )
      }
    }

    // Only while the subscription is still collecting. A de-Pro'd campaign
    // routinely keeps a stale `subscriptionId` pointing at a long-dead
    // subscription, and a disagreement about a customer nobody is billing is
    // not a finding — it is the ordinary residue of a cancellation. `isPro`
    // is reported rather than required, because a campaign that is NOT Pro
    // while a live subscription bills under a third customer is worse, not
    // better.
    if (
      subscription?.customerId &&
      campaign.customerId &&
      subscription.customerId !== campaign.customerId &&
      isLiveStatus(subscription.status)
    ) {
      findings.push(
        buildFinding(
          'MISMATCH',
          `Subscription ${subscription.id} (${subscription.status}) belongs ` +
            `to Stripe customer ${subscription.customerId}, but the ` +
            `campaign's owner stores ${campaign.customerId}. One of the two ` +
            `pointers is wrong — the billing portal opens the stored one.`,
          {
            ...campaignFields,
            customerId: subscription.customerId,
            amountCents: subscription.amountCents,
            currency: subscription.currency,
          },
        ),
      )
    }
  }

  findings.sort(
    (a, b) =>
      DRIFT_CLASSES_BY_PRIORITY.indexOf(a.driftClass) -
      DRIFT_CLASSES_BY_PRIORITY.indexOf(b.driftClass),
  )

  return {
    generatedAt: formatISO(new Date()),
    proSubscriptionCount: subscriptions.length,
    campaignCount: campaigns.length,
    summary: summarize(findings),
    findings,
  }
}

export const summarize = (findings: Finding[]): Record<DriftClass, number> => {
  const summary = {
    DUPLICATE_BY_EMAIL: 0,
    ORPHANED_ACTIVE: 0,
    DUPLICATE: 0,
    MISMATCH: 0,
    STALE_PRO: 0,
    ORPHANED_CANCELED: 0,
  }
  for (const finding of findings) summary[finding.driftClass]++
  return summary
}

// ── Database access (SELECT only) ────────────────────────────────────────────

/**
 * Every campaign that could carry billing state: Pro ones (candidates for
 * STALE_PRO) and any campaign holding a subscription id (what the Stripe walk
 * is matched against). Rows with neither cannot produce a finding.
 */
export const fetchBillingRelevantCampaigns = async (
  prisma: PrismaClient,
): Promise<CampaignRow[]> =>
  prisma.$queryRaw<CampaignRow[]>`
    SELECT c.id                          AS "id",
           c.slug                        AS "slug",
           c.is_pro                      AS "isPro",
           c.is_demo                     AS "isDemo",
           c.details->>'subscriptionId'  AS "subscriptionId",
           u.email                       AS "email",
           u.meta_data->>'customerId'    AS "customerId"
    FROM campaign c
    LEFT JOIN "user" u ON u.id = c.user_id
    WHERE c.is_pro = true
       OR c.details->>'subscriptionId' IS NOT NULL
    ORDER BY c.id
  `

// ── Output ───────────────────────────────────────────────────────────────────

export const formatCents = (
  cents: number | null,
  currency: string | null,
): string =>
  cents === null
    ? ''
    : `${(cents / 100).toFixed(2)} ${(currency ?? 'usd').toUpperCase()}`

// One projection per class: a single 18-column table would be mostly blanks,
// since no class populates more than a third of the fields.
const toTableRow = (finding: Finding): Record<string, string | number> => {
  switch (finding.driftClass) {
    case 'ORPHANED_ACTIVE':
      return {
        subscription: finding.subscriptionId ?? '',
        customer: finding.customerId ?? '',
        email: finding.customerEmail ?? '',
        status: finding.subscriptionStatus ?? '',
        amount: formatCents(finding.amountCents, finding.currency),
        started: finding.startDate ?? '',
        renewsOn: finding.currentPeriodEnd ?? '',
        chargedToDate: formatCents(finding.totalChargedCents, finding.currency),
      }
    // The two duplicate classes share a shape except for the column that
    // distinguishes them: one names a customer, the other names several.
    case 'DUPLICATE_BY_EMAIL':
      return {
        email: finding.customerEmail ?? '',
        customers: finding.relatedCustomerIds.join(' '),
        subscriptions: finding.relatedSubscriptionIds.join(' '),
        perPeriod: formatCents(finding.amountCents, finding.currency),
        chargedToDate: formatCents(finding.totalChargedCents, finding.currency),
      }
    case 'DUPLICATE':
      return {
        customer: finding.customerId ?? '',
        email: finding.customerEmail ?? '',
        subscriptions: finding.relatedSubscriptionIds.join(' '),
        perPeriod: formatCents(finding.amountCents, finding.currency),
        chargedToDate: formatCents(finding.totalChargedCents, finding.currency),
      }
    case 'MISMATCH':
      return {
        campaign: finding.campaignId ?? '',
        slug: finding.campaignSlug ?? '',
        isPro: finding.campaignIsPro ? 'yes' : 'no',
        subscription: finding.subscriptionId ?? '',
        status: finding.subscriptionStatus ?? '',
        subscriptionCustomer: finding.customerId ?? '',
        storedCustomer: finding.storedCustomerId ?? '',
      }
    case 'STALE_PRO':
      return {
        campaign: finding.campaignId ?? '',
        slug: finding.campaignSlug ?? '',
        email: finding.accountEmail ?? '',
        subscription: finding.subscriptionId ?? '(none)',
        status: finding.subscriptionStatus ?? '(not at Stripe)',
        canceledOn: finding.canceledAt ?? '',
      }
    case 'ORPHANED_CANCELED':
      return {
        subscription: finding.subscriptionId ?? '',
        customer: finding.customerId ?? '',
        status: finding.subscriptionStatus ?? '',
        canceledOn: finding.canceledAt ?? '',
        reason: finding.cancellationReason ?? '(none given)',
      }
  }
}

const log = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

const printReport = (report: ReconcileReport): void => {
  console.log('\n══════════════════════════════════════════')
  console.log('  Stripe ↔ campaign reconciliation')
  console.log('══════════════════════════════════════════')
  console.log(`  Generated:           ${report.generatedAt}`)
  console.log(`  Pro subscriptions:   ${report.proSubscriptionCount}`)
  console.log(`  Campaigns examined:  ${report.campaignCount}`)
  console.log('\n  --- Findings by drift class ---')
  for (const driftClass of DRIFT_CLASSES_BY_PRIORITY) {
    console.log(`    ${driftClass}: ${report.summary[driftClass]}`)
  }

  for (const driftClass of DRIFT_CLASSES_BY_PRIORITY) {
    const rows = report.findings.filter(
      (finding) => finding.driftClass === driftClass,
    )
    if (rows.length === 0) continue
    console.log(`\n── ${driftClass} (${rows.length}) ─────────────────────`)
    console.table(rows.map(toTableRow))
  }

  if (report.findings.length === 0) {
    console.log('\n  No drift found. Stripe and the database agree.')
  }
}

export interface Args {
  json: boolean
  skipInvoiceTotals: boolean
}

export const parseArgs = (argv: string[]): Args => {
  const known = ['--json', '--skip-invoice-totals']
  const unknown = argv.filter((arg) => !known.includes(arg))
  if (unknown.length > 0) {
    throw new Error(
      `Unrecognized option(s): ${unknown.join(', ')}. ` +
        `Supported: ${known.join(', ')}.`,
    )
  }
  return {
    json: argv.includes('--json'),
    skipInvoiceTotals: argv.includes('--skip-invoice-totals'),
  }
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const secretKey = requireEnv('STRIPE_SECRET_KEY')
  const productId = proProductIdForKey(secretKey)

  const stripe = new Stripe(secretKey, {
    maxNetworkRetries: MAX_NETWORK_RETRIES,
    httpClient: createReadOnlyHttpClient(Stripe.createNodeHttpClient()),
  })

  const prisma = new PrismaClient()
  try {
    log('Reading campaigns from the database...')
    const campaigns = await fetchBillingRelevantCampaigns(prisma)
    log(`  ${campaigns.length} campaign(s) carry Pro or subscription state`)

    log(`Walking Stripe subscriptions for product ${productId}...`)
    const report = await reconcile(
      createStripeReader(stripe, productId),
      campaigns,
      { includeInvoiceTotals: !args.skipInvoiceTotals },
    )
    log(`  ${report.proSubscriptionCount} Pro subscription(s) at Stripe`)
    log(`  ${report.findings.length} finding(s)`)

    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      printReport(report)
    }
  } finally {
    await prisma.$disconnect()
  }
}

// Only run when invoked directly. Under vitest the file is imported for its
// exports and must not open a Prisma client or reach for Stripe credentials.
if (require.main === module) {
  main().catch((error) => {
    console.error('stripe-campaign-reconcile failed:', error)
    process.exit(1)
  })
}
