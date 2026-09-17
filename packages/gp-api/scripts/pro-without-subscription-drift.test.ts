import { describe, expect, it } from 'vitest'
import {
  buildReport,
  classifyRow,
  mapRow,
  ProDriftClass,
  toEpochMs,
  type CampaignProRow,
} from './pro-without-subscription-drift'

// The fixtures below carry the real prod ids and timestamps of the incident
// this report was written for, so the suite reads as the worked example.
//
// Campaign 325636 held sub_1ToOMk1taBPnTqn4SAevoyMn (customer
// cus_Uo0NK36w9bTvdr). Stripe canceled it 2026-09-08T17:20:58Z
// (cancellation_requested); the customer.subscription.deleted handler resolved
// the campaign, nulled details.subscriptionId and stamped
// subscriptionCanceledAt. The campaign was nonetheless reporting
// pro_candidate=Yes six and eight days later, with details.isProUpdatedAt still
// on its original 2026-07-01 upgrade — the day sub_1ToOMk… was created.
const CANCELED_AT_MS = 1788888059000 // 2026-09-08T17:20:59Z
const UPGRADED_AT_ISO = '2026-07-01T00:00:00Z'

function row(overrides: Partial<CampaignProRow> = {}): CampaignProRow {
  return {
    campaignId: 325636,
    slug: 'ebony-lofton1',
    userId: 19162,
    email: 'candidate@example.com',
    isDemo: false,
    subscriptionId: null,
    customerId: 'cus_Uo0NK36w9bTvdr',
    isProUpdatedAt: UPGRADED_AT_ISO,
    subscriptionCanceledAt: CANCELED_AT_MS,
    ...overrides,
  }
}

describe('PRO_AFTER_CANCELLATION', () => {
  it('flags a campaign still Pro after its own recorded cancellation', () => {
    const finding = classifyRow(row())

    expect(finding?.driftClass).toBe(ProDriftClass.ProAfterCancellation)
    expect(finding?.campaignId).toBe(325636)
    expect(finding?.subscriptionCanceledAt).toBe('2026-09-08T17:20:59.000Z')
    expect(finding?.reason).toContain('later than the recorded Pro upgrade')
  })

  it('stays silent when the cancellation predates the upgrade, which is a resubscribe', () => {
    // Canceled in June, upgraded again in September: being Pro is correct.
    expect(
      classifyRow(
        row({
          subscriptionCanceledAt: Date.parse('2026-06-01T00:00:00Z'),
          isProUpdatedAt: '2026-09-01T00:00:00Z',
          subscriptionId: 'sub_1TnewSubscription000000',
        }),
      ),
    ).toBeNull()
  })

  it('flags a recorded cancellation that has no recorded upgrade to postdate it', () => {
    // The oldest rows predate isProUpdatedAt being written at all. Requiring a
    // non-null upgrade stamp would drop exactly those.
    const finding = classifyRow(row({ isProUpdatedAt: null }))

    expect(finding?.driftClass).toBe(ProDriftClass.ProAfterCancellation)
    expect(finding?.reason).toContain('no recorded Pro upgrade')
  })

  it('claims the row even when subscriptionId is also absent, so one campaign is never reported twice', () => {
    // The deleted handler nulls subscriptionId AND stamps the cancellation, so
    // the real row matches both classes. It must appear once, in the stronger.
    const report = buildReport([row({ subscriptionId: null })])

    expect(report).toHaveLength(1)
    expect(report[0].driftClass).toBe(ProDriftClass.ProAfterCancellation)
  })
})

describe('PRO_NO_SUBSCRIPTION_ID', () => {
  it('flags a Pro campaign carrying no subscription id', () => {
    const finding = classifyRow(
      row({ subscriptionCanceledAt: null, subscriptionId: null }),
    )

    expect(finding?.driftClass).toBe(ProDriftClass.ProNoSubscriptionId)
    expect(finding?.reason).toContain('no details.subscriptionId')
  })

  it('stays silent for a healthy Pro campaign', () => {
    expect(
      classifyRow(
        row({
          subscriptionCanceledAt: null,
          subscriptionId: 'sub_1ToOMk1taBPnTqn4SAevoyMn',
        }),
      ),
    ).toBeNull()
  })
})

describe('exclusions', () => {
  it('ignores demo campaigns, which are seeded Pro deliberately', () => {
    expect(classifyRow(row({ isDemo: true }))).toBeNull()
    expect(
      classifyRow(
        row({
          isDemo: true,
          subscriptionCanceledAt: null,
          subscriptionId: null,
        }),
      ),
    ).toBeNull()
  })
})

describe('timestamp normalisation', () => {
  it('reads isProUpdatedAt as an ISO string and subscriptionCanceledAt as epoch ms', () => {
    // 1782864000000 is the exact pro_upgrade_date campaign 325636 published.
    expect(toEpochMs('2026-07-01T00:00:00Z')).toBe(1782864000000)
    expect(toEpochMs(1788888059000)).toBe(1788888059000)
  })

  it('treats an absent, blank, or unparseable stamp as absent rather than NaN', () => {
    // NaN comparisons are always false, so a NaN here would silently drop the
    // row out of PRO_AFTER_CANCELLATION instead of reporting it.
    expect(toEpochMs(null)).toBeNull()
    expect(toEpochMs('')).toBeNull()
    expect(toEpochMs('   ')).toBeNull()
    expect(toEpochMs('not-a-date')).toBeNull()
    expect(toEpochMs(Number.NaN)).toBeNull()
  })

  it('still flags the row when the upgrade stamp is unparseable', () => {
    const finding = classifyRow(row({ isProUpdatedAt: 'not-a-date' }))

    expect(finding?.driftClass).toBe(ProDriftClass.ProAfterCancellation)
  })
})

describe('report shape', () => {
  it('sorts the self-contradicting class first, then by campaign id', () => {
    const report = buildReport([
      row({
        campaignId: 900,
        subscriptionCanceledAt: null,
        subscriptionId: null,
      }),
      row({ campaignId: 800 }),
      row({
        campaignId: 700,
        subscriptionCanceledAt: null,
        subscriptionId: null,
      }),
      row({ campaignId: 325636 }),
    ])

    expect(report.map((f) => [f.driftClass, f.campaignId])).toEqual([
      [ProDriftClass.ProAfterCancellation, 800],
      [ProDriftClass.ProAfterCancellation, 325636],
      [ProDriftClass.ProNoSubscriptionId, 700],
      [ProDriftClass.ProNoSubscriptionId, 900],
    ])
  })

  it('returns nothing for a database with no drift', () => {
    expect(
      buildReport([
        row({
          subscriptionCanceledAt: null,
          subscriptionId: 'sub_1ToOMk1taBPnTqn4SAevoyMn',
        }),
        row({ isDemo: true }),
      ]),
    ).toEqual([])
  })
})

describe('mapRow', () => {
  it('maps the epoch-ms cancellation stamp, which ->> returns as text', () => {
    const mapped = mapRow({
      campaign_id: '325636',
      slug: 'ebony-lofton1',
      user_id: '19162',
      email: 'candidate@example.com',
      is_demo: false,
      subscription_id: null,
      customer_id: 'cus_Uo0NK36w9bTvdr',
      is_pro_updated_at: UPGRADED_AT_ISO,
      subscription_canceled_at: '1788888059000',
    })

    expect(mapped.campaignId).toBe(325636)
    expect(mapped.userId).toBe(19162)
    expect(mapped.subscriptionCanceledAt).toBe(CANCELED_AT_MS)
    expect(mapped.isDemo).toBe(false)
  })

  it('drops a non-text value in a text column rather than passing it on', () => {
    // Every text column here is read through ->> or is a varchar, so a
    // non-string means the driver surprised us. Reporting it as absent keeps
    // the finding honest instead of printing a number as a subscription id.
    const mapped = mapRow({
      campaign_id: 325636,
      slug: 42,
      user_id: 19162,
      email: null,
      is_demo: false,
      subscription_id: 7,
      customer_id: null,
      is_pro_updated_at: null,
      subscription_canceled_at: null,
    })

    expect(mapped.slug).toBeNull()
    expect(mapped.subscriptionId).toBeNull()
  })

  it('maps a null cancellation stamp to null, not 0', () => {
    // Number(null) is 0, which is an epoch of 1970 and would postdate nothing,
    // but would still be a non-null cancellation and misclassify the row.
    const mapped = mapRow({
      campaign_id: 1,
      slug: null,
      user_id: null,
      email: null,
      is_demo: false,
      subscription_id: 'sub_x',
      customer_id: null,
      is_pro_updated_at: null,
      subscription_canceled_at: null,
    })

    expect(mapped.subscriptionCanceledAt).toBeNull()
    expect(classifyRow(mapped)).toBeNull()
  })
})
