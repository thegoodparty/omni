import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { ElectionApiDistrictService } from '@/peopleDb/services/electionApiDistrict.service'
import { SERVE_CONSUMER_DATA_FLAG } from '@/peopleDb/services/peopleDataset.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const VOTERS_TABLE = 'goodparty_data_catalog.mart_gp_api.gp_api_voters'
const CONSTITUENTS_TABLE =
  'goodparty_data_catalog.mart_gp_api.gp_api_constituents'

// Which people table a count reads, asserted on the SQL that reaches the
// warehouse rather than on a spy further up: the table is chosen once per
// request from the org and threaded down, and the statement is the only place
// a wrong choice would be visible.
describe('POST /v1/contacts/count — people table', () => {
  const createWinProOrg = async () => {
    const slug = `campaign-dataset-${randomUUID()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
        isPro: true,
      },
    })
    return slug
  }

  const createServeOrg = async () => {
    const slug = `eo-dataset-${randomUUID()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const countSqlFor = async (slug: string, flagOn: boolean) => {
    const isFeatureEnabled = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(flagOn)
    vi.spyOn(
      service.app.get(ElectionApiDistrictService),
      'findDistrictById',
    ).mockImplementation(async (id: string) => ({
      id,
      type: 'City',
      name: 'Lansing',
      state: 'MI',
    }))
    const query = vi
      .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
      .mockImplementation(async ({ sql }) =>
        sql.includes('AS voter_count')
          ? { columns: ['voter_count'], rows: [['7']] }
          : { columns: [], rows: [] },
      )

    const response = await service.client.post(
      '/v1/contacts/count',
      {},
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 7 })
    return {
      sql: query.mock.calls.map(([statement]) => statement.sql),
      isFeatureEnabled,
    }
  }

  it('reads gp_api_voters for a Win org even with the flag on', async () => {
    const slug = await createWinProOrg()

    const { sql, isFeatureEnabled } = await countSqlFor(slug, true)

    expect(sql.length).toBeGreaterThan(0)
    for (const statement of sql) {
      expect(statement).toContain(`FROM ${VOTERS_TABLE} v`)
      expect(statement).not.toContain(CONSTITUENTS_TABLE)
    }
    // Win never consults the flag at all.
    expect(isFeatureEnabled).not.toHaveBeenCalledWith(
      expect.objectContaining({ feature: SERVE_CONSUMER_DATA_FLAG }),
    )
  })

  it('reads gp_api_constituents for a Serve org with the flag on', async () => {
    const slug = await createServeOrg()

    const { sql, isFeatureEnabled } = await countSqlFor(slug, true)

    expect(sql.length).toBeGreaterThan(0)
    for (const statement of sql) {
      expect(statement).toContain(`FROM ${CONSTITUENTS_TABLE} v`)
    }
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: service.user.id,
      feature: SERVE_CONSUMER_DATA_FLAG,
    })
  })

  it('reads gp_api_voters for a Serve org with the flag off', async () => {
    const slug = await createServeOrg()

    const { sql } = await countSqlFor(slug, false)

    expect(sql.length).toBeGreaterThan(0)
    for (const statement of sql) {
      expect(statement).toContain(`FROM ${VOTERS_TABLE} v`)
      expect(statement).not.toContain(CONSTITUENTS_TABLE)
    }
  })
})
