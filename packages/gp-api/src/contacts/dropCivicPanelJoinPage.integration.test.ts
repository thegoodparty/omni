import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'

const service = useTestService()

const MIGRATIONS = join(__dirname, '../../prisma/schema/migrations')

const statements = (file: string): string[] =>
  readFileSync(join(MIGRATIONS, file, 'migration.sql'), 'utf8')
    .split(/;\s*$/m)
    .map((sql) =>
      sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean)

const run = async (sqls: string[]) => {
  for (const sql of sqls) await service.prisma.$executeRawUnsafe(sql)
}

// The template this suite clones already applied the drop, so the joiner
// table and share code are put back as #3171 made them before it replays.
const restoreJoinerTable = () =>
  run([
    `CREATE TYPE "CivicPanelJoinSource" AS ENUM ('share_page', 'text')`,
    `ALTER TABLE "managed_civic_panel" ADD COLUMN "share_code" TEXT`,
    `CREATE UNIQUE INDEX "managed_civic_panel_share_code_key" ON "managed_civic_panel"("share_code")`,
    ...statements('20261023000000_managed_panel_join_and_ready').filter((sql) =>
      /civic_panel_joiner/.test(sql),
    ),
  ])

const SLUG = 'eo-drop-join-page'

const seedStatus = async (
  personId: string,
  source: 'sms' | 'share_page' = 'sms',
) => {
  await service.prisma.contactCurrentStatus.create({
    data: {
      organizationSlug: SLUG,
      personId,
      field: 'civic_panel',
      value: 'member',
    },
  })
  await service.prisma.contactStatusEvent.create({
    data: {
      organizationSlug: SLUG,
      personId,
      field: 'civic_panel',
      toValue: 'member',
      source,
    },
  })
}

const statusRows = async (personId: string) =>
  (await service.prisma.contactCurrentStatus.count({
    where: { organizationSlug: SLUG, personId },
  })) +
  (await service.prisma.contactStatusEvent.count({
    where: { organizationSlug: SLUG, personId },
  }))

describe('20261024000000_drop_civic_panel_join_page', () => {
  it('takes joiners outside the voter file and everyone who joined from the page off the panel, and keeps everyone else', async () => {
    await service.prisma.organization.create({
      data: { slug: SLUG, ownerId: service.user.id },
    })
    await restoreJoinerTable()
    const joinerId = randomUUID()
    const voterId = randomUUID()
    const pageJoinerId = randomUUID()
    await run([
      `INSERT INTO "civic_panel_joiner" ("id", "updated_at", "organization_slug", "phone", "person_id", "matched", "source")
       VALUES ('${joinerId}', now(), '${SLUG}', '3035550199', '${joinerId}', false, 'text')`,
    ])
    await seedStatus(joinerId)
    await seedStatus(voterId)
    await seedStatus(pageJoinerId, 'share_page')

    await run(statements('20261024000000_drop_civic_panel_join_page'))

    expect(await statusRows(joinerId)).toBe(0)
    expect(await statusRows(voterId)).toBe(2)
    expect(await statusRows(pageJoinerId)).toBe(0)
    expect(
      await service.prisma.contactStatusEvent.count({
        where: { source: 'share_page' },
      }),
    ).toBe(0)
  })
})
