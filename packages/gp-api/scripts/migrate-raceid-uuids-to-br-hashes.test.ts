import { describe, expect, it } from 'vitest'
import { useTestService } from '../src/test-service'
import {
  migrateRaceIds,
  type RaceIdMapping,
} from './migrate-raceid-uuids-to-br-hashes'

const UUID_A = 'c05b1c40-3c94-5544-ac56-0f83dd818a96'
const UUID_B = '7e2f3a10-1234-5544-9abc-0f83dd818a01'
const HASH_A = 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb25FbGVjdGlvbi8yNDc3MDgx'
const HASH_B = 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb25FbGVjdGlvbi8yMDc1NjMx'

const mapping = (entries: RaceIdMapping['migrate']): RaceIdMapping => ({
  ticket: 'ENG-10240',
  generatedAt: '2026-06-10',
  resolution: 'test fixture',
  migrate: entries,
  unresolved: [],
})

describe('migrateRaceIds', () => {
  const service = useTestService()

  const createCampaign = async (slug: string, raceId: string) => {
    const org = await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return service.prisma.campaign.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        slug,
        details: { raceId, state: 'CA' },
      },
    })
  }

  // Raw reads so the assertions see exactly what Postgres stores, and so
  // this file typechecks without the PrismaJson shadow types, which the
  // scripts eslint project does not resolve.
  const readDetail = async (id: number, key: string) => {
    const rows = await service.prisma.$queryRaw<{ value: string | null }[]>`
      SELECT details->>${key} AS value FROM campaign WHERE id = ${id}`
    return rows[0]?.value
  }

  const readRaceId = (id: number) => readDetail(id, 'raceId')

  it('rewrites the expected UUID to the BR hash and preserves other details', async () => {
    const campaign = await createCampaign('raceid-mig-basic', UUID_A)

    const reports = await migrateRaceIds(
      service.prisma,
      mapping([
        { campaignId: campaign.id, expectedUuid: UUID_A, brHashId: HASH_A },
      ]),
      true,
    )

    expect(reports).toEqual([
      {
        campaignId: campaign.id,
        status: 'done',
        currentRaceId: UUID_A,
        updated: true,
      },
    ])
    expect(await readRaceId(campaign.id)).toBe(HASH_A)
    expect(await readDetail(campaign.id, 'state')).toBe('CA')
  })

  it('is idempotent — a second run reports done and writes nothing', async () => {
    const campaign = await createCampaign('raceid-mig-idem', UUID_A)
    const m = mapping([
      { campaignId: campaign.id, expectedUuid: UUID_A, brHashId: HASH_A },
    ])

    await migrateRaceIds(service.prisma, m, true)
    const second = await migrateRaceIds(service.prisma, m, true)

    expect(second[0]).toMatchObject({ status: 'done', updated: false })
    expect(await readRaceId(campaign.id)).toBe(HASH_A)
  })

  it('leaves rows alone when the current value is not the expected UUID', async () => {
    const campaign = await createCampaign('raceid-mig-mismatch', UUID_B)

    const reports = await migrateRaceIds(
      service.prisma,
      mapping([
        { campaignId: campaign.id, expectedUuid: UUID_A, brHashId: HASH_A },
      ]),
      true,
    )

    expect(reports[0]).toMatchObject({
      status: 'mismatch',
      currentRaceId: UUID_B,
      updated: false,
    })
    expect(await readRaceId(campaign.id)).toBe(UUID_B)
  })

  it('dry run classifies without writing', async () => {
    const campaign = await createCampaign('raceid-mig-dry', UUID_B)

    const reports = await migrateRaceIds(
      service.prisma,
      mapping([
        { campaignId: campaign.id, expectedUuid: UUID_B, brHashId: HASH_B },
      ]),
      false,
    )

    expect(reports[0]).toMatchObject({ status: 'pending', updated: false })
    expect(await readRaceId(campaign.id)).toBe(UUID_B)
  })

  it('reports campaigns missing from the database', async () => {
    const reports = await migrateRaceIds(
      service.prisma,
      mapping([
        { campaignId: 99999999, expectedUuid: UUID_A, brHashId: HASH_A },
      ]),
      true,
    )

    expect(reports[0]).toMatchObject({ status: 'missing', updated: false })
  })
})
