import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { HubspotService } from '@/crm/hubspot.service'
import { PrismaService } from '@/prisma/prisma.service'
import { ProfileClaimRequestSource } from '../../generated/prisma'
import { PERSON_PROFILES_DATABRICKS } from '../personProfiles.constants'
import { CrmPersonProfilesService } from './crm-person-profiles.service'

/**
 * The candidate-side counter behind the public "notify" form.
 *
 * HubSpot is mocked throughout — the live API is never called from tests. What
 * matters here is that the write is a COMPUTED TOTAL (so it is idempotent and
 * self-healing rather than a lossy read-modify-write increment), that it only
 * ever counts notify submissions, and that every failure mode is swallowed so
 * the visitor's already-committed claim request is never affected.
 */

const PERSON_ID = '11111111-1111-1111-1111-111111111111'
const CONTACT_ID = '987654321'

type SetupOptions = {
  hubspotConfigured?: boolean
  count?: number
  contactRows?: Array<Record<string, unknown>>
  databricksConfigured?: boolean
  databricksError?: Error
  updateError?: Error
}

const setup = async (options: SetupOptions = {}) => {
  const count = vi.fn().mockResolvedValue(options.count ?? 1)
  const prisma = { profileClaimRequest: { count } }

  const update = vi.fn(
    (_contactId: string, _body: { properties: Record<string, string> }) =>
      options.updateError
        ? Promise.reject(options.updateError)
        : Promise.resolve({ id: CONTACT_ID }),
  )
  const hubspot = {
    isConfigured: options.hubspotConfigured ?? true,
    client: { crm: { contacts: { basicApi: { update } } } },
  }

  const query = vi.fn((_sql: string) =>
    options.databricksError
      ? Promise.reject(options.databricksError)
      : Promise.resolve({
          columns: ['hs_contact_id'],
          rows: options.contactRows ?? [{ hs_contact_id: CONTACT_ID }],
        }),
  )
  const databricks = options.databricksConfigured === false ? null : { query }

  const moduleRef = await Test.createTestingModule({
    providers: [
      CrmPersonProfilesService,
      { provide: PrismaService, useValue: prisma },
      { provide: PinoLogger, useValue: createMockLogger() },
      { provide: HubspotService, useValue: hubspot },
      { provide: PERSON_PROFILES_DATABRICKS, useValue: databricks },
    ],
  }).compile()

  return {
    service: moduleRef.get(CrmPersonProfilesService),
    count,
    update,
    query,
  }
}

describe('CrmPersonProfilesService.syncClaimRequestCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes the person's notify total to their HubSpot contact", async () => {
    const { service, update } = await setup({ count: 3 })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).toHaveBeenCalledWith(CONTACT_ID, {
      properties: { candidate_profile_requests: '3' },
    })
  })

  it('counts only notify submissions, so an owner claim never inflates it', async () => {
    const { service, count } = await setup()

    await service.syncClaimRequestCount(PERSON_ID)

    expect(count).toHaveBeenCalledWith({
      where: { personId: PERSON_ID, source: ProfileClaimRequestSource.notify },
    })
  })

  it('writes the recomputed total, not an increment, so a retry is idempotent', async () => {
    const { service, update } = await setup({ count: 7 })

    await service.syncClaimRequestCount(PERSON_ID)
    await service.syncClaimRequestCount(PERSON_ID)

    // Same value both times: the source of truth is our own row count, so a
    // duplicate run cannot double-count the way a read-then-+1 would.
    expect(update.mock.calls.map(([, body]) => body)).toEqual([
      { properties: { candidate_profile_requests: '7' } },
      { properties: { candidate_profile_requests: '7' } },
    ])
  })

  it('resolves the contact by personId against the civics person mart', async () => {
    const { service, query } = await setup()

    await service.syncClaimRequestCount(PERSON_ID)

    const sql = query.mock.calls[0]?.[0] ?? ''
    expect(sql).toContain('goodparty_data_catalog.mart_civics.people')
    expect(sql).toContain(`gp_person_id = '${PERSON_ID}'`)
  })

  it('skips quietly when the person has no HubSpot contact', async () => {
    const { service, update } = await setup({ contactRows: [] })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).not.toHaveBeenCalled()
  })

  it('skips quietly when the mart resolves the person to a null contact id', async () => {
    // A person whose identity cluster spans more than one HubSpot contact is
    // nulled by the mart. Writing to an arbitrary one would be worse than
    // writing to none.
    const { service, update } = await setup({
      contactRows: [{ hs_contact_id: null }],
    })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).not.toHaveBeenCalled()
  })

  it('never creates a contact for a person the CRM has never seen', async () => {
    const { service, update } = await setup({ contactRows: [] })

    await service.syncClaimRequestCount(PERSON_ID)

    // A visitor nudging someone must not mint a CRM record for them.
    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing when HubSpot is unconfigured, rather than trusting the no-op mock', async () => {
    const { service, update, query } = await setup({
      hubspotConfigured: false,
    })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(query).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('is inert, not broken, when the warehouse is unconfigured', async () => {
    const { service, update } = await setup({ databricksConfigured: false })

    await expect(
      service.syncClaimRequestCount(PERSON_ID),
    ).resolves.toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a warehouse failure', async () => {
    const { service, update } = await setup({
      databricksError: new Error('warehouse unavailable'),
    })

    await expect(
      service.syncClaimRequestCount(PERSON_ID),
    ).resolves.toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a HubSpot failure so the visitor never sees it', async () => {
    const { service } = await setup({
      updateError: new Error('HubSpot 503'),
    })

    await expect(
      service.syncClaimRequestCount(PERSON_ID),
    ).resolves.toBeUndefined()
  })

  it('coerces a numeric contact id from the mart to the string HubSpot expects', async () => {
    const { service, update } = await setup({
      contactRows: [{ hs_contact_id: 987654321 }],
      count: 2,
    })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).toHaveBeenCalledWith('987654321', {
      properties: { candidate_profile_requests: '2' },
    })
  })

  it('refuses to interpolate a personId that is not a UUID', async () => {
    const { service, query, update } = await setup()

    await service.syncClaimRequestCount("' OR 1=1 --")

    expect(query).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
