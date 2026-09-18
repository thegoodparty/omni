import { describe, expect, it, vi } from 'vitest'
import {
  assertReadOnlyRequest,
  createReadOnlyHttpClient,
  createStripeReader,
  DRIFT_CLASSES_BY_PRIORITY,
  formatCents,
  isProSubscription,
  normalizeEmail,
  parseArgs,
  proProductIdForKey,
  reconcile,
  toSnapshot,
  type CampaignRow,
  type Finding,
  type RawSubscription,
  type StripeReadApi,
  type StripeReader,
  type SubscriptionSnapshot,
} from './stripe-campaign-reconcile'

const PRO_PRODUCT_ID = 'prod_QCGFVVUhD6q2Jo'

// The three confirmed production victims this report was written to find.
// Keeping the real ids in the fixtures means the tests read as the worked
// examples from the incident, not as invented shapes.
const ORPHAN = {
  subscriptionId: 'sub_1TAcBr1taBPnTqn4UgzocpUD',
  customerId: 'cus_U8tz6wNnRMcgun',
}
const CANCELED_BY_REQUEST = {
  subscriptionId: 'sub_1TnLmw1taBPnTqn4vQERKKXD',
  customerId: 'cus_Umvew4wWrtcSi5',
}
const CANCELED_BY_PAYMENT_FAILURE = {
  subscriptionId: 'sub_1TlI0T1taBPnTqn4wXcOjDJQ',
  customerId: 'cus_Ukna4d5HsEPEVJ',
}

// The worst confirmed case, and the reason DUPLICATE_BY_EMAIL exists. One
// person completed checkout twice about six minutes apart on 2025-07-17. The
// pre-ENG-11084 email-only flow minted a fresh Stripe customer for each
// completed session, so the two $10/month subscriptions landed on two
// different customer records. Both are still active, neither is linked to a
// campaign, and 14 paid invoices each makes $280 taken from one human that no
// same-customer check can see.
const DOUBLE_BILLED_FIRST = {
  subscriptionId: 'sub_1RlyrV1taBPnTqn4LMHR0MNj',
  customerId: 'cus_ShNc4uj9XoiTfs',
}
const DOUBLE_BILLED_SECOND = {
  subscriptionId: 'sub_1Rlyxu1taBPnTqn4xgXemRA5',
  customerId: 'cus_ShNjwVcfKwOcjl',
}
// Stands in for the address the two records actually share, which is customer
// PII and stays out of the repository.
const SHARED_EMAIL = 'shared@example.com'

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
  isPro: false,
  isDemo: false,
  email: null,
  subscriptionId: null,
  customerId: null,
  ...overrides,
})

interface StubOptions {
  subscriptions?: SubscriptionSnapshot[]
  retrievable?: Record<string, SubscriptionSnapshot>
  paidInvoiceCents?: Record<string, number>
  emails?: Record<string, string>
}

const stubReader = (options: StubOptions = {}) => {
  const retrieveSubscription = vi.fn(
    async (id: string) => options.retrievable?.[id] ?? null,
  )
  const sumPaidInvoiceCents = vi.fn(
    async (id: string) => options.paidInvoiceCents?.[id] ?? 0,
  )
  const retrieveCustomerEmail = vi.fn(
    async (id: string) => options.emails?.[id] ?? null,
  )
  const reader: StripeReader = {
    listProSubscriptions: async () => options.subscriptions ?? [],
    retrieveSubscription,
    sumPaidInvoiceCents,
    retrieveCustomerEmail,
  }
  return {
    reader,
    retrieveSubscription,
    sumPaidInvoiceCents,
    retrieveCustomerEmail,
  }
}

const findingsOfClass = (findings: Finding[], driftClass: string): Finding[] =>
  findings.filter((finding) => finding.driftClass === driftClass)

describe('proProductIdForKey', () => {
  // StripeService branches on this exact test; a report that read the test
  // product against a live key would find every live subscriber orphaned.
  it('picks the live product for a live key', () => {
    expect(proProductIdForKey('sk_live_abc')).toBe('prod_QCGFVVUhD6q2Jo')
  })

  it('picks the test product for a test key', () => {
    expect(proProductIdForKey('sk_test_abc')).toBe('prod_QAR4xrqUhyHHqX')
  })
})

describe('normalizeEmail', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normalizeEmail('  Person@Example.COM ')).toBe('person@example.com')
  })

  // Null is "no key", never a key. A deleted Stripe customer reports no email,
  // so joining on null would collapse every deleted customer on the account
  // into one fabricated person.
  it('returns null for an absent or blank address', () => {
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
  })
})

describe('assertReadOnlyRequest', () => {
  it('allows a GET', () => {
    expect(() =>
      assertReadOnlyRequest('GET', '/v1/subscriptions'),
    ).not.toThrow()
  })

  it('refuses anything that could mutate Stripe', () => {
    for (const method of ['POST', 'DELETE', 'PUT', 'PATCH']) {
      expect(() => assertReadOnlyRequest(method, '/v1/refunds')).toThrow(
        /read-only/,
      )
    }
  })

  it('refuses a lowercased verb too', () => {
    expect(() => assertReadOnlyRequest('post', '/v1/refunds')).toThrow(
      /read-only/,
    )
  })
})

describe('createReadOnlyHttpClient', () => {
  const stubDelegate = () => {
    const makeRequest = vi.fn(async () => ({
      getStatusCode: () => 200,
      getHeaders: () => ({}),
      getRawResponse: () => null,
      toStream: () => null,
      toJSON: async () => ({}),
    }))
    return { getClientName: () => 'stub', makeRequest }
  }

  it('lets a GET through to the real client', async () => {
    const delegate = stubDelegate()

    await createReadOnlyHttpClient(delegate).makeRequest(
      'api.stripe.com',
      443,
      '/v1/subscriptions',
      'GET',
      {},
      null,
      'https',
      80000,
    )

    expect(delegate.makeRequest).toHaveBeenCalledTimes(1)
  })

  // The whole point of wrapping the http client rather than listening on
  // `stripe.on('request')`: the SDK emits that event AFTER handing the request
  // to the client, so a listener can only watch a mutation leave.
  it('stops a mutation before it reaches the socket', async () => {
    const delegate = stubDelegate()

    await expect(
      createReadOnlyHttpClient(delegate).makeRequest(
        'api.stripe.com',
        443,
        '/v1/refunds',
        'POST',
        {},
        'payment_intent=pi_1',
        'https',
        80000,
      ),
    ).rejects.toThrow(/read-only/)
    expect(delegate.makeRequest).not.toHaveBeenCalled()
  })
})

describe('toSnapshot', () => {
  const raw: RawSubscription = {
    id: ORPHAN.subscriptionId,
    customer: ORPHAN.customerId,
    status: 'active',
    start_date: 1773360000,
    cancel_at: null,
    canceled_at: null,
    cancellation_details: null,
    items: {
      data: [
        {
          current_period_end: 1791849600,
          price: {
            unit_amount: 1000,
            currency: 'usd',
            product: PRO_PRODUCT_ID,
          },
        },
      ],
    },
  }

  // The 2025-03-31 API moved the period window onto the items; reading
  // `current_period_end` off the subscription would report null for everyone.
  it('reads the renewal date off the subscription item', () => {
    expect(toSnapshot(raw).currentPeriodEnd).toBe(1791849600)
  })

  it('reads amount, currency, and start date', () => {
    expect(toSnapshot(raw)).toMatchObject({
      id: ORPHAN.subscriptionId,
      customerId: ORPHAN.customerId,
      status: 'active',
      amountCents: 1000,
      currency: 'usd',
      startDate: 1773360000,
    })
  })

  it('unwraps an expanded customer object', () => {
    expect(
      toSnapshot({ ...raw, customer: { id: 'cus_expanded' } }),
    ).toMatchObject({ customerId: 'cus_expanded' })
  })

  it('carries the cancellation reason', () => {
    expect(
      toSnapshot({
        ...raw,
        status: 'canceled',
        canceled_at: 1788825600,
        cancellation_details: { reason: 'payment_failed' },
      }),
    ).toMatchObject({
      status: 'canceled',
      canceledAt: 1788825600,
      cancellationReason: 'payment_failed',
    })
  })
})

describe('isProSubscription', () => {
  const withProduct = (product: string): RawSubscription => ({
    id: 'sub_x',
    customer: 'cus_x',
    status: 'active',
    items: { data: [{ price: { product } }] },
  })

  it('matches the Pro product', () => {
    expect(isProSubscription(withProduct(PRO_PRODUCT_ID), PRO_PRODUCT_ID)).toBe(
      true,
    )
  })

  it('skips another product on the same account', () => {
    expect(isProSubscription(withProduct('prod_other'), PRO_PRODUCT_ID)).toBe(
      false,
    )
  })

  it('matches an expanded product object', () => {
    expect(
      isProSubscription(
        {
          id: 'sub_x',
          customer: 'cus_x',
          status: 'active',
          items: { data: [{ price: { product: { id: PRO_PRODUCT_ID } } }] },
        },
        PRO_PRODUCT_ID,
      ),
    ).toBe(true)
  })
})

describe('createStripeReader', () => {
  const asyncIterable = <T>(items: T[]): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator]() {
      yield* items
    },
  })

  const proSub = (id: string): RawSubscription => ({
    id,
    customer: 'cus_x',
    status: 'active',
    items: { data: [{ price: { product: PRO_PRODUCT_ID } }] },
  })

  it('walks every page and keeps only Pro-product subscriptions', async () => {
    const list = vi.fn(() =>
      asyncIterable([
        proSub('sub_pro_1'),
        {
          id: 'sub_other',
          customer: 'cus_y',
          status: 'active' as const,
          items: { data: [{ price: { product: 'prod_domain' } }] },
        },
        proSub('sub_pro_2'),
      ]),
    )
    const api: StripeReadApi = {
      subscriptions: { list, retrieve: async () => proSub('sub_pro_1') },
      invoices: { list: () => asyncIterable([]) },
      customers: { retrieve: async () => ({ email: null }) },
    }

    const found = await createStripeReader(
      api,
      PRO_PRODUCT_ID,
    ).listProSubscriptions()

    expect(found.map((s) => s.id)).toEqual(['sub_pro_1', 'sub_pro_2'])
    // Canceled subscriptions are two of the five drift classes, so the walk
    // must not be narrowed to the live ones by the API filter.
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all' }),
    )
  })

  it('sums only what Stripe actually collected', async () => {
    const list = vi.fn(() =>
      asyncIterable([{ amount_paid: 1000 }, { amount_paid: 1000 }]),
    )
    const api: StripeReadApi = {
      subscriptions: {
        list: () => asyncIterable([]),
        retrieve: async () => proSub('sub_x'),
      },
      invoices: { list },
      customers: { retrieve: async () => ({ email: null }) },
    }

    expect(
      await createStripeReader(api, PRO_PRODUCT_ID).sumPaidInvoiceCents(
        'sub_x',
      ),
    ).toBe(2000)
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ subscription: 'sub_x', status: 'paid' }),
    )
  })

  it('reports a deleted Stripe customer as having no email', async () => {
    const api: StripeReadApi = {
      subscriptions: {
        list: () => asyncIterable([]),
        retrieve: async () => proSub('sub_x'),
      },
      invoices: { list: () => asyncIterable([]) },
      customers: {
        retrieve: async () => ({ deleted: true as const, email: 'x@y.com' }),
      },
    }

    expect(
      await createStripeReader(api, PRO_PRODUCT_ID).retrieveCustomerEmail(
        'cus_gone',
      ),
    ).toBeNull()
  })
})

describe('reconcile', () => {
  describe('ORPHANED_ACTIVE', () => {
    // The confirmed victim: billed monthly since March 2026 with no campaign
    // anywhere in the database carrying the subscription id.
    it('finds a live subscription no campaign carries, with refund sizing', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: ORPHAN.subscriptionId,
            customerId: ORPHAN.customerId,
            status: 'active',
            amountCents: 1000,
            currency: 'usd',
            startDate: 1773360000,
            currentPeriodEnd: 1791849600,
          }),
        ],
        paidInvoiceCents: { [ORPHAN.subscriptionId]: 7000 },
        emails: { [ORPHAN.customerId]: 'stranded@example.com' },
      })

      const report = await reconcile(reader, [])

      expect(report.summary.ORPHANED_ACTIVE).toBe(1)
      expect(report.findings[0]).toMatchObject({
        driftClass: 'ORPHANED_ACTIVE',
        subscriptionId: ORPHAN.subscriptionId,
        customerId: ORPHAN.customerId,
        customerEmail: 'stranded@example.com',
        subscriptionStatus: 'active',
        amountCents: 1000,
        currency: 'usd',
        startDate: '2026-03-13',
        currentPeriodEnd: '2026-10-13',
        totalChargedCents: 7000,
      })
    })

    it('counts trialing and past_due as still collecting', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: 'sub_trial', status: 'trialing' }),
          snapshot({ id: 'sub_late', status: 'past_due' }),
        ],
      })

      const report = await reconcile(reader, [])

      expect(report.summary.ORPHANED_ACTIVE).toBe(2)
    })

    it('stays silent when a campaign carries the id', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: ORPHAN.subscriptionId,
            customerId: ORPHAN.customerId,
          }),
        ],
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 7,
          isPro: true,
          subscriptionId: ORPHAN.subscriptionId,
        }),
      ])

      expect(report.findings).toEqual([])
    })

    it('leaves the total null when invoice totals are skipped', async () => {
      const { reader, sumPaidInvoiceCents } = stubReader({
        subscriptions: [snapshot({ id: ORPHAN.subscriptionId })],
        paidInvoiceCents: { [ORPHAN.subscriptionId]: 7000 },
      })

      const report = await reconcile(reader, [], {
        includeInvoiceTotals: false,
      })

      expect(report.findings[0].totalChargedCents).toBeNull()
      expect(sumPaidInvoiceCents).not.toHaveBeenCalled()
    })
  })

  describe('ORPHANED_CANCELED', () => {
    it('lists a canceled orphan with the reason that explains it', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: CANCELED_BY_REQUEST.subscriptionId,
            customerId: CANCELED_BY_REQUEST.customerId,
            status: 'canceled',
            canceledAt: 1788825600,
            cancellationReason: 'cancellation_requested',
          }),
        ],
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        ORPHANED_CANCELED: 1,
        ORPHANED_ACTIVE: 0,
      })
      expect(report.findings[0]).toMatchObject({
        driftClass: 'ORPHANED_CANCELED',
        subscriptionId: CANCELED_BY_REQUEST.subscriptionId,
        cancellationReason: 'cancellation_requested',
        canceledAt: '2026-09-08',
      })
    })

    // A canceled orphan costs nobody money, so it must never buy the extra
    // round trips that sizing a refund needs.
    it('does not spend Stripe calls sizing a refund nobody is owed', async () => {
      const { reader, sumPaidInvoiceCents, retrieveCustomerEmail } = stubReader(
        {
          subscriptions: [
            snapshot({
              id: CANCELED_BY_PAYMENT_FAILURE.subscriptionId,
              customerId: CANCELED_BY_PAYMENT_FAILURE.customerId,
              status: 'canceled',
              cancellationReason: 'payment_failed',
            }),
          ],
        },
      )

      await reconcile(reader, [])

      expect(sumPaidInvoiceCents).not.toHaveBeenCalled()
      expect(retrieveCustomerEmail).not.toHaveBeenCalled()
    })
  })

  describe('STALE_PRO', () => {
    it('flags a Pro campaign with no subscription id at all', async () => {
      const { reader } = stubReader()

      const report = await reconcile(reader, [
        campaignRow({ id: 11, slug: 'jane-for-mayor', isPro: true }),
      ])

      expect(report.summary.STALE_PRO).toBe(1)
      expect(report.findings[0]).toMatchObject({
        driftClass: 'STALE_PRO',
        campaignId: 11,
        campaignSlug: 'jane-for-mayor',
        subscriptionId: null,
      })
      expect(report.findings[0].detail).toContain('no subscriptionId')
    })

    // Both confirmed cancelled-but-never-un-Pro'd cases land here.
    it('flags a Pro campaign whose subscription Stripe already canceled', async () => {
      const { reader } = stubReader({
        retrievable: {
          [CANCELED_BY_PAYMENT_FAILURE.subscriptionId]: snapshot({
            id: CANCELED_BY_PAYMENT_FAILURE.subscriptionId,
            customerId: CANCELED_BY_PAYMENT_FAILURE.customerId,
            status: 'canceled',
            canceledAt: 1788652800,
            cancellationReason: 'payment_failed',
          }),
        },
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 12,
          isPro: true,
          subscriptionId: CANCELED_BY_PAYMENT_FAILURE.subscriptionId,
          customerId: CANCELED_BY_PAYMENT_FAILURE.customerId,
        }),
      ])

      expect(report.summary.STALE_PRO).toBe(1)
      expect(report.findings[0]).toMatchObject({
        driftClass: 'STALE_PRO',
        campaignId: 12,
        subscriptionStatus: 'canceled',
        cancellationReason: 'payment_failed',
      })
    })

    it('flags a Pro campaign pointing at a subscription Stripe never had', async () => {
      const { reader } = stubReader()

      const report = await reconcile(reader, [
        campaignRow({
          id: 13,
          isPro: true,
          subscriptionId: 'sub_hallucinated',
        }),
      ])

      expect(report.findings[0].detail).toContain('does not exist at Stripe')
    })

    it('stays silent for a Pro campaign with a live subscription', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: ORPHAN.subscriptionId, status: 'active' }),
        ],
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 14,
          isPro: true,
          subscriptionId: ORPHAN.subscriptionId,
        }),
      ])

      expect(report.findings).toEqual([])
    })

    // Demo campaigns are seeded Pro on purpose and would otherwise be most of
    // this class, burying the real ones.
    it('ignores demo campaigns', async () => {
      const { reader } = stubReader()

      const report = await reconcile(reader, [
        campaignRow({ id: 15, isPro: true, isDemo: true }),
      ])

      expect(report.findings).toEqual([])
    })
  })

  describe('DUPLICATE', () => {
    it('flags one customer holding two live Pro subscriptions', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: 'sub_first', customerId: 'cus_double' }),
          snapshot({ id: 'sub_second', customerId: 'cus_double' }),
        ],
        paidInvoiceCents: { sub_first: 5000, sub_second: 2000 },
        emails: { cus_double: 'double@example.com' },
      })

      const report = await reconcile(reader, [
        campaignRow({ id: 21, isPro: true, subscriptionId: 'sub_first' }),
        campaignRow({ id: 22, isPro: true, subscriptionId: 'sub_second' }),
      ])

      expect(report.summary.DUPLICATE).toBe(1)
      expect(report.findings[0]).toMatchObject({
        driftClass: 'DUPLICATE',
        customerId: 'cus_double',
        customerEmail: 'double@example.com',
        relatedSubscriptionIds: ['sub_first', 'sub_second'],
        totalChargedCents: 7000,
      })
    })

    // Two unlinked subscriptions on one customer are ONE billing incident.
    // Reporting them as two orphans plus a duplicate would inflate the queue
    // and count the same dollars twice in two different classes.
    it('reports two unlinked subscriptions on one customer once, not three times', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: 'sub_first', customerId: 'cus_double' }),
          snapshot({ id: 'sub_second', customerId: 'cus_double' }),
        ],
        paidInvoiceCents: { sub_first: 5000, sub_second: 2000 },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE: 1,
        ORPHANED_ACTIVE: 0,
      })
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0].totalChargedCents).toBe(7000)
      expect(report.findings[0].detail).toContain(
        'None of them is linked to any campaign',
      )
    })

    // The canceled one is not part of the duplicate, so suppressing the
    // orphan rows must not swallow it.
    it('still reports a canceled sibling as its own orphan', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: 'sub_first', customerId: 'cus_double' }),
          snapshot({ id: 'sub_second', customerId: 'cus_double' }),
          snapshot({
            id: 'sub_old',
            customerId: 'cus_double',
            status: 'canceled',
          }),
        ],
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE: 1,
        ORPHANED_ACTIVE: 0,
        ORPHANED_CANCELED: 1,
      })
    })

    it('does not flag a customer whose second subscription is canceled', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: 'sub_live', customerId: 'cus_one' }),
          snapshot({
            id: 'sub_dead',
            customerId: 'cus_one',
            status: 'canceled',
          }),
        ],
      })

      const report = await reconcile(reader, [
        campaignRow({ id: 23, isPro: true, subscriptionId: 'sub_live' }),
        campaignRow({ id: 24, subscriptionId: 'sub_dead' }),
      ])

      expect(report.summary.DUPLICATE).toBe(0)
    })

    // `incomplete` and `unpaid` are neither live nor dead, and two of them on
    // one customer is still two sales.
    it('counts a non-live, non-canceled subscription as a duplicate', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: 'sub_live', customerId: 'cus_one' }),
          snapshot({
            id: 'sub_unpaid',
            customerId: 'cus_one',
            status: 'unpaid',
          }),
        ],
      })

      const report = await reconcile(reader, [
        campaignRow({ id: 25, isPro: true, subscriptionId: 'sub_live' }),
        campaignRow({ id: 26, subscriptionId: 'sub_unpaid' }),
      ])

      expect(report.summary.DUPLICATE).toBe(1)
    })
  })

  describe('DUPLICATE_BY_EMAIL', () => {
    // The confirmed incident, as a regression test. Before this class existed
    // the report emitted these as two unrelated ORPHANED_ACTIVE rows of $140
    // with nothing tying them to one person, which is how it survived 14
    // months of review.
    it('groups two customer records sharing one email into a single finding', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
            status: 'active',
            amountCents: 1000,
            currency: 'usd',
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
            status: 'active',
            amountCents: 1000,
            currency: 'usd',
          }),
        ],
        paidInvoiceCents: {
          [DOUBLE_BILLED_FIRST.subscriptionId]: 14000,
          [DOUBLE_BILLED_SECOND.subscriptionId]: 14000,
        },
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL,
          [DOUBLE_BILLED_SECOND.customerId]: SHARED_EMAIL,
        },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE_BY_EMAIL: 1,
        DUPLICATE: 0,
        ORPHANED_ACTIVE: 0,
      })
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0]).toMatchObject({
        driftClass: 'DUPLICATE_BY_EMAIL',
        customerEmail: SHARED_EMAIL,
        // No single customer owns this finding; that is the whole class.
        customerId: null,
        relatedCustomerIds: [
          DOUBLE_BILLED_FIRST.customerId,
          DOUBLE_BILLED_SECOND.customerId,
        ],
        relatedSubscriptionIds: [
          DOUBLE_BILLED_FIRST.subscriptionId,
          DOUBLE_BILLED_SECOND.subscriptionId,
        ],
      })
    })

    // The specific ask: one number the operator acts on. Two $140 rows do not
    // read as $280 unless somebody notices they belong together.
    it('aggregates the exposure per human rather than per subscription', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
            amountCents: 1000,
            currency: 'usd',
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
            amountCents: 1000,
            currency: 'usd',
          }),
        ],
        paidInvoiceCents: {
          [DOUBLE_BILLED_FIRST.subscriptionId]: 14000,
          [DOUBLE_BILLED_SECOND.subscriptionId]: 14000,
        },
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL,
          [DOUBLE_BILLED_SECOND.customerId]: SHARED_EMAIL,
        },
      })

      const report = await reconcile(reader, [])

      expect(report.findings[0]).toMatchObject({
        totalChargedCents: 28000,
        // Combined per-period price: how fast the exposure is still growing.
        amountCents: 2000,
        currency: 'usd',
      })
    })

    it('does not group two customers with different emails', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: 'one@example.com',
          [DOUBLE_BILLED_SECOND.customerId]: 'two@example.com',
        },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE_BY_EMAIL: 0,
        ORPHANED_ACTIVE: 2,
      })
    })

    it('groups addresses that differ only by case or whitespace', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: ' Shared@Example.com ',
          [DOUBLE_BILLED_SECOND.customerId]: 'SHARED@example.COM',
        },
      })

      const report = await reconcile(reader, [])

      expect(report.summary.DUPLICATE_BY_EMAIL).toBe(1)
      expect(report.findings[0].customerEmail).toBe(SHARED_EMAIL)
    })

    // A deleted Stripe customer reports no email at all. Joining on that
    // would invent a duplicate out of two unrelated people.
    it('never joins two customers on a missing email', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE_BY_EMAIL: 0,
        ORPHANED_ACTIVE: 2,
      })
    })

    it('never joins a customer with an email to one without', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        emails: { [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE_BY_EMAIL: 0,
        ORPHANED_ACTIVE: 2,
      })
    })

    // A blank string is Stripe's other way of saying "no address", and it
    // would otherwise be a perfectly good map key.
    it('never joins two customers on a blank email', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: '   ',
          [DOUBLE_BILLED_SECOND.customerId]: '',
        },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE_BY_EMAIL: 0,
        ORPHANED_ACTIVE: 2,
      })
    })

    // Sharing an email is the finding. Being linked to a campaign means the
    // person is at least getting the Pro they paid for twice, but they are
    // still paying twice.
    it('flags a shared-email pair even when both subscriptions are linked', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL,
          [DOUBLE_BILLED_SECOND.customerId]: SHARED_EMAIL,
        },
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 81,
          isPro: true,
          subscriptionId: DOUBLE_BILLED_FIRST.subscriptionId,
        }),
        campaignRow({
          id: 82,
          isPro: true,
          subscriptionId: DOUBLE_BILLED_SECOND.subscriptionId,
        }),
      ])

      expect(report.summary.DUPLICATE_BY_EMAIL).toBe(1)
      expect(report.findings[0].detail).toContain(
        'Every one of them is linked to a campaign',
      )
    })

    // The likeliest real shape after a partial cleanup: one of the pair got
    // re-linked, the other is still billing for nothing. The detail has to
    // name which, because that is the one to cancel.
    it('names the unlinked subscription when only one of the pair is linked', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL,
          [DOUBLE_BILLED_SECOND.customerId]: SHARED_EMAIL,
        },
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 83,
          isPro: true,
          subscriptionId: DOUBLE_BILLED_FIRST.subscriptionId,
        }),
      ])

      expect(report.findings[0].detail).toContain(
        `1 of them (${DOUBLE_BILLED_SECOND.subscriptionId}) is not linked`,
      )
    })

    // One human across three subscriptions is still one human. Emitting both
    // a DUPLICATE for the two-subscription record and a DUPLICATE_BY_EMAIL
    // spanning all three would split them across two rows and double-count
    // the money.
    it('subsumes a same-customer duplicate that shares the email', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: 'sub_third',
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        paidInvoiceCents: {
          [DOUBLE_BILLED_FIRST.subscriptionId]: 14000,
          sub_third: 1000,
          [DOUBLE_BILLED_SECOND.subscriptionId]: 14000,
        },
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL,
          [DOUBLE_BILLED_SECOND.customerId]: SHARED_EMAIL,
        },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE_BY_EMAIL: 1,
        DUPLICATE: 0,
        ORPHANED_ACTIVE: 0,
      })
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0].relatedSubscriptionIds).toEqual([
        DOUBLE_BILLED_FIRST.subscriptionId,
        'sub_third',
        DOUBLE_BILLED_SECOND.subscriptionId,
      ])
      expect(report.findings[0].totalChargedCents).toBe(29000)
    })

    // Suppressing the orphan rows for a grouped customer must not swallow a
    // canceled subscription, which is in no grouping.
    it('still reports a canceled subscription on a grouped customer', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
          snapshot({
            id: 'sub_old',
            customerId: DOUBLE_BILLED_FIRST.customerId,
            status: 'canceled',
          }),
        ],
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL,
          [DOUBLE_BILLED_SECOND.customerId]: SHARED_EMAIL,
        },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE_BY_EMAIL: 1,
        ORPHANED_CANCELED: 1,
        ORPHANED_ACTIVE: 0,
      })
    })

    // A single customer holding two subscriptions is a different remediation
    // (cancel one) than two customer records (merge, then cancel one), so the
    // shared email of one customer with itself must not reclassify it.
    it('leaves a one-customer duplicate as DUPLICATE', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({ id: 'sub_first', customerId: 'cus_double' }),
          snapshot({ id: 'sub_second', customerId: 'cus_double' }),
        ],
        emails: { cus_double: SHARED_EMAIL },
      })

      const report = await reconcile(reader, [])

      expect(report.summary).toMatchObject({
        DUPLICATE: 1,
        DUPLICATE_BY_EMAIL: 0,
      })
    })
  })

  describe('MISMATCH', () => {
    it('flags a subscription owned by a different Stripe customer', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: 'sub_live',
            customerId: 'cus_actual',
            status: 'active',
          }),
        ],
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 31,
          slug: 'mismatched',
          isPro: true,
          subscriptionId: 'sub_live',
          customerId: 'cus_stored',
        }),
      ])

      expect(report.summary.MISMATCH).toBe(1)
      expect(report.findings[0]).toMatchObject({
        driftClass: 'MISMATCH',
        campaignId: 31,
        subscriptionId: 'sub_live',
        customerId: 'cus_actual',
        storedCustomerId: 'cus_stored',
      })
    })

    it('stays silent when the two customers agree', async () => {
      const { reader } = stubReader({
        subscriptions: [snapshot({ id: 'sub_live', customerId: 'cus_same' })],
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 32,
          isPro: true,
          subscriptionId: 'sub_live',
          customerId: 'cus_same',
        }),
      ])

      expect(report.findings).toEqual([])
    })

    // A de-Pro'd campaign routinely keeps a stale subscriptionId pointing at a
    // long-dead subscription. A disagreement about a customer nobody is
    // billing is the ordinary residue of a cancellation, not a finding.
    it('stays silent when the subscription is no longer collecting', async () => {
      const { reader } = stubReader({
        retrievable: {
          sub_dead: snapshot({
            id: 'sub_dead',
            customerId: 'cus_actual',
            status: 'canceled',
          }),
        },
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 34,
          isPro: false,
          subscriptionId: 'sub_dead',
          customerId: 'cus_stored',
        }),
      ])

      expect(report.findings).toEqual([])
    })

    // A campaign that is NOT Pro while a live subscription bills under a third
    // customer is worse than the Pro case, not better — so `isPro` is reported
    // rather than required.
    it('reports a live mismatch on a campaign that is not Pro', async () => {
      const { reader } = stubReader({
        subscriptions: [snapshot({ id: 'sub_live', customerId: 'cus_actual' })],
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 35,
          isPro: false,
          subscriptionId: 'sub_live',
          customerId: 'cus_stored',
        }),
      ])

      expect(report.summary.MISMATCH).toBe(1)
      expect(report.findings[0]).toMatchObject({
        driftClass: 'MISMATCH',
        campaignIsPro: false,
      })
    })

    // A campaign whose owner has no stored customerId has nothing to disagree
    // with — that is a different (and much more common) gap.
    it('stays silent when no customer id is stored', async () => {
      const { reader } = stubReader({
        subscriptions: [snapshot({ id: 'sub_live', customerId: 'cus_actual' })],
      })

      const report = await reconcile(reader, [
        campaignRow({ id: 33, isPro: true, subscriptionId: 'sub_live' }),
      ])

      expect(report.findings).toEqual([])
    })
  })

  describe('the report as a whole', () => {
    it('sorts findings by refund urgency and counts every class', async () => {
      const { reader } = stubReader({
        subscriptions: [
          snapshot({
            id: ORPHAN.subscriptionId,
            customerId: ORPHAN.customerId,
          }),
          snapshot({
            id: CANCELED_BY_REQUEST.subscriptionId,
            customerId: CANCELED_BY_REQUEST.customerId,
            status: 'canceled',
            cancellationReason: 'cancellation_requested',
          }),
          snapshot({ id: 'sub_first', customerId: 'cus_double' }),
          snapshot({ id: 'sub_second', customerId: 'cus_double' }),
          snapshot({ id: 'sub_mismatch', customerId: 'cus_actual' }),
          snapshot({
            id: DOUBLE_BILLED_FIRST.subscriptionId,
            customerId: DOUBLE_BILLED_FIRST.customerId,
          }),
          snapshot({
            id: DOUBLE_BILLED_SECOND.subscriptionId,
            customerId: DOUBLE_BILLED_SECOND.customerId,
          }),
        ],
        retrievable: {
          [CANCELED_BY_PAYMENT_FAILURE.subscriptionId]: snapshot({
            id: CANCELED_BY_PAYMENT_FAILURE.subscriptionId,
            status: 'canceled',
          }),
        },
        emails: {
          [DOUBLE_BILLED_FIRST.customerId]: SHARED_EMAIL,
          [DOUBLE_BILLED_SECOND.customerId]: SHARED_EMAIL,
        },
      })

      const report = await reconcile(reader, [
        campaignRow({ id: 41, isPro: true, subscriptionId: 'sub_first' }),
        campaignRow({ id: 42, isPro: true, subscriptionId: 'sub_second' }),
        campaignRow({
          id: 43,
          isPro: true,
          subscriptionId: 'sub_mismatch',
          customerId: 'cus_stored',
        }),
        campaignRow({
          id: 44,
          isPro: true,
          subscriptionId: CANCELED_BY_PAYMENT_FAILURE.subscriptionId,
        }),
      ])

      expect(report.summary).toEqual({
        DUPLICATE_BY_EMAIL: 1,
        ORPHANED_ACTIVE: 1,
        DUPLICATE: 1,
        MISMATCH: 1,
        STALE_PRO: 1,
        ORPHANED_CANCELED: 1,
      })
      expect(report.findings.map((finding) => finding.driftClass)).toEqual(
        DRIFT_CLASSES_BY_PRIORITY,
      )
      expect(report.proSubscriptionCount).toBe(7)
      expect(report.campaignCount).toBe(4)
    })

    it('reports nothing when Stripe and the database agree', async () => {
      const { reader } = stubReader({
        subscriptions: [snapshot({ id: 'sub_live', customerId: 'cus_one' })],
      })

      const report = await reconcile(reader, [
        campaignRow({
          id: 51,
          isPro: true,
          subscriptionId: 'sub_live',
          customerId: 'cus_one',
        }),
      ])

      expect(report.findings).toEqual([])
      expect(findingsOfClass(report.findings, 'STALE_PRO')).toEqual([])
    })

    // Stripe rate-limits, and a shared subscription id across campaigns (the
    // duplicate-checkout shape) would otherwise re-fetch it once per row.
    it('retrieves an off-walk subscription once, however many rows point at it', async () => {
      const { reader, retrieveSubscription } = stubReader({
        retrievable: {
          sub_shared: snapshot({ id: 'sub_shared', status: 'canceled' }),
        },
      })

      await reconcile(reader, [
        campaignRow({ id: 61, isPro: true, subscriptionId: 'sub_shared' }),
        campaignRow({ id: 62, isPro: true, subscriptionId: 'sub_shared' }),
        campaignRow({ id: 63, isPro: true, subscriptionId: 'sub_shared' }),
      ])

      expect(retrieveSubscription).toHaveBeenCalledTimes(1)
    })

    it('never retrieves a subscription the Pro walk already returned', async () => {
      const { reader, retrieveSubscription } = stubReader({
        subscriptions: [snapshot({ id: 'sub_live' })],
      })

      await reconcile(reader, [
        campaignRow({ id: 71, isPro: true, subscriptionId: 'sub_live' }),
      ])

      expect(retrieveSubscription).not.toHaveBeenCalled()
    })
  })
})

describe('parseArgs', () => {
  it('defaults to a table with invoice totals', () => {
    expect(parseArgs([])).toEqual({ json: false, skipInvoiceTotals: false })
  })

  it('reads both flags', () => {
    expect(parseArgs(['--json', '--skip-invoice-totals'])).toEqual({
      json: true,
      skipInvoiceTotals: true,
    })
  })

  // A typo'd flag silently producing a full-fat run against production Stripe
  // is worse than a refusal.
  it('refuses an option it does not know', () => {
    expect(() => parseArgs(['--jsonn'])).toThrow(/Unrecognized option/)
  })
})

describe('formatCents', () => {
  it('renders cents as a currency amount', () => {
    expect(formatCents(1000, 'usd')).toBe('10.00 USD')
  })

  it('renders an unknown amount as blank rather than 0.00', () => {
    expect(formatCents(null, 'usd')).toBe('')
  })

  it('renders a zero total, which is not the same as unknown', () => {
    expect(formatCents(0, 'usd')).toBe('0.00 USD')
  })
})
