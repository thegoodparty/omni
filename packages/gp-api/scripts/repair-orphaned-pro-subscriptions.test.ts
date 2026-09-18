import Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import {
  assertReadOnlyRequest,
  createReadOnlyHttpClient,
  type ReconcileReport,
  type StripeReader,
  type SubscriptionSnapshot,
} from './stripe-campaign-reconcile'
import {
  applyPlan,
  createRepairReader,
  classifyCanceledAt,
  createDatabase,
  findCampaignsBySubscriptionId,
  findCampaignsByUserId,
  findCampaignsWithCanceledAtStamp,
  findUserByEmail,
  findUserById,
  normalizeCanceledAtStatement,
  Outcome,
  OwnershipSource,
  parseArgs,
  parseReport,
  planCanceledAtNormalization,
  planSubscriptionRepair,
  RepairClass,
  relinkCampaignStatement,
  repointCustomerStatement,
  resolveOwner,
  run,
  SECONDS_CEILING,
  stalePlansFromReport,
  subscriptionIdsFromReport,
  toAuditEntries,
  type AuditEntry,
  type CampaignRow,
  type CanceledAtRow,
  type Database,
  type RepairContext,
  type RepairPlan,
  type RepairReader,
  type UserRow,
} from './repair-orphaned-pro-subscriptions'
import { useTestService } from '../src/test-service'

// Real Stripe ids from the reconciled production population (#1955), which is
// what makes these read as the incident rather than as invented shapes. Stripe
// object ids are not PII; every email below is synthetic.
const ORPHAN = {
  subscriptionId: 'sub_1TAcBr1taBPnTqn4UgzocpUD',
  customerId: 'cus_U8tz6wNnRMcgun',
}
// The pair #1955 corrected the STALE_PRO read on: the orphan and the sibling
// that the campaign actually carried, on two different Stripe customers.
const SIBLING_ORPHAN = {
  subscriptionId: 'sub_1TlI0T1taBPnTqn4wXcOjDJQ',
  customerId: 'cus_Ukna4d5HsEPEVJ',
}
const SIBLING_CARRIED = {
  subscriptionId: 'sub_1TlI1R1taBPnTqn4oS420TSf',
  customerId: 'cus_UknccQ7rRAO1U5',
}

const snapshot = (
  overrides: Partial<SubscriptionSnapshot> & { id: string },
): SubscriptionSnapshot => ({
  customerId: null,
  status: 'active',
  metadata: {},
  amountCents: 1000,
  currency: 'usd',
  startDate: null,
  currentPeriodEnd: null,
  cancelAt: null,
  canceledAt: null,
  cancellationReason: null,
  ...overrides,
})

const campaignRow = (
  overrides: Partial<CampaignRow> & { id: number },
): CampaignRow => ({
  slug: `campaign-${overrides.id}`,
  userId: 500,
  isPro: false,
  isDemo: false,
  subscriptionId: null,
  storedCustomerId: null,
  ...overrides,
})

const stubStripe = (
  subscriptions: SubscriptionSnapshot[],
  emails: Record<string, string> = {},
): StripeReader => ({
  listProSubscriptions: async () => subscriptions,
  retrieveSubscription: async (id) =>
    subscriptions.find((subscription) => subscription.id === id) ?? null,
  sumPaidInvoiceCents: async () => 0,
  retrieveCustomerEmail: async (customerId) => emails[customerId] ?? null,
})

/**
 * A typed `RepairReader`. The planner's job is the decision, not the SQL, so
 * these cases hand it fixtures directly; the statements and the SELECTs are
 * checked against a real Postgres further down, where a wrong column shows up.
 */
const stubReader = (fixtures: {
  campaignsBySubscriptionId?: Record<string, CampaignRow[]>
  campaignsByUserId?: Record<number, CampaignRow[]>
  usersById?: Record<number, UserRow>
  usersByEmail?: Record<string, UserRow>
  canceledAtRows?: CanceledAtRow[]
}): RepairReader => ({
  campaignsBySubscriptionId: async (subscriptionId) =>
    fixtures.campaignsBySubscriptionId?.[subscriptionId] ?? [],
  campaignsByUserId: async (userId) =>
    fixtures.campaignsByUserId?.[userId] ?? [],
  userById: async (id) => fixtures.usersById?.[id] ?? null,
  userByEmail: async (email) => fixtures.usersByEmail?.[email] ?? null,
  campaignsWithCanceledAtStamp: async () => fixtures.canceledAtRows ?? [],
})

describe('classifyCanceledAt', () => {
  // The whole repair turns on this discrimination, so both real units and the
  // boundary are asserted rather than assumed.
  it('reads a Stripe canceled_at as seconds', () => {
    expect(classifyCanceledAt('1757125244')).toBe('seconds')
  })

  it('reads a Date.now() stamp as milliseconds', () => {
    expect(classifyCanceledAt('1757125244000')).toBe('milliseconds')
  })

  it('puts the ceiling itself on the milliseconds side', () => {
    expect(classifyCanceledAt(String(SECONDS_CEILING))).toBe('milliseconds')
    expect(classifyCanceledAt(String(SECONDS_CEILING - 1))).toBe('seconds')
  })

  it('refuses to guess at a non-integer stamp', () => {
    expect(classifyCanceledAt('1757125244.5')).toBe('unknown')
    expect(classifyCanceledAt('not-a-date')).toBe('unknown')
    expect(classifyCanceledAt(null)).toBe('unknown')
  })

  // The digits-only check is not redundant with the integer check, and these
  // are the inputs that prove it: `Number('')` is 0, `Number('1e9')` is a
  // whole number, and `Number('0x1a')` is 26. All three would be accepted as
  // an epoch — and 0 would be "scaled" to 1970 in milliseconds — by a guard
  // that only asked whether the coerced value was an integer.
  it('refuses text that coerces to a whole number but is not a digit string', () => {
    expect(classifyCanceledAt('')).toBe('unknown')
    expect(classifyCanceledAt('1e9')).toBe('unknown')
    expect(classifyCanceledAt('0x1a')).toBe('unknown')
  })
})

describe('planCanceledAtNormalization', () => {
  const row = (canceledAtRaw: string | null) => ({
    id: 325636,
    slug: 'campaign-325636',
    userId: 500,
    subscriptionId: null,
    canceledAtRaw,
  })

  it('scales a seconds stamp to milliseconds', () => {
    const plan = planCanceledAtNormalization(row('1757125244'))

    expect(plan.outcome).toBe(Outcome.Apply)
    expect(plan.changes).toEqual([
      {
        entity: 'campaign',
        entityId: 325636,
        field: 'details.subscriptionCanceledAt',
        before: 1757125244,
        after: 1757125244000,
      },
    ])
  })

  // Re-running a completed normalisation must not multiply again. This is the
  // property an operator relies on to verify the first run worked.
  it('leaves a value that is already milliseconds alone', () => {
    const plan = planCanceledAtNormalization(row('1757125244000'))

    expect(plan.outcome).toBe(Outcome.NoopAlreadyMilliseconds)
    expect(plan.statements).toEqual([])
    expect(plan.changes).toEqual([])
  })

  it('refuses a stamp that is not an integer epoch', () => {
    const plan = planCanceledAtNormalization(row('1757125244.5'))

    expect(plan.outcome).toBe(Outcome.RefusedNonIntegerStamp)
    expect(plan.statements).toEqual([])
  })
})

describe('resolveOwner', () => {
  const live = snapshot({
    id: ORPHAN.subscriptionId,
    customerId: ORPHAN.customerId,
    metadata: { userId: '742' },
  })

  it('prefers subscription.metadata.userId over the customer email', async () => {
    const db = stubReader({
      usersById: { 742: { id: 742, storedCustomerId: null, isDeleted: false } },
      usersByEmail: {
        'someone@example.com': {
          id: 999,
          storedCustomerId: null,
          isDeleted: false,
        },
      },
    })
    const stripe = stubStripe([live], {
      [ORPHAN.customerId]: 'someone@example.com',
    })

    const resolution = await resolveOwner(db, stripe, live)

    expect(resolution.user?.id).toBe(742)
    expect(resolution.source).toBe(OwnershipSource.SubscriptionMetadata)
  })

  // The metadata is `{}` on every subscription the reconciliation examined, so
  // this is the path that carries production.
  it('falls back to the email on the Stripe customer, and says so', async () => {
    const withoutMetadata = snapshot({
      id: ORPHAN.subscriptionId,
      customerId: ORPHAN.customerId,
    })
    const db = stubReader({
      usersByEmail: {
        'candidate@example.com': {
          id: 812,
          storedCustomerId: null,
          isDeleted: false,
        },
      },
    })
    const stripe = stubStripe([withoutMetadata], {
      [ORPHAN.customerId]: 'Candidate@Example.com ',
    })

    const resolution = await resolveOwner(db, stripe, withoutMetadata)

    expect(resolution.user?.id).toBe(812)
    expect(resolution.source).toBe(OwnershipSource.StripeCustomerEmail)
    expect(resolution.detail).toContain('arbitrary addresses')
  })

  it('resolves nobody when metadata names a user that does not exist', async () => {
    const db = stubReader({})
    const stripe = stubStripe([live], {
      [ORPHAN.customerId]: 'candidate@example.com',
    })

    const resolution = await resolveOwner(db, stripe, live)

    expect(resolution.user).toBeNull()
    expect(resolution.source).toBeNull()
  })

  it('will not re-link a deleted account', async () => {
    const db = stubReader({
      usersById: { 742: { id: 742, storedCustomerId: null, isDeleted: true } },
    })

    const resolution = await resolveOwner(db, stubStripe([live]), live)

    expect(resolution.user).toBeNull()
    expect(resolution.detail).toContain('deleted account')
  })
})

describe('planSubscriptionRepair', () => {
  const orphan = snapshot({
    id: ORPHAN.subscriptionId,
    customerId: ORPHAN.customerId,
    metadata: { userId: '742' },
  })
  const owner = { id: 742, storedCustomerId: null, isDeleted: false }

  it('re-links a live orphan to its owner’s only campaign', async () => {
    const db = stubReader({
      usersById: { 742: owner },
      campaignsByUserId: { 742: [campaignRow({ id: 325506, userId: 742 })] },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([orphan]),
      ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.Apply)
    expect(plan.repairClass).toBe(RepairClass.RelinkOrphanedActive)
    expect(plan.campaignId).toBe(325506)
    expect(plan.ownershipSource).toBe(OwnershipSource.SubscriptionMetadata)
    expect(
      plan.changes.map(({ field, before, after }) => ({
        field,
        before,
        after,
      })),
    ).toEqual([
      {
        field: 'details.subscriptionId',
        before: null,
        after: ORPHAN.subscriptionId,
      },
      { field: 'isPro', before: false, after: true },
      expect.objectContaining({ field: 'details.isProUpdatedAt' }),
      {
        field: 'metaData.customerId',
        before: null,
        after: ORPHAN.customerId,
      },
    ])
  })

  // The single most important refusal in the script. Overwriting a non-null
  // subscriptionId orphans whatever it pointed at, which is the ENG-11084
  // double-billing mechanism reproduced by the repair meant to fix it.
  it('refuses when the target campaign already carries a different subscription', async () => {
    const db = stubReader({
      usersById: { 742: owner },
      campaignsByUserId: {
        742: [
          campaignRow({
            id: 325506,
            userId: 742,
            isPro: true,
            subscriptionId: SIBLING_CARRIED.subscriptionId,
          }),
        ],
      },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([
        snapshot({
          id: SIBLING_ORPHAN.subscriptionId,
          customerId: SIBLING_ORPHAN.customerId,
          metadata: { userId: '742' },
        }),
      ]),
      SIBLING_ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.RefusedSiblingSubscription)
    expect(plan.statements).toEqual([])
    expect(plan.detail).toContain('SIBLING TRAP')
    expect(plan.detail).toContain(SIBLING_CARRIED.subscriptionId)
  })

  it('reports a hard-deleted campaign as refund-and-cancel rather than repairing it', async () => {
    const db = stubReader({
      usersById: { 742: owner },
      campaignsByUserId: { 742: [] },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([orphan]),
      ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.RefusedNoCampaign)
    expect(plan.statements).toEqual([])
    expect(plan.detail).toContain('refund-and-cancel')
  })

  it('skips a demo campaign, which is seeded Pro deliberately', async () => {
    const db = stubReader({
      usersById: { 742: owner },
      campaignsByUserId: {
        742: [campaignRow({ id: 1, userId: 742, isDemo: true, isPro: true })],
      },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([orphan]),
      ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.RefusedDemoCampaign)
    expect(plan.statements).toEqual([])
  })

  it('refuses to guess which of several campaigns a subscription paid for', async () => {
    const db = stubReader({
      usersById: { 742: owner },
      campaignsByUserId: {
        742: [
          campaignRow({ id: 1, userId: 742 }),
          campaignRow({ id: 2, userId: 742 }),
        ],
      },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([orphan]),
      ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.RefusedAmbiguousCampaign)
    expect(plan.statements).toEqual([])
  })

  it('refuses a subscription Stripe has never heard of', async () => {
    const plan = await planSubscriptionRepair(
      stubReader({}),
      stubStripe([]),
      ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.RefusedNotAtStripe)
    expect(plan.statements).toEqual([])
  })

  it('leaves a canceled orphan to the refund decision', async () => {
    const plan = await planSubscriptionRepair(
      stubReader({}),
      stubStripe([
        snapshot({
          id: SIBLING_ORPHAN.subscriptionId,
          customerId: SIBLING_ORPHAN.customerId,
          status: 'canceled',
        }),
      ]),
      SIBLING_ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.RefusedNotLive)
    expect(plan.statements).toEqual([])
  })

  // #1955 proved this classification wrong on both rows it ever flagged: each
  // had a sibling on another Stripe customer that the campaign carried, and
  // de-Pro-ing would have removed Pro from a correctly-billed campaign.
  it('refuses to de-Pro a campaign carrying a dead subscription', async () => {
    const db = stubReader({
      campaignsBySubscriptionId: {
        [SIBLING_CARRIED.subscriptionId]: [
          campaignRow({
            id: 325506,
            userId: 742,
            isPro: true,
            subscriptionId: SIBLING_CARRIED.subscriptionId,
            storedCustomerId: SIBLING_CARRIED.customerId,
          }),
        ],
      },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([
        snapshot({
          id: SIBLING_CARRIED.subscriptionId,
          customerId: SIBLING_CARRIED.customerId,
          status: 'canceled',
        }),
      ]),
      SIBLING_CARRIED.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.RefusedStalePro)
    expect(plan.statements).toEqual([])
    expect(plan.detail).toContain('will not de-Pro')
  })

  it('corrects a mismatched customer on a campaign that carries the subscription', async () => {
    const db = stubReader({
      campaignsBySubscriptionId: {
        [ORPHAN.subscriptionId]: [
          campaignRow({
            id: 325506,
            userId: 742,
            isPro: true,
            subscriptionId: ORPHAN.subscriptionId,
            storedCustomerId: SIBLING_CARRIED.customerId,
          }),
        ],
      },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([orphan]),
      ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.Apply)
    expect(plan.repairClass).toBe(RepairClass.CorrectMismatchedCustomer)
    expect(plan.changes).toEqual([
      {
        entity: 'user',
        entityId: 742,
        field: 'metaData.customerId',
        before: SIBLING_CARRIED.customerId,
        after: ORPHAN.customerId,
      },
    ])
  })

  // What a successful repair looks like the second time it is run.
  it('is a no-op once the campaign carries it and the customer agrees', async () => {
    const db = stubReader({
      campaignsBySubscriptionId: {
        [ORPHAN.subscriptionId]: [
          campaignRow({
            id: 325506,
            userId: 742,
            isPro: true,
            subscriptionId: ORPHAN.subscriptionId,
            storedCustomerId: ORPHAN.customerId,
          }),
        ],
      },
    })

    const plan = await planSubscriptionRepair(
      db,
      stubStripe([orphan]),
      ORPHAN.subscriptionId,
    )

    expect(plan.outcome).toBe(Outcome.NoopAlreadyLinked)
    expect(plan.statements).toEqual([])
  })
})

describe('input list', () => {
  const report = (findings: Partial<ReconcileReport['findings'][0]>[]) =>
    ({
      generatedAt: '2026-09-18T00:00:00Z',
      proSubscriptionCount: 0,
      campaignCount: 0,
      summary: {
        DUPLICATE_BY_EMAIL: 0,
        ORPHANED_ACTIVE: 0,
        DUPLICATE: 0,
        MISMATCH: 0,
        STALE_PRO: 0,
        ORPHANED_CANCELED: 0,
      },
      findings: findings.map((finding) => ({
        driftClass: 'ORPHANED_ACTIVE',
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
        detail: '',
        ...finding,
      })),
    }) as ReconcileReport

  it('takes every subscription id the report names, including the related ones', () => {
    expect(
      subscriptionIdsFromReport(
        report([
          { subscriptionId: ORPHAN.subscriptionId },
          {
            driftClass: 'DUPLICATE_BY_EMAIL',
            relatedSubscriptionIds: [
              SIBLING_ORPHAN.subscriptionId,
              SIBLING_CARRIED.subscriptionId,
            ],
          },
          // Duplicated deliberately: the same subscription may appear in more
          // than one place in a hand-edited file.
          { subscriptionId: ORPHAN.subscriptionId },
        ]),
      ),
    ).toEqual([
      ORPHAN.subscriptionId,
      SIBLING_ORPHAN.subscriptionId,
      SIBLING_CARRIED.subscriptionId,
    ])
  })

  it('carries a STALE_PRO finding with no subscription id through as a refusal', () => {
    const plans = stalePlansFromReport(
      report([
        { driftClass: 'STALE_PRO', campaignId: 325636, subscriptionId: null },
        { driftClass: 'STALE_PRO', subscriptionId: ORPHAN.subscriptionId },
      ]),
    )

    expect(plans).toHaveLength(1)
    expect(plans[0].outcome).toBe(Outcome.RefusedStalePro)
    expect(plans[0].campaignId).toBe(325636)
  })

  // Both shapes, because the wrong file is usually a near miss: a report from
  // some other script, or a `findings` key holding something that is not the
  // list of rows this script iterates.
  it.each([
    ['no findings key at all', '{"rows":[]}'],
    ['a findings key that is not an array', '{"findings":{"sub_x":"orphan"}}'],
    ['a findings key holding a string', '{"findings":"ORPHANED_ACTIVE"}'],
    ['a bare array rather than a report', '[]'],
  ])('rejects a file with %s', (_label, contents) => {
    expect(() => parseReport(contents)).toThrow(/not a .*reconcile report/)
  })
})

describe('parseArgs', () => {
  // Dry-run by default is the whole safety posture. If this ever inverts,
  // every other guard is downstream of a write that already happened.
  it('does not apply unless --apply is passed', () => {
    expect(parseArgs(['--subscription', ORPHAN.subscriptionId]).apply).toBe(
      false,
    )
    expect(
      parseArgs(['--subscription', ORPHAN.subscriptionId, '--apply']).apply,
    ).toBe(true)
  })

  it('collects repeated --subscription flags', () => {
    expect(
      parseArgs([
        '--subscription',
        ORPHAN.subscriptionId,
        '--subscription',
        SIBLING_ORPHAN.subscriptionId,
      ]).subscriptionIds,
    ).toEqual([ORPHAN.subscriptionId, SIBLING_ORPHAN.subscriptionId])
  })

  // Without an input list the script would be deciding its own population,
  // which is what a human review exists to prevent.
  it('refuses a run with no input at all', () => {
    expect(() => parseArgs([])).toThrow(/never derives its own population/)
    expect(() => parseArgs(['--apply'])).toThrow(
      /never derives its own population/,
    )
  })

  it('rejects an unknown option rather than ignoring it', () => {
    expect(() => parseArgs(['--execute'])).toThrow(/Unrecognized option/)
  })

  it('rejects a flag whose value is missing', () => {
    expect(() => parseArgs(['--json', '--apply'])).toThrow(/needs a value/)
  })
})

describe('the read-only Stripe guard', () => {
  // Shaped like #1945's own delegate stub: enough of the http client for the
  // SDK to drive it, with no cast.
  // Shaped like #1945's own delegate stub, with one addition: the SDK stamps
  // the request id onto whatever `getRawResponse` returns, so that has to be
  // an object here — #1945 never drives its stub through the SDK, and a null
  // there leaves the SDK's promise pending forever rather than failing.
  const stubDelegate = () => ({
    getClientName: () => 'stub',
    makeRequest: vi.fn(async () => ({
      getStatusCode: () => 200,
      getHeaders: () => ({}),
      getRawResponse: () => ({}),
      toStream: () => null,
      toJSON: async () => ({
        id: ORPHAN.subscriptionId,
        object: 'subscription',
      }),
    })),
  })

  it('refuses any verb but GET', () => {
    expect(() =>
      assertReadOnlyRequest('GET', '/v1/subscriptions'),
    ).not.toThrow()
    expect(() =>
      assertReadOnlyRequest('DELETE', '/v1/subscriptions/sub_x'),
    ).toThrow(/read-only/)
  })

  // The guard has to stop a mutation before the socket, not report it after.
  // Driven through a real Stripe SDK client rather than the http client alone,
  // because that is the assembly the script actually builds: a cancel against
  // the client this script constructs must never reach the wire.
  //
  // The SDK reports any throw from its http client as its own connection
  // fault, which is why `createReadOnlyHttpClient` writes the real reason to
  // stderr first — an operator who sees only "connection to Stripe" goes
  // looking for a network problem that does not exist. Both halves are
  // asserted: nothing reached the delegate, and the reason was stated.
  it('stops a cancellation reaching the wire', async () => {
    const delegate = stubDelegate()
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const stripe = new Stripe('sk_test_repair_guard', {
      maxNetworkRetries: 0,
      httpClient: createReadOnlyHttpClient(delegate),
    })

    try {
      await expect(
        stripe.subscriptions.cancel(ORPHAN.subscriptionId),
      ).rejects.toThrow()
      expect(delegate.makeRequest).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining(
          'read-only; refusing DELETE /v1/subscriptions/' +
            ORPHAN.subscriptionId,
        ),
      )
    } finally {
      stderr.mockRestore()
    }
  })

  it('lets a subscription read through', async () => {
    const delegate = stubDelegate()
    const stripe = new Stripe('sk_test_repair_guard', {
      maxNetworkRetries: 0,
      httpClient: createReadOnlyHttpClient(delegate),
    })

    // A guard that blocked everything would pass the refusal test above and
    // still leave the script unable to read, so the read half is asserted on
    // the same assembly: the GET reaches the delegate and its body comes back.
    const subscription = await stripe.subscriptions.retrieve(
      ORPHAN.subscriptionId,
    )

    expect(subscription.id).toBe(ORPHAN.subscriptionId)
    expect(delegate.makeRequest).toHaveBeenCalledOnce()
  })
})

describe('toAuditEntries', () => {
  // Someone will have to reconstruct this repair from the log alone, so every
  // field a reconstruction needs is asserted, including which signal justified
  // the write.
  it('records who, what, before, after and how ownership was resolved', () => {
    const plan: RepairPlan = {
      repairClass: RepairClass.RelinkOrphanedActive,
      outcome: Outcome.Apply,
      subscriptionId: ORPHAN.subscriptionId,
      campaignId: 325506,
      userId: 742,
      ownershipSource: OwnershipSource.StripeCustomerEmail,
      detail: '',
      statements: [],
      changes: [
        {
          entity: 'campaign',
          entityId: 325506,
          field: 'details.subscriptionId',
          before: null,
          after: ORPHAN.subscriptionId,
        },
      ],
    }

    expect(toAuditEntries(plan, '2026-09-18T12:00:00.000Z')).toEqual([
      {
        at: '2026-09-18T12:00:00.000Z',
        repairClass: 'RELINK_ORPHANED_ACTIVE',
        subscriptionId: ORPHAN.subscriptionId,
        campaignId: 325506,
        userId: 742,
        entity: 'campaign',
        entityId: 325506,
        field: 'details.subscriptionId',
        before: null,
        after: ORPHAN.subscriptionId,
        ownershipSource: 'stripe-customer-email',
      },
    ])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Against a real Postgres. The risk in every statement above is whether the
// SQL is right — the JSONB merge, the column names, the guard predicates — and
// a mock cannot catch a wrong column or a predicate that matches nothing.
// ───────────────────────────────────────────────────────────────────────────
describe('against the database', () => {
  const service = useTestService()

  const db = (): Database => createDatabase(service.prisma)
  const context = (stripe: StripeReader): RepairContext => ({
    db: db(),
    reader: createRepairReader(db()),
    stripe,
  })

  const unique = () => Math.random().toString(36).slice(2, 10)

  const insertUser = async (
    metaData: PrismaJson.UserMetaData,
    email = `owner-${unique()}@example.com`,
  ): Promise<number> => {
    const user = await service.prisma.user.create({
      data: { email, firstName: 'Test', lastName: 'Owner', metaData },
    })
    return user.id
  }

  const insertCampaign = async (campaign: {
    userId: number
    details: PrismaJson.CampaignDetails
    isPro?: boolean
    isDemo?: boolean
  }): Promise<number> => {
    const slug = `repair-${unique()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: campaign.userId },
    })
    const created = await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: campaign.userId,
        isPro: campaign.isPro ?? false,
        isDemo: campaign.isDemo ?? false,
        details: campaign.details,
      },
    })
    return created.id
  }

  const readCampaign = async (id: number) => {
    const [row] = await service.prisma.$queryRawUnsafe<
      { isPro: boolean; details: Record<string, unknown> }[]
    >(
      `SELECT COALESCE(is_pro, false) AS "isPro", details FROM campaign WHERE id = $1`,
      id,
    )
    return row
  }

  const readUserMeta = async (id: number) => {
    const [row] = await service.prisma.$queryRawUnsafe<
      { metaData: Record<string, unknown> | null }[]
    >(`SELECT meta_data AS "metaData" FROM "user" WHERE id = $1`, id)
    return row.metaData
  }

  describe('the SELECTs', () => {
    // A wrong column name or a missing jsonb_typeof guard is invisible to a
    // mock and reads as "no drift" in production, which is the worst possible
    // failure for a report an operator trusts.
    it('finds a campaign by the subscription id inside its details JSONB', async () => {
      const userId = await insertUser({ customerId: ORPHAN.customerId })
      const campaignId = await insertCampaign({
        userId,
        isPro: true,
        details: { subscriptionId: ORPHAN.subscriptionId },
      })

      const rows = await findCampaignsBySubscriptionId(
        db(),
        ORPHAN.subscriptionId,
      )

      // Every field of CampaignRow, because each one is read through a
      // separate `AS` alias and a typo in any of them reads as absent drift.
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: campaignId,
        userId,
        isPro: true,
        isDemo: false,
        subscriptionId: ORPHAN.subscriptionId,
        storedCustomerId: ORPHAN.customerId,
      })
      expect(rows[0].slug).toMatch(/^repair-/)
    })

    it('reads a campaign with an empty details blob as carrying nothing', async () => {
      const userId = await insertUser(null)
      const campaignId = await insertCampaign({ userId, details: {} })

      const [row] = await findCampaignsByUserId(db(), userId)

      expect(row).toMatchObject({
        id: campaignId,
        subscriptionId: null,
        storedCustomerId: null,
        isPro: false,
      })
    })

    it('resolves a user by email case-insensitively, as the unique index does', async () => {
      const userId = await insertUser(
        { customerId: ORPHAN.customerId },
        'Mixed.Case@Example.com',
      )

      expect((await findUserByEmail(db(), 'mixed.case@example.com'))?.id).toBe(
        userId,
      )
      expect(await findUserByEmail(db(), 'nobody@example.com')).toBeNull()
    })

    it('reads isDeleted off meta_data, and defaults it to false', async () => {
      const deleted = await insertUser({ isDeleted: true })
      const live = await insertUser({})

      expect((await findUserById(db(), deleted))?.isDeleted).toBe(true)
      expect((await findUserById(db(), live))?.isDeleted).toBe(false)
    })

    it('selects only campaigns whose subscriptionCanceledAt is a JSON number', async () => {
      const userId = await insertUser({})
      const numeric = await insertCampaign({
        userId,
        details: { subscriptionCanceledAt: 1757125244 },
      })
      // A JSON *string* rather than a number. The declared type says number,
      // so this can only be written around Prisma — but "the type says so" is
      // not a guarantee about rows already in the column, and arithmetic on a
      // string is the kind of thing that fails mid-run rather than at plan
      // time. The selection has to exclude it.
      const stringTyped = await insertCampaign({ userId, details: {} })
      await service.prisma.$executeRawUnsafe(
        `UPDATE campaign SET details = '{"subscriptionCanceledAt":"1757125244"}'::jsonb WHERE id = $1`,
        stringTyped,
      )
      await insertCampaign({ userId, details: {} })

      const rows = await findCampaignsWithCanceledAtStamp(db())

      expect(rows.map((row) => row.id)).toEqual([numeric])
      expect(rows[0].canceledAtRaw).toBe('1757125244')
    })
  })

  describe('the re-link statement', () => {
    it('merges subscriptionId into details and flips isPro without touching sibling keys', async () => {
      const userId = await insertUser({})
      const campaignId = await insertCampaign({
        userId,
        // A key a concurrent webhook would have written. The atomic merge must
        // preserve it; the read-modify-write this replaced is what dropped it.
        details: { isProUpdatedAt: '2026-01-01T00:00:00Z', tier: 'local' },
      })
      const statement = relinkCampaignStatement(campaignId, {
        subscriptionId: ORPHAN.subscriptionId,
      })

      const affected = await db().execute(statement.sql, statement.params)

      expect(affected).toBe(1)
      expect(await readCampaign(campaignId)).toEqual({
        isPro: true,
        details: {
          subscriptionId: ORPHAN.subscriptionId,
          isProUpdatedAt: '2026-01-01T00:00:00Z',
          tier: 'local',
        },
      })
    })

    // The sibling trap as a predicate. Even if the planner were wrong, or a
    // subscription landed on the campaign between plan and apply, the
    // statement itself cannot orphan what the campaign already carries.
    it('cannot overwrite a non-null subscriptionId', async () => {
      const userId = await insertUser({})
      const campaignId = await insertCampaign({
        userId,
        isPro: true,
        details: { subscriptionId: SIBLING_CARRIED.subscriptionId },
      })
      const statement = relinkCampaignStatement(campaignId, {
        subscriptionId: SIBLING_ORPHAN.subscriptionId,
      })

      const affected = await db().execute(statement.sql, statement.params)

      expect(affected).toBe(0)
      expect((await readCampaign(campaignId)).details.subscriptionId).toBe(
        SIBLING_CARRIED.subscriptionId,
      )
    })
  })

  describe('the customer repoint statement', () => {
    it('merges customerId into meta_data and leaves the other keys alone', async () => {
      const userId = await insertUser({
        customerId: SIBLING_CARRIED.customerId,
        checkoutSessionId: 'cs_test_keepme',
      })
      const statement = repointCustomerStatement(
        userId,
        SIBLING_CARRIED.customerId,
        ORPHAN.customerId,
      )

      expect(await db().execute(statement.sql, statement.params)).toBe(1)
      expect(await readUserMeta(userId)).toEqual({
        customerId: ORPHAN.customerId,
        checkoutSessionId: 'cs_test_keepme',
      })
    })

    // The row shape this statement most has to work on, and the one a mock
    // would have hidden: `metaData: null` through Prisma stores the JSON value
    // `null`, not SQL NULL, so `jsonb_typeof` is `'null'` and a plain
    // `COALESCE(meta_data, '{}') || patch` raises "cannot concatenate a
    // non-object" against a real column. Both null shapes are covered because
    // both exist in the column.
    it.each([
      ['JSON null, as Prisma writes it', `'null'::jsonb`],
      ['SQL NULL', `NULL`],
    ])(
      'writes a customerId onto a user whose meta_data is %s',
      async (_label, literal) => {
        const userId = await insertUser(null)
        await service.prisma.$executeRawUnsafe(
          `UPDATE "user" SET meta_data = ${literal} WHERE id = $1`,
          userId,
        )
        const statement = repointCustomerStatement(
          userId,
          null,
          ORPHAN.customerId,
        )

        expect(await db().execute(statement.sql, statement.params)).toBe(1)
        expect(await readUserMeta(userId)).toEqual({
          customerId: ORPHAN.customerId,
        })
      },
    )

    // The compare-and-swap. A stale input file, or a webhook landing mid-run,
    // must refuse rather than overwrite a value nobody read.
    it('refuses when the stored customerId has moved since the plan', async () => {
      const userId = await insertUser({ customerId: ORPHAN.customerId })
      const statement = repointCustomerStatement(
        userId,
        SIBLING_CARRIED.customerId,
        SIBLING_ORPHAN.customerId,
      )

      expect(await db().execute(statement.sql, statement.params)).toBe(0)
      expect(await readUserMeta(userId)).toEqual({
        customerId: ORPHAN.customerId,
      })
    })
  })

  describe('the subscriptionCanceledAt normalisation statement', () => {
    it('rewrites a seconds stamp as milliseconds', async () => {
      const userId = await insertUser({})
      const campaignId = await insertCampaign({
        userId,
        details: { subscriptionCanceledAt: 1757125244, tier: 'local' },
      })
      const statement = normalizeCanceledAtStatement(campaignId, 1757125244)

      expect(await db().execute(statement.sql, statement.params)).toBe(1)
      expect((await readCampaign(campaignId)).details).toEqual({
        subscriptionCanceledAt: 1757125244000,
        tier: 'local',
      })
    })

    // Idempotency, in the statement rather than only in the planner: running
    // the same statement twice must not reach 1.757e15.
    it('is a no-op the second time it runs', async () => {
      const userId = await insertUser({})
      const campaignId = await insertCampaign({
        userId,
        details: { subscriptionCanceledAt: 1757125244 },
      })
      const statement = normalizeCanceledAtStatement(campaignId, 1757125244)

      await db().execute(statement.sql, statement.params)
      expect(await db().execute(statement.sql, statement.params)).toBe(0)
      expect((await readCampaign(campaignId)).details).toEqual({
        subscriptionCanceledAt: 1757125244000,
      })
    })

    it('leaves a row that is already in milliseconds untouched', async () => {
      const userId = await insertUser({})
      const campaignId = await insertCampaign({
        userId,
        details: { subscriptionCanceledAt: 1757125244000 },
      })
      const statement = normalizeCanceledAtStatement(campaignId, 1757125244000)

      expect(await db().execute(statement.sql, statement.params)).toBe(0)
      expect((await readCampaign(campaignId)).details).toEqual({
        subscriptionCanceledAt: 1757125244000,
      })
    })
  })

  describe('a whole run', () => {
    // `metaData: null` on purpose: an orphan's owner routinely has no stored
    // customer id at all (the boot-time backfill only reaches users with a
    // stored `checkoutSessionId`), so this is the shape the repair meets.
    const seedOrphan = async () => {
      const userId = await insertUser(null)
      const campaignId = await insertCampaign({ userId, details: {} })
      const stripe = stubStripe([
        snapshot({
          id: ORPHAN.subscriptionId,
          customerId: ORPHAN.customerId,
          metadata: { userId: String(userId) },
        }),
      ])
      return { userId, campaignId, stripe }
    }

    it('writes nothing in a dry run, but says exactly what it would write', async () => {
      const { userId, campaignId, stripe } = await seedOrphan()

      const report = await run(context(stripe), {
        apply: false,
        subscriptionIds: [ORPHAN.subscriptionId],
        normalizeCanceledAt: false,
      })

      expect(report.plans).toHaveLength(1)
      expect(report.plans[0].outcome).toBe(Outcome.Apply)
      expect(report.plans[0].campaignId).toBe(campaignId)
      expect(report.applied).toBe(0)
      // The point of a dry run: the database is byte-identical afterwards.
      expect(await readCampaign(campaignId)).toEqual({
        isPro: false,
        details: {},
      })
      expect(await readUserMeta(userId)).toBeNull()
    })

    it('applies exactly the planned patch, and audits every field it changed', async () => {
      const { userId, campaignId, stripe } = await seedOrphan()
      const audited: AuditEntry[] = []

      const report = await run(context(stripe), {
        apply: true,
        subscriptionIds: [ORPHAN.subscriptionId],
        normalizeCanceledAt: false,
        audit: (entries) => audited.push(...entries),
      })

      expect(report.applied).toBe(1)
      expect(report.failed).toBe(0)
      const campaign = await readCampaign(campaignId)
      expect(campaign.isPro).toBe(true)
      expect(campaign.details.subscriptionId).toBe(ORPHAN.subscriptionId)
      // Stamped because this was a genuine non-Pro -> Pro transition, the same
      // rule setIsPro follows so the CRM's pro_upgrade_date stays honest.
      expect(campaign.details.isProUpdatedAt).toEqual(expect.any(String))
      // Without this the customer has Pro and still cannot cancel: the billing
      // portal opens the STORED customer.
      expect(await readUserMeta(userId)).toEqual({
        customerId: ORPHAN.customerId,
      })

      expect(
        audited.map(({ entity, field, before, after, ownershipSource }) => ({
          entity,
          field,
          before,
          after,
          ownershipSource,
        })),
      ).toEqual([
        {
          entity: 'campaign',
          field: 'details.subscriptionId',
          before: null,
          after: ORPHAN.subscriptionId,
          ownershipSource: 'subscription-metadata',
        },
        {
          entity: 'campaign',
          field: 'isPro',
          before: false,
          after: true,
          ownershipSource: 'subscription-metadata',
        },
        expect.objectContaining({ field: 'details.isProUpdatedAt' }),
        {
          entity: 'user',
          field: 'metaData.customerId',
          before: null,
          after: ORPHAN.customerId,
          ownershipSource: 'subscription-metadata',
        },
      ])
    })

    // The campaign-325636 shape: already Pro (comped, or left Pro by a
    // cancellation that lost the linkage) with no subscriptionId, while a live
    // subscription bills. Re-linking must not re-stamp isProUpdatedAt — the
    // CRM publishes it as HubSpot's pro_upgrade_date, and overwriting a real
    // upgrade date with today is the regression #1952 fixed on the write path.
    it('does not re-stamp isProUpdatedAt when the campaign is already Pro', async () => {
      const userId = await insertUser(null)
      const campaignId = await insertCampaign({
        userId,
        isPro: true,
        details: { isProUpdatedAt: '2026-07-01T13:39:48Z' },
      })
      const stripe = stubStripe([
        snapshot({
          id: ORPHAN.subscriptionId,
          customerId: ORPHAN.customerId,
          metadata: { userId: String(userId) },
        }),
      ])

      const report = await run(context(stripe), {
        apply: true,
        subscriptionIds: [ORPHAN.subscriptionId],
        normalizeCanceledAt: false,
      })

      expect(report.applied).toBe(1)
      expect((await readCampaign(campaignId)).details).toEqual({
        subscriptionId: ORPHAN.subscriptionId,
        isProUpdatedAt: '2026-07-01T13:39:48Z',
      })
    })

    // How an operator verifies the repair worked: run it again, expect nothing.
    it('is a no-op on a second apply', async () => {
      const { campaignId, stripe } = await seedOrphan()

      await run(context(stripe), {
        apply: true,
        subscriptionIds: [ORPHAN.subscriptionId],
        normalizeCanceledAt: false,
      })
      const before = await readCampaign(campaignId)

      const second = await run(context(stripe), {
        apply: true,
        subscriptionIds: [ORPHAN.subscriptionId],
        normalizeCanceledAt: false,
      })

      expect(second.applied).toBe(0)
      expect(second.plans[0].outcome).toBe(Outcome.NoopAlreadyLinked)
      expect(await readCampaign(campaignId)).toEqual(before)
    })

    // One transaction per subscription: a two-statement repair whose second
    // statement no longer matches must leave the first one rolled back, not a
    // campaign linked to a customer pointer that was never corrected.
    it('rolls the whole row back when a precondition moved under it', async () => {
      const { userId, campaignId, stripe } = await seedOrphan()
      const database = db()
      const audited: AuditEntry[] = []

      // Plan against the state above, then move the user's customerId the way
      // a concurrent Manage Subscription click would.
      const planned = await run(
        { ...context(stripe), db: database },
        {
          apply: false,
          subscriptionIds: [ORPHAN.subscriptionId],
          normalizeCanceledAt: false,
        },
      )
      await service.prisma.$executeRawUnsafe(
        `UPDATE "user" SET meta_data = '{"customerId":"cus_UknccQ7rRAO1U5"}'::jsonb WHERE id = $1`,
        userId,
      )

      const result = await applyPlan(database, planned.plans[0], (entries) =>
        audited.push(...entries),
      )

      expect(result.applied).toBe(false)
      expect(result.plan.outcome).toBe(Outcome.RefusedRacedPrecondition)
      expect(audited).toEqual([])
      // The re-link, which was statement one and did match, must not survive.
      expect(await readCampaign(campaignId)).toEqual({
        isPro: false,
        details: {},
      })
    })

    it('normalises both unit variants in one pass and re-runs clean', async () => {
      const userId = await insertUser({})
      const seconds = await insertCampaign({
        userId,
        details: { subscriptionCanceledAt: 1757125244 },
      })
      const milliseconds = await insertCampaign({
        userId,
        details: { subscriptionCanceledAt: 1757125244000 },
      })

      const first = await run(context(stubStripe([])), {
        apply: true,
        subscriptionIds: [],
        normalizeCanceledAt: true,
      })

      expect(first.applied).toBe(1)
      expect((await readCampaign(seconds)).details).toEqual({
        subscriptionCanceledAt: 1757125244000,
      })
      expect((await readCampaign(milliseconds)).details).toEqual({
        subscriptionCanceledAt: 1757125244000,
      })

      const second = await run(context(stubStripe([])), {
        apply: true,
        subscriptionIds: [],
        normalizeCanceledAt: true,
      })

      expect(second.applied).toBe(0)
      expect(second.plans.every((plan) => plan.statements.length === 0)).toBe(
        true,
      )
      expect((await readCampaign(seconds)).details).toEqual({
        subscriptionCanceledAt: 1757125244000,
      })
    })

    it('refuses the sibling trap against real rows rather than overwriting', async () => {
      const userId = await insertUser({})
      const campaignId = await insertCampaign({
        userId,
        isPro: true,
        details: { subscriptionId: SIBLING_CARRIED.subscriptionId },
      })
      const stripe = stubStripe([
        snapshot({
          id: SIBLING_ORPHAN.subscriptionId,
          customerId: SIBLING_ORPHAN.customerId,
          metadata: { userId: String(userId) },
        }),
      ])

      const report = await run(context(stripe), {
        apply: true,
        subscriptionIds: [SIBLING_ORPHAN.subscriptionId],
        normalizeCanceledAt: false,
      })

      expect(report.applied).toBe(0)
      expect(report.plans[0].outcome).toBe(Outcome.RefusedSiblingSubscription)
      expect((await readCampaign(campaignId)).details.subscriptionId).toBe(
        SIBLING_CARRIED.subscriptionId,
      )
    })
  })
})
