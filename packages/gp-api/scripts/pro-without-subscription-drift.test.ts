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

  it('flags a Pro campaign whose details is an empty object', () => {
    // details is NOT NULL DEFAULT '{}', so `{}` — not NULL — is the degenerate
    // row that actually exists. It passes the jsonb_typeof guard and reads all
    // three keys as NULL, and is still real drift: Pro with nothing behind it.
    const finding = classifyRow(
      row({
        subscriptionId: null,
        subscriptionCanceledAt: null,
        isProUpdatedAt: null,
      }),
    )

    expect(finding?.driftClass).toBe(ProDriftClass.ProNoSubscriptionId)
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

  it('scales a seconds-range stamp, which the updated handler writes', () => {
    // customerSubscriptionUpdatedHandler writes Stripe's canceled_at verbatim,
    // and Stripe measures it in seconds. Read as ms it would be 1970-01-21, so
    // it would never postdate an upgrade and the row would escape the class.
    expect(toEpochMs(1788888059)).toBe(1788888059000)
    // The deleted handler's Date.now() must pass through untouched.
    expect(toEpochMs(1788888059000)).toBe(1788888059000)
  })

  it('flags a cancellation stamped in seconds, not just in milliseconds', () => {
    // The end-to-end version of the case above: same row, same upgrade date,
    // cancellation expressed in Stripe's unit rather than ours.
    const finding = classifyRow(
      row({ subscriptionCanceledAt: CANCELED_AT_MS / 1000 }),
    )

    expect(finding?.driftClass).toBe(ProDriftClass.ProAfterCancellation)
    expect(finding?.subscriptionCanceledAt).toBe(
      new Date(CANCELED_AT_MS).toISOString(),
    )
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

describe('legacy unix-ms upgrade stamps', () => {
  // `setIsPro` wrote `isProUpdatedAt: Date.now()` until #1682 switched it to
  // `formatISO`, and nothing backfilled the rows written before that —
  // campaign.jsonTypes.d.ts still types the key `string | number` for exactly
  // that reason. `->>` hands those rows back as digits.
  const LEGACY_UPGRADE_MS = 1789000000000 // 2026-09-09T23:06:40Z

  it('reads a legacy unix-ms stamp as the upgrade it is, not as an unparseable date', () => {
    expect(toEpochMs(String(LEGACY_UPGRADE_MS))).toBe(LEGACY_UPGRADE_MS)
  })

  it('reads a legacy stamp in seconds too, the other unit this column carries', () => {
    expect(toEpochMs(String(LEGACY_UPGRADE_MS / 1000))).toBe(LEGACY_UPGRADE_MS)
  })

  it('stays silent on a resubscribe whose upgrade stamp is a legacy unix-ms number', () => {
    // The false positive: read as a date, the upgrade is NaN and so absent;
    // classifyRow takes an absent upgrade as unable to postdate a cancellation
    // and reports the row. This campaign cancelled in September and resubscribed
    // a day later — it is Pro because it is paying, and de-Proing it on the
    // strength of this report would strip Pro from a paying customer.
    expect(
      classifyRow(
        row({
          isProUpdatedAt: String(LEGACY_UPGRADE_MS),
          subscriptionId: 'sub_1TnewSubscription000000',
        }),
      ),
    ).toBeNull()
  })

  it('survives mapRow, which is where the digits actually arrive', () => {
    const mapped = mapRow({
      campaign_id: '325636',
      slug: 'ebony-lofton1',
      user_id: '19162',
      email: 'candidate@example.com',
      is_demo: false,
      subscription_id: 'sub_1TnewSubscription000000',
      customer_id: 'cus_Uo0NK36w9bTvdr',
      is_pro_updated_at: String(LEGACY_UPGRADE_MS),
      subscription_canceled_at: String(CANCELED_AT_MS),
    })

    expect(mapped.isProUpdatedAt).toBe(String(LEGACY_UPGRADE_MS))
    expect(classifyRow(mapped)).toBeNull()
  })

  it('still flags a legacy-stamped row whose cancellation really is later', () => {
    // Reading the legacy shape must not cost the class its actual job.
    const finding = classifyRow(
      row({ isProUpdatedAt: String(CANCELED_AT_MS - 86_400_000) }),
    )

    expect(finding?.driftClass).toBe(ProDriftClass.ProAfterCancellation)
    expect(finding?.reason).toContain('later than the recorded Pro upgrade')
  })

  it('leaves digits that are no real stamp absent rather than inventing a date', () => {
    // Widening far enough to accept the legacy shape must not widen far enough
    // to accept garbage: a fabricated upgrade time is worse than a missing one,
    // because the missing one reports the row and a human then looks at it.
    expect(toEpochMs('0')).toBeNull()
    expect(toEpochMs('2026')).toBeNull() // a bare year, not a stamp
    expect(toEpochMs('20260701')).toBeNull() // reads as 1970-08-23 in seconds
    expect(toEpochMs('999999999')).toBeNull() // seconds, but 2001 — predates us
    expect(toEpochMs('17513280000000000')).toBeNull() // ms, but the year 556860
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
