import { subMinutes } from 'date-fns'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { OfficeLevel } from '../../../generated/prisma'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import {
  cvStatusNotYetVerified,
  PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES,
} from './campaignTcrCompliance.service'
import {
  notActivelyBillingBlocked,
  reportableCampaign,
} from './nightly10DlcReport.service'

const service = useTestService()

let suffix: number

beforeEach(() => {
  suffix = Date.now() + Math.floor(Math.random() * 1000)
})

const seedRecord = async (email: string, label: string) => {
  const user = await service.prisma.user.create({
    data: { email, firstName: 'Test', lastName: label },
  })
  const orgSlug = `org-${label}-${suffix}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: user.id,
      slug: `campaign-${label}-${suffix}`,
      organizationSlug: orgSlug,
      isPro: true,
    },
  })
  return service.prisma.tcrCompliance.create({
    data: {
      campaignId: campaign.id,
      ein: '12-3456789',
      postalAddress: '123 Main St',
      committeeName: `Committee ${label}`,
      websiteDomain: `${label}.example.org`,
      filingUrl: 'https://sos.example.gov/filing',
      phone: '555-000-1234',
      email,
      officeLevel: OfficeLevel.local,
    },
  })
}

// The nightly report's internal-account exclusion, exercised against real
// Postgres. Structural assertions on the `where` object can't catch this: the
// bug (ENG-10866) was that `NOT: [a, b]` is NOT(a AND b) in Prisma, so the
// predicate was always true and internal staff records were never excluded.
describe('nightly 10DLC report — internal-account exclusion', () => {
  it('excludes both internal email suffixes and keeps external candidates', async () => {
    const external = await seedRecord(
      `candidate-${suffix}@example.com`,
      'external',
    )
    await seedRecord(`staff-${suffix}@goodparty.org`, 'staff')
    await seedRecord(`seed-${suffix}@test.goodparty.org`, 'seeded')

    const reportable = await service.prisma.tcrCompliance.findMany({
      where: { campaign: reportableCampaign },
      select: { id: true, email: true },
    })

    const seededIds = new Set([external.id])
    const matched = reportable.filter((record) =>
      record.email.includes(String(suffix)),
    )
    expect(matched.map((record) => record.id)).toEqual([...seededIds])
  })

  it('excludes non-Pro campaigns regardless of email', async () => {
    const record = await seedRecord(`candidate-${suffix}@example.com`, 'notpro')
    await service.prisma.campaign.update({
      where: { id: record.campaignId },
      data: { isPro: false },
    })

    const reportable = await service.prisma.tcrCompliance.findMany({
      where: { campaign: reportableCampaign },
      select: { id: true },
    })

    expect(reportable.map((r) => r.id)).not.toContain(record.id)
  })
})

// The billing-block window the case 1/2/3a/3b queries share, exercised against
// real Postgres for the same reason as above: the clause used to be
// `NOT: { peerlyBillingBlockedAt: { gte } }`, which Prisma compiles to bare SQL
// `NOT (col >= $1)` — NULL rows evaluate to NULL there and are excluded, so
// every never-billing-blocked record silently vanished from all four stall
// queries and no vendor escalation or one-time alert ever fired.
describe('nightly 10DLC report — active billing-block exclusion', () => {
  it('keeps never-blocked and stale-blocked records; drops actively blocked', async () => {
    const now = new Date()
    const neverBlocked = await seedRecord(
      `never-${suffix}@example.com`,
      'never',
    )
    const staleBlocked = await seedRecord(
      `stale-${suffix}@example.com`,
      'stale',
    )
    await service.prisma.tcrCompliance.update({
      where: { id: staleBlocked.id },
      data: {
        peerlyBillingBlockedAt: subMinutes(
          now,
          PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES + 60,
        ),
      },
    })
    const activelyBlocked = await seedRecord(
      `active-${suffix}@example.com`,
      'active',
    )
    await service.prisma.tcrCompliance.update({
      where: { id: activelyBlocked.id },
      data: { peerlyBillingBlockedAt: subMinutes(now, 30) },
    })

    const matched = await service.prisma.tcrCompliance.findMany({
      where: {
        id: { in: [neverBlocked.id, staleBlocked.id, activelyBlocked.id] },
        ...notActivelyBillingBlocked(now),
      },
      select: { id: true },
    })

    expect(new Set(matched.map((r) => r.id))).toEqual(
      new Set([neverBlocked.id, staleBlocked.id]),
    )
  })
})

// The PIN-entry path's VERIFIED-stamp filter, same Prisma NULL gotcha:
// `NOT: { peerlyCvStatus: VERIFIED }` compiled to `NOT (col = $1)`, which
// excludes NULL rows — so a record the CV scan hadn't stamped yet skipped the
// stamp entirely and sat invisible to sweepUnsubmittedUsecases until the next
// scan slot.
describe('PIN-entry VERIFIED stamp — not-yet-verified filter', () => {
  it('matches null and non-VERIFIED statuses; skips already-VERIFIED', async () => {
    const nullStatus = await seedRecord(`null-${suffix}@example.com`, 'nullcv')
    const inReview = await seedRecord(`rev-${suffix}@example.com`, 'inreview')
    await service.prisma.tcrCompliance.update({
      where: { id: inReview.id },
      data: { peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW },
    })
    const verified = await seedRecord(`ver-${suffix}@example.com`, 'verified')
    await service.prisma.tcrCompliance.update({
      where: { id: verified.id },
      data: { peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED },
    })

    const matched = await service.prisma.tcrCompliance.findMany({
      where: {
        id: { in: [nullStatus.id, inReview.id, verified.id] },
        ...cvStatusNotYetVerified,
      },
      select: { id: true },
    })

    expect(new Set(matched.map((r) => r.id))).toEqual(
      new Set([nullStatus.id, inReview.id]),
    )
  })
})
