import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationRole } from '../generated/prisma'
import { CrmTeamMembersService } from './crmTeamMembers.service'

describe('CrmTeamMembersService', () => {
  const doSearch = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const associationsCreate = vi.fn()
  const hubspot = {
    isConfigured: true,
    client: {
      crm: {
        contacts: {
          searchApi: { doSearch },
          basicApi: { create, update },
        },
        associations: { v4: { batchApi: { create: associationsCreate } } },
      },
    },
  }
  const logger = createMockLogger()

  let service: CrmTeamMembersService

  beforeEach(() => {
    vi.clearAllMocks()
    hubspot.isConfigured = true
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockResolvedValue({ id: 'contact-new' })
    update.mockResolvedValue({ id: 'contact-existing' })
    associationsCreate.mockResolvedValue(undefined)
    service = new CrmTeamMembersService(hubspot as never, logger)
  })

  it('creates a contact with team_role when no existing contact is found', async () => {
    await service.syncTeamMember({
      email: 'new@example.com',
      name: 'Jamie Rivera',
      role: OrganizationRole.campaignAdmin,
      crmCompanyId: 'company-1',
    })

    expect(create).toHaveBeenCalledWith({
      properties: {
        email: 'new@example.com',
        firstname: 'Jamie',
        lastname: 'Rivera',
        team_role: 'campaign manager',
      },
    })
    expect(update).not.toHaveBeenCalled()
    expect(associationsCreate).toHaveBeenCalledWith('0-2', '0-1', {
      inputs: [
        {
          _from: { id: 'company-1' },
          to: { id: 'contact-new' },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: 280,
            },
          ],
        },
      ],
    })
  })

  it('updates the existing contact found by email instead of creating one', async () => {
    doSearch.mockResolvedValue({
      total: 1,
      results: [{ id: 'contact-existing', properties: { email: 'x' } }],
    })

    await service.syncTeamMember({
      email: 'existing@example.com',
      name: 'Owner Person',
      role: OrganizationRole.owner,
      crmCompanyId: 'company-2',
    })

    expect(update).toHaveBeenCalledWith('contact-existing', {
      properties: {
        email: 'existing@example.com',
        firstname: 'Owner',
        lastname: 'Person',
        team_role: 'owner',
      },
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('maps volunteer to the volunteer team_role value', async () => {
    await service.syncTeamMember({
      email: 'v@example.com',
      name: null,
      role: OrganizationRole.volunteer,
      crmCompanyId: null,
    })

    expect(create).toHaveBeenCalledWith({
      properties: { email: 'v@example.com', team_role: 'volunteer' },
    })
  })

  it('skips the association when no company id is known yet', async () => {
    await service.syncTeamMember({
      email: 'no-company@example.com',
      name: null,
      role: OrganizationRole.campaignAdmin,
      crmCompanyId: null,
    })

    expect(create).toHaveBeenCalled()
    expect(associationsCreate).not.toHaveBeenCalled()
  })

  it('skips entirely when HubSpot is not configured', async () => {
    hubspot.isConfigured = false

    await service.syncTeamMember({
      email: 'off@example.com',
      name: 'Off Prod',
      role: OrganizationRole.campaignAdmin,
      crmCompanyId: 'company-1',
    })

    expect(doSearch).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  // A failed search must propagate (fire-and-forget caller logs it) rather
  // than fall through to create: creating an existing contact 409s and the
  // team_role update + company association are silently lost.
  it('rejects when the contact search fails instead of mis-creating', async () => {
    doSearch.mockRejectedValue(new Error('hubspot 500'))

    await expect(
      service.syncTeamMember({
        email: 'member@example.com',
        name: 'Member',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: '901',
      }),
    ).rejects.toThrow('hubspot 500')
    expect(create).not.toHaveBeenCalled()
  })

  it('does not throw when the HubSpot contact create call rejects', async () => {
    // Mocks the dependency to throw what production would throw on a
    // HubSpot outage — asserts syncTeamMember's own try/catch, not a mock
    // standing in for that behavior.
    create.mockRejectedValue(new Error('hubspot down'))

    await expect(
      service.syncTeamMember({
        email: 'boom@example.com',
        name: 'Boom',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
      }),
    ).resolves.toBeUndefined()

    expect(associationsCreate).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it('does not throw when the association call rejects', async () => {
    associationsCreate.mockRejectedValue(new Error('hubspot down'))

    await expect(
      service.syncTeamMember({
        email: 'boom2@example.com',
        name: 'Boom Two',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
      }),
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalled()
  })
})
