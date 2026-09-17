import { useTestService } from '@/test-service'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const service = useTestService()

// The repair ships as a data-only migration, so the thing under test is the
// SQL file itself. Replaying it against the suite's Postgres 16 is the only
// way to check what it actually does to a row — the id join, the key-absent
// guard, and which timestamp lands on which campaign — without a prod
// database. The template this suite clones has already applied it (against
// empty tables), so the replay below is the first time it sees any row.
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/schema/migrations',
    '20260917220000_backfill_pro_upgrade_slack_stamp/migration.sql',
  ),
  'utf8',
)

const runMigration = () => service.prisma.$executeRawUnsafe(MIGRATION_SQL)

const seedCampaign = async (
  id: number,
  details: PrismaJson.CampaignDetails,
): Promise<void> => {
  const slug = `pro-upgrade-stamp-${id}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.campaign.create({
    data: {
      id,
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      isPro: true,
      details,
    },
  })
}

const detailsOf = async (id: number): Promise<PrismaJson.CampaignDetails> =>
  (await service.prisma.campaign.findUniqueOrThrow({ where: { id } })).details

describe('20260917220000_backfill_pro_upgrade_slack_stamp', () => {
  it('stamps 222443 and 326572 with the instant each announcement was logged', async () => {
    await seedCampaign(222443, { state: 'CA', subscriptionId: 'sub_222443' })
    await seedCampaign(326572, { state: 'TX', subscriptionId: 'sub_326572' })

    await runMigration()

    // The two values are the prod Loki timestamps of the swallowed P2034 that
    // dropped each stamp: 2026-08-28T16:34:28.076Z and 2026-09-02T01:38:16.075Z.
    // Per-id, so a repair that stamped both rows from one value would fail here.
    expect(await detailsOf(222443)).toEqual({
      state: 'CA',
      subscriptionId: 'sub_222443',
      proUpgradeSlackNotifiedAt: 1787934868076,
      proUpgradeSlackNotifiedAtBackfilledAt: expect.any(String),
    })
    expect(await detailsOf(326572)).toEqual({
      state: 'TX',
      subscriptionId: 'sub_326572',
      proUpgradeSlackNotifiedAt: 1788313096075,
      proUpgradeSlackNotifiedAtBackfilledAt: expect.any(String),
    })
  })

  it('leaves a stamp that is already there alone', async () => {
    // Whatever wrote this one recorded a message it saw sent. The backfilled
    // value is a reconstruction from a log line, so it must never displace a
    // live record — which is the only reason this migration can be replayed or
    // deployed after someone else has repaired the row.
    await seedCampaign(222443, { proUpgradeSlackNotifiedAt: 1788400000000 })

    await runMigration()

    expect(await detailsOf(222443)).toEqual({
      proUpgradeSlackNotifiedAt: 1788400000000,
    })
  })

  it('leaves a campaign that was never announced unstamped', async () => {
    // 327177 is a real prod campaign from the same 30-day window that logged
    // "Pro upgrade with no tracker or default tasks; Slack notification
    // skipped" — one of 47. That branch returns before stamping on purpose, so
    // a later trigger can still announce it. Stamping it here would suppress an
    // announcement it is still owed, which is what a "stamp everything missing
    // the key" sweep would do to all 47.
    await seedCampaign(327177, { state: 'OH' })

    await runMigration()

    expect(await detailsOf(327177)).toEqual({ state: 'OH' })
  })
})
