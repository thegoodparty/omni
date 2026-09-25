import { beforeEach, describe, expect, it } from 'vitest'
import { subMinutes } from 'date-fns'
import { useTestService } from '@/test-service'
import { OfficeLevel } from '../../../generated/prisma'
import { PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES } from './campaignTcrCompliance.service'
import {
  notActivelyBillingBlocked,
  reportableCampaign,
} from './nightly10DlcReport.service'

const service = useTestService()

// The nightly report's internal-account exclusion, exercised against real
// Postgres. Structural assertions on the `where` object can't catch this: the
// bug (ENG-10866) was that `NOT: [a, b]` is NOT(a AND b) in Prisma, so the
// predicate was always true and internal staff records were never excluded.
describe('nightly 10DLC report — internal-account exclusion', () => {
  let suffix: number

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

  beforeEach(() => {
    suffix = Date.now() + Math.floor(Math.random() * 1000)
  })

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

  // The escalation/alert queries must keep never-billing-blocked rows (the
  // overwhelming majority: peerlyBillingBlockedAt NULL) while dropping only
  // an active block. The old `NOT: { gte }` form compiled to SQL that
  // excluded NULL rows, silently emptying all four queries — only real
  // Postgres can catch that.
  it('keeps never-blocked and stale-blocked records, drops an active block', async () => {
    const now = new Date()
    const neverBlocked = await seedRecord(
      `candidate-${suffix}@example.com`,
      'neverblocked',
    )
    const staleBlocked = await seedRecord(
      `candidate2-${suffix}@example.com`,
      'staleblocked',
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
      `candidate3-${suffix}@example.com`,
      'activeblocked',
    )
    await service.prisma.tcrCompliance.update({
      where: { id: activelyBlocked.id },
      data: { peerlyBillingBlockedAt: now },
    })

    const matched = await service.prisma.tcrCompliance.findMany({
      where: {
        campaign: reportableCampaign,
        AND: [notActivelyBillingBlocked(now)],
        email: { contains: String(suffix) },
      },
      select: { id: true },
    })

    expect(matched.map((r) => r.id).sort()).toEqual(
      [neverBlocked.id, staleBlocked.id].sort(),
    )
  })
})
