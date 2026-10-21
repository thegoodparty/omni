import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrgContactLinkMethod, OrgContactLinkStatus } from '@/generated/prisma'
import { DatabricksVoterService } from '@/peopleDb/databricks/databricksVoter.service'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { useTestService } from '@/test-service'

const service = useTestService()

const ORG_SLUG = 'eo-poc-import-test'
const headers = { 'X-Organization-Slug': ORG_SLUG }

const PERSON_A = '5e7e0000-0000-4000-8000-00000000000a'
const PERSON_B1 = '5e7e0000-0000-4000-8000-0000000000b1'
const PERSON_B2 = '5e7e0000-0000-4000-8000-0000000000b2'

const candidateRow = (
  key: string,
  id: string,
  first: string,
  count: number,
) => [
  key,
  id,
  first,
  'Testperson',
  '1 Fake St',
  'HOUGHTON',
  '49931',
  '40',
  String(count),
]

const importBody = {
  fileName: 'synthetic.csv',
  consentAffirmed: true,
  rows: [
    { firstName: 'Ann-Marie', lastName: 'Testperson', phone: '906-555-0101' },
    { firstName: 'Bo', lastName: 'Testperson', email: 'bo@example.com' },
    { firstName: 'Cy', lastName: 'Testperson' },
  ],
}

describe('POC import contacts routes', () => {
  let dbxQuery: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.stubEnv('POC_IMPORT_CONTACTS_ENABLED', 'true')
    vi.stubEnv('POC_IMPORT_CONTACTS_MIRROR_SHIM', 'false')
    await service.prisma.organization.create({
      data: { slug: ORG_SLUG, ownerId: service.user.id },
    })
    vi.spyOn(
      service.app.get(ContactsService),
      'resolveEligibleDistrict',
    ).mockResolvedValue({ districtId: 'district-1', dataset: 'voters' })
    vi.spyOn(
      service.app.get(DatabricksVoterService),
      'resolveDistrict',
    ).mockResolvedValue({
      districtId: 'district-1',
      dataset: 'voters',
      table: 'goodparty_data_catalog.mart_gp_api.gp_api_voters',
      state: 'MI',
      districtType: 'City',
      districtName: 'HOUGHTON CITY',
      useVoterOnlyPath: false,
    })
    dbxQuery = vi
      .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
      .mockResolvedValue({
        columns: [],
        rows: [
          candidateRow('annmarie|testperson', PERSON_A, 'AnnMarie', 1),
          candidateRow('bo|testperson', PERSON_B1, 'Bo', 2),
          candidateRow('bo|testperson', PERSON_B2, 'Bo', 2),
        ],
      })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is a 404 while POC_IMPORT_CONTACTS_ENABLED is off', async () => {
    vi.stubEnv('POC_IMPORT_CONTACTS_ENABLED', 'false')
    const result = await service.client.post(
      '/v1/poc/contacts/imports',
      importBody,
      { headers },
    )
    expect(result.status).toBe(404)
    expect(dbxQuery).not.toHaveBeenCalled()
  })

  it('stages, reviews and commits an import into contacts and links', async () => {
    const staged = await service.client.post(
      '/v1/poc/contacts/imports',
      importBody,
      { headers },
    )
    expect(staged.status).toBe(201)
    expect(staged.data.counts).toEqual({
      total: 3,
      matched: 1,
      ambiguous: 1,
      unmatched: 1,
    })
    expect(dbxQuery).toHaveBeenCalledTimes(1)
    const matchSql = dbxQuery.mock.calls[0]?.[0]
    expect(matchSql?.params.map((p: { value: string }) => p.value)).toContain(
      JSON.stringify(['annmarie|testperson', 'bo|testperson', 'cy|testperson']),
    )
    const { importId } = staged.data

    const ambiguous = await service.client.get(
      `/v1/poc/contacts/imports/${importId}/ambiguous?page=1&pageSize=10`,
      { headers },
    )
    expect(ambiguous.data.total).toBe(1)
    expect(ambiguous.data.rows[0].rowIndex).toBe(1)
    expect(
      ambiguous.data.rows[0].candidates.map(
        (c: { personId: string }) => c.personId,
      ),
    ).toEqual([PERSON_B1, PERSON_B2])

    const notCandidate = await service.client.put(
      `/v1/poc/contacts/imports/${importId}/rows/1/resolution`,
      { resolution: 'link', personId: PERSON_A },
      { headers },
    )
    expect(notCandidate.status).toBe(400)

    const linked = await service.client.put(
      `/v1/poc/contacts/imports/${importId}/rows/1/resolution`,
      { resolution: 'link', personId: PERSON_B2 },
      { headers },
    )
    expect(linked.data).toEqual({
      rowIndex: 1,
      resolution: 'link',
      resolvedPersonId: PERSON_B2,
    })

    const committed = await service.client.post(
      `/v1/poc/contacts/imports/${importId}/commit`,
      {},
      { headers },
    )
    expect(committed.status).toBe(201)
    expect(committed.data.counts).toEqual({
      contacts: 3,
      verified: 2,
      unverified: 1,
    })
    expect(committed.data.mirrored).toBe(false)

    const contacts = await service.prisma.orgContact.findMany({
      where: { organizationSlug: ORG_SLUG },
      include: { links: true },
      orderBy: { firstName: 'asc' },
    })
    expect(
      contacts.map((c) => ({
        firstName: c.firstName,
        phone: c.phone,
        vendorPersonId: c.links[0]?.vendorPersonId,
        status: c.links[0]?.status,
        method: c.links[0]?.method,
      })),
    ).toEqual([
      {
        firstName: 'Ann-Marie',
        phone: '(906) 555-0101',
        vendorPersonId: PERSON_A,
        status: OrgContactLinkStatus.verified,
        method: OrgContactLinkMethod.exact_name,
      },
      {
        firstName: 'Bo',
        phone: null,
        vendorPersonId: PERSON_B2,
        status: OrgContactLinkStatus.verified,
        method: OrgContactLinkMethod.manual,
      },
      {
        firstName: 'Cy',
        phone: null,
        vendorPersonId: null,
        status: OrgContactLinkStatus.unverified,
        method: OrgContactLinkMethod.exact_name,
      },
    ])

    const again = await service.client.post(
      `/v1/poc/contacts/imports/${importId}/commit`,
      {},
      { headers },
    )
    expect(again.status).toBe(409)

    const [first] = contacts
    await expect(
      service.prisma.orgContactLink.create({
        data: {
          organizationSlug: ORG_SLUG,
          orgContactId: first!.id,
          status: OrgContactLinkStatus.unverified,
          method: OrgContactLinkMethod.manual,
        },
      }),
    ).rejects.toThrow()
  })
})
