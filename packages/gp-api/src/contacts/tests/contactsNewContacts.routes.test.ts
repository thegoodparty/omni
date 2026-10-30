import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { ElectionDistrictService } from '@/peopleDb/services/electionDistrict.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const NEW_CONTACT = 'coalesce(v.`ContactIsNew`, false)'

// Totals count everyone. A Win campaign with imported contacts also gets how
// many of them only an import added, so the product can show voters as the
// total less them; Serve counts everyone together. Asserted on the statements
// that reach the warehouse and on the response.
describe('new contacts on Win', () => {
  const createWinOrg = async () => {
    const slug = `campaign-new-contacts-${randomUUID()}`
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
    const slug = `eo-new-contacts-${randomUUID()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const stubWarehouse = (importContacts: boolean) => {
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockImplementation(
      async ({ feature }) =>
        feature === SERVE_IMPORT_CONTACTS_FLAG && importContacts,
    )
    vi.spyOn(
      service.app.get(ElectionDistrictService),
      'findDistrictById',
    ).mockImplementation(async (id: string) => ({
      id,
      type: 'City',
      name: 'Lansing',
      state: 'MI',
    }))
    return vi
      .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
      .mockImplementation(async ({ sql }) => {
        if (sql.includes('GROUPING SETS')) {
          const split = sql.includes('AS new_count')
          return {
            columns: [],
            rows: [
              ['TOTAL', 'all', '100', '40', ...(split ? ['14'] : [])],
              ['age', '18-25', '100', null, ...(split ? ['0'] : [])],
            ],
          }
        }
        if (sql.includes('AS phoneBanking')) {
          const split = sql.includes('AS new_count')
          return {
            columns: [],
            rows: [
              [
                '900',
                '47',
                null,
                '700',
                '200',
                '500',
                '100',
                '30',
                ...(split ? ['14', '9', '1', '10', '0', '12'] : []),
              ],
            ],
          }
        }
        if (sql.includes('AS voter_count')) {
          return {
            columns: [],
            rows: [sql.includes('AS new_count') ? ['900', '14'] : ['7']],
          }
        }
        return { columns: [], rows: [] }
      })
  }

  const statementsFor = (query: ReturnType<typeof stubWarehouse>) =>
    query.mock.calls.map(([statement]) => statement.sql)

  describe('GET /v1/contacts/stats', () => {
    it('counts everyone, and of them the new contacts', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(true)

      const response = await service.client.get('/v1/contacts/stats', {
        headers: { [ORG_SLUG_HEADER]: slug },
      })

      expect(response.status).toBe(200)
      expect(response.data).toMatchObject({
        totalConstituents: 100,
        totalConstituentsWithCellPhone: 40,
        newContactsCount: 14,
      })
      const stats = statementsFor(query).find((sql) =>
        sql.includes('GROUPING SETS'),
      )
      expect(stats).toContain('COUNT(*) AS count')
      expect(stats).toContain('COUNT_IF(is_new) AS new_count')
    })

    it('is unchanged for a Win campaign without imported contacts', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(false)

      const response = await service.client.get('/v1/contacts/stats', {
        headers: { [ORG_SLUG_HEADER]: slug },
      })

      expect(response.status).toBe(200)
      expect(response.data.totalConstituents).toBe(100)
      expect(response.data).not.toHaveProperty('newContactsCount')
      for (const sql of statementsFor(query)) {
        expect(sql).not.toContain('is_new')
      }
    })

    it('is unchanged for Serve with imported contacts', async () => {
      const slug = await createServeOrg()
      const query = stubWarehouse(true)

      const response = await service.client.get('/v1/contacts/stats', {
        headers: { [ORG_SLUG_HEADER]: slug },
      })

      expect(response.status).toBe(200)
      expect(response.data.totalConstituents).toBe(100)
      expect(response.data).not.toHaveProperty('newContactsCount')
      const stats = statementsFor(query).find((sql) =>
        sql.includes('GROUPING SETS'),
      )
      expect(stats).toContain('COUNT(*) AS count')
      expect(stats).not.toContain('new_count')
    })
  })

  describe('GET /v1/contacts/list-detail', () => {
    it('reaches everyone on each channel, and says how many are new contacts', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(true)

      const response = await service.client.get('/v1/contacts/list-detail', {
        headers: { [ORG_SLUG_HEADER]: slug },
      })

      expect(response.status).toBe(200)
      expect(response.data.demographics).toEqual({
        people: 900,
        avgAge: 47,
        avgIncome: null,
        newContactsCount: 14,
      })
      expect(response.data.reachability).toEqual({
        sms: 700,
        robocall: 200,
        phoneBanking: 500,
        doorKnocking: 100,
        email: 30,
        polls: 700,
      })
      expect(response.data.newContactsReachable).toEqual({
        sms: 9,
        robocall: 1,
        phoneBanking: 10,
        doorKnocking: 0,
        email: 12,
        polls: 9,
      })
      const aggregates = statementsFor(query).find((sql) =>
        sql.includes('AS phoneBanking'),
      )
      expect(aggregates).toMatch(/^SELECT COUNT\(\*\) AS count,/)
      expect(aggregates).toContain(`COUNT_IF(${NEW_CONTACT}) AS new_count`)
    })

    it('is unchanged for Serve with imported contacts', async () => {
      const slug = await createServeOrg()
      stubWarehouse(true)

      const response = await service.client.get('/v1/contacts/list-detail', {
        headers: { [ORG_SLUG_HEADER]: slug },
      })

      expect(response.status).toBe(200)
      expect(response.data.demographics.people).toBe(900)
      expect(response.data.demographics).not.toHaveProperty('newContactsCount')
      expect(response.data).not.toHaveProperty('newContactsReachable')
    })

    it('applies a saved list’s source', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(true)
      const created = await service.client.post(
        '/v1/voters/voter-file/filter',
        { name: 'Imported only', source: ['imported'] },
        { headers: { [ORG_SLUG_HEADER]: slug } },
      )
      expect(created.status).toBe(201)
      const saved = await service.prisma.voterFileFilter.findUniqueOrThrow({
        where: { id: created.data.id },
      })
      expect(saved.source).toEqual(['imported'])

      const response = await service.client.get('/v1/contacts/list-detail', {
        params: { segment: String(saved.id) },
        headers: { [ORG_SLUG_HEADER]: slug },
      })

      expect(response.status).toBe(200)
      const aggregates = statementsFor(query).find((sql) =>
        sql.includes('AS phoneBanking'),
      )
      expect(aggregates).toMatch(
        new RegExp(` AND ${NEW_CONTACT.replace(/[()`.]/g, '\\$&')}$`),
      )
    })
  })

  describe('POST /v1/contacts/count', () => {
    it('counts everyone, and of them the new contacts', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(true)

      const response = await service.client.post(
        '/v1/contacts/count',
        {},
        { headers: { [ORG_SLUG_HEADER]: slug } },
      )

      expect(response.status).toBe(201)
      expect(response.data).toEqual({ count: 900, newContactsCount: 14 })
      const count = statementsFor(query).find((sql) =>
        sql.includes('AS voter_count'),
      )
      expect(count).toMatch(
        /^SELECT COUNT\(\*\) AS voter_count, COUNT_IF\(coalesce\(v\.`ContactIsNew`, false\)\) AS new_count FROM /,
      )
    })

    it('is unchanged without imported contacts', async () => {
      const slug = await createWinOrg()
      stubWarehouse(false)

      const response = await service.client.post(
        '/v1/contacts/count',
        {},
        { headers: { [ORG_SLUG_HEADER]: slug } },
      )

      expect(response.status).toBe(201)
      expect(response.data).toEqual({ count: 7 })
    })

    it('counts only new contacts for imported', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(true)

      const response = await service.client.post(
        '/v1/contacts/count',
        { source: ['imported'] },
        { headers: { [ORG_SLUG_HEADER]: slug } },
      )

      expect(response.status).toBe(201)
      const count = statementsFor(query).find((sql) =>
        sql.includes('AS voter_count'),
      )
      expect(count).toMatch(
        new RegExp(` AND ${NEW_CONTACT.replace(/[()`.]/g, '\\$&')}$`),
      )
    })

    it('counts only voters for voterFile', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(true)

      const response = await service.client.post(
        '/v1/contacts/count',
        { source: ['voterFile'] },
        { headers: { [ORG_SLUG_HEADER]: slug } },
      )

      expect(response.status).toBe(201)
      const count = statementsFor(query).find((sql) =>
        sql.includes('AS voter_count'),
      )
      expect(count).toContain(` AND NOT ${NEW_CONTACT}`)
    })

    it('matches no one for imported alone without imported contacts, rather than erroring', async () => {
      const slug = await createWinOrg()
      const query = stubWarehouse(false)

      const response = await service.client.post(
        '/v1/contacts/count',
        { source: ['imported'] },
        { headers: { [ORG_SLUG_HEADER]: slug } },
      )

      expect(response.status).toBe(201)
      const count = statementsFor(query).find((sql) =>
        sql.includes('AS voter_count'),
      )
      expect(count).toMatch(/ AND FALSE$/)
      expect(count).not.toContain('ContactIsNew')
    })

    it('rejects a source filter for Serve', async () => {
      const slug = await createServeOrg()
      stubWarehouse(true)

      const response = await service.client.post(
        '/v1/contacts/count',
        { source: ['voterFile'] },
        {
          headers: { [ORG_SLUG_HEADER]: slug },
          validateStatus: () => true,
        },
      )

      expect(response.status).toBe(400)
      expect(response.data.message).toBe(
        'Source filtering is not available for this organization',
      )
    })
  })
})
