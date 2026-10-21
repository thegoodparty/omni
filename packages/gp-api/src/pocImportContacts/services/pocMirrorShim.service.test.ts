import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OrgContact,
  OrgContactLinkMethod,
  OrgContactLinkStatus,
} from '@/generated/prisma'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PocMirrorShimService } from './pocMirrorShim.service'

const contact = (i: number): OrgContact => ({
  id: `contact-${i}`,
  createdAt: new Date('2026-10-21T00:00:00Z'),
  updatedAt: new Date('2026-10-21T00:00:00Z'),
  organizationSlug: 'eo-poc',
  firstName: 'Testy',
  lastName: 'Mcfake'.padEnd(400, 'x'),
  email: null,
  phone: null,
  address: null,
  city: null,
  zip: null,
  sourceImportId: null,
  doNotContactAt: null,
  deletedAt: null,
})

describe('PocMirrorShimService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does nothing while POC_IMPORT_CONTACTS_MIRROR_SHIM is off', async () => {
    vi.stubEnv('POC_IMPORT_CONTACTS_MIRROR_SHIM', 'false')
    const query = vi.fn()
    const shim = new PocMirrorShimService(createMockLogger(), {
      query,
    } as unknown as PeopleDbxStatementClient)
    expect(await shim.mirror([contact(0)], [])).toEqual({
      mirrored: false,
      mirrorMs: 0,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('MERGEs by id in batches under the parameter size cap', async () => {
    vi.stubEnv('POC_IMPORT_CONTACTS_MIRROR_SHIM', 'true')
    const query = vi.fn().mockResolvedValue({ columns: [], rows: [] })
    const shim = new PocMirrorShimService(createMockLogger(), {
      query,
    } as unknown as PeopleDbxStatementClient)
    const contacts = Array.from({ length: 5000 }, (_, i) => contact(i))
    const result = await shim.mirror(contacts, [
      {
        id: 'link-1',
        createdAt: new Date('2026-10-21T00:00:00Z'),
        updatedAt: new Date('2026-10-21T00:00:00Z'),
        organizationSlug: 'eo-poc',
        orgContactId: 'contact-1',
        vendorPersonId: null,
        status: OrgContactLinkStatus.unverified,
        method: OrgContactLinkMethod.exact_name,
        actorUserId: 123,
        revokedAt: null,
      },
    ])
    expect(result.mirrored).toBe(true)
    const merges = query.mock.calls
      .map(([statement]) => statement)
      .filter((statement) => statement.sql.startsWith('MERGE INTO'))
    const contactMerges = merges.filter((m) =>
      m.sql.includes('poc_import_contacts_mirror.org_contact t'),
    )
    expect(contactMerges.length).toBeGreaterThan(1)
    for (const merge of merges) {
      expect(merge.params[0].value.length).toBeLessThan(1_048_576)
      expect(merge.sql).toContain('ON t.id = s.id')
    }
    const merged = contactMerges.flatMap(
      (m) => JSON.parse(m.params[0].value) as { id: string }[],
    )
    expect(merged).toHaveLength(5000)
  })
})
