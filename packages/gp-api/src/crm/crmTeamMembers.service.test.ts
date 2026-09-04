import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationRole } from '../generated/prisma'
import { CrmTeamMembersService } from './crmTeamMembers.service'

const CANDIDATE_LABEL_ID = 501
const CAMPAIGN_MANAGER_LABEL_ID = 502
const VOLUNTEER_LABEL_ID = 503

const LABEL_ID_BY_NAME: Record<string, number> = {
  Candidate: CANDIDATE_LABEL_ID,
  'Campaign Manager': CAMPAIGN_MANAGER_LABEL_ID,
  Volunteer: VOLUNTEER_LABEL_ID,
}

describe('CrmTeamMembersService', () => {
  const doSearch = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const associationsCreate = vi.fn()
  const associationsArchiveLabels = vi.fn()
  const resolveLabelId = vi.fn()
  const hubspot = {
    isConfigured: true,
    client: {
      crm: {
        contacts: {
          searchApi: { doSearch },
          basicApi: { create, update },
        },
        associations: {
          v4: {
            batchApi: {
              create: associationsCreate,
              archiveLabels: associationsArchiveLabels,
            },
          },
        },
      },
    },
  }
  const associationLabels = { resolveLabelId }
  const logger = createMockLogger()

  let service: CrmTeamMembersService

  beforeEach(() => {
    vi.clearAllMocks()
    hubspot.isConfigured = true
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockResolvedValue({ id: 'contact-new' })
    update.mockResolvedValue({ id: 'contact-existing' })
    associationsCreate.mockResolvedValue(undefined)
    associationsArchiveLabels.mockResolvedValue(undefined)
    resolveLabelId.mockImplementation((name: string) =>
      Promise.resolve(LABEL_ID_BY_NAME[name]),
    )
    service = new CrmTeamMembersService(
      hubspot as never,
      associationLabels as never,
      logger,
    )
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
    expect(resolveLabelId).toHaveBeenCalledWith('Campaign Manager')
    expect(associationsCreate).toHaveBeenCalledWith('0-2', '0-1', {
      inputs: [
        {
          _from: { id: 'company-1' },
          to: { id: 'contact-new' },
          types: [
            {
              associationCategory: 'USER_DEFINED',
              associationTypeId: CAMPAIGN_MANAGER_LABEL_ID,
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
    // Owner-role members synced through the team path carry the Candidate
    // label, same as the campaign-sync path (ENG-11031).
    expect(resolveLabelId).toHaveBeenCalledWith('Candidate')
    expect(associationsCreate).toHaveBeenCalledWith(
      '0-2',
      '0-1',
      expect.objectContaining({
        inputs: [
          expect.objectContaining({
            types: [
              {
                associationCategory: 'USER_DEFINED',
                associationTypeId: CANDIDATE_LABEL_ID,
              },
            ],
          }),
        ],
      }),
    )
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

  it('skips the labeled write and logs when the label is missing', async () => {
    resolveLabelId.mockResolvedValue(undefined)

    await service.syncTeamMember({
      email: 'unlabeled@example.com',
      name: 'Unlabeled',
      role: OrganizationRole.campaignAdmin,
      crmCompanyId: 'company-1',
    })

    expect(create).toHaveBeenCalled()
    expect(associationsCreate).not.toHaveBeenCalled()
  })

  describe('role change', () => {
    it('archives the old label and creates the new one', async () => {
      await service.syncTeamMember({
        email: 'promoted@example.com',
        name: 'Promoted Person',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
        fromRole: OrganizationRole.volunteer,
      })

      expect(resolveLabelId).toHaveBeenCalledWith('Volunteer')
      expect(resolveLabelId).toHaveBeenCalledWith('Campaign Manager')
      expect(associationsArchiveLabels).toHaveBeenCalledWith('0-2', '0-1', {
        inputs: [
          {
            _from: { id: 'company-1' },
            to: { id: 'contact-new' },
            types: [
              {
                associationCategory: 'USER_DEFINED',
                associationTypeId: VOLUNTEER_LABEL_ID,
              },
            ],
          },
        ],
      })
      expect(associationsCreate).toHaveBeenCalledWith('0-2', '0-1', {
        inputs: [
          {
            _from: { id: 'company-1' },
            to: { id: 'contact-new' },
            types: [
              {
                associationCategory: 'USER_DEFINED',
                associationTypeId: CAMPAIGN_MANAGER_LABEL_ID,
              },
            ],
          },
        ],
      })
    })

    it('does not archive when the role is unchanged', async () => {
      await service.syncTeamMember({
        email: 'same@example.com',
        name: 'Same Role',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
        fromRole: OrganizationRole.campaignAdmin,
      })

      expect(associationsArchiveLabels).not.toHaveBeenCalled()
      expect(associationsCreate).toHaveBeenCalled()
    })

    it('still writes the new label when the old label fails to archive', async () => {
      associationsArchiveLabels.mockRejectedValue(new Error('hubspot down'))

      await expect(
        service.syncTeamMember({
          email: 'archive-fail@example.com',
          name: 'Archive Fail',
          role: OrganizationRole.campaignAdmin,
          crmCompanyId: 'company-1',
          fromRole: OrganizationRole.volunteer,
        }),
      ).resolves.toBeUndefined()

      expect(associationsCreate).toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('removeTeamMemberAssociation', () => {
    beforeEach(() => {
      doSearch.mockResolvedValue({
        total: 1,
        results: [{ id: 'contact-removed', properties: { email: 'x' } }],
      })
    })

    it('archives the label and does not create a new association', async () => {
      await service.removeTeamMemberAssociation({
        email: 'removed@example.com',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
        clearTeamRole: false,
      })

      expect(resolveLabelId).toHaveBeenCalledWith('Campaign Manager')
      expect(associationsArchiveLabels).toHaveBeenCalledWith('0-2', '0-1', {
        inputs: [
          {
            _from: { id: 'company-1' },
            to: { id: 'contact-removed' },
            types: [
              {
                associationCategory: 'USER_DEFINED',
                associationTypeId: CAMPAIGN_MANAGER_LABEL_ID,
              },
            ],
          },
        ],
      })
      expect(associationsCreate).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })

    it('clears team_role when told no membership remains', async () => {
      await service.removeTeamMemberAssociation({
        email: 'removed@example.com',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
        clearTeamRole: true,
      })

      expect(update).toHaveBeenCalledWith('contact-removed', {
        properties: { team_role: '' },
      })
    })

    it('does not clear team_role when other memberships remain', async () => {
      await service.removeTeamMemberAssociation({
        email: 'removed@example.com',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
        clearTeamRole: false,
      })

      expect(update).not.toHaveBeenCalled()
    })

    it('is a no-op when no contact is found for the email', async () => {
      doSearch.mockResolvedValue({ total: 0, results: [] })

      await service.removeTeamMemberAssociation({
        email: 'unknown@example.com',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
        clearTeamRole: true,
      })

      expect(associationsArchiveLabels).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })

    it('skips the archive but still clears team_role when no company id is known', async () => {
      await service.removeTeamMemberAssociation({
        email: 'removed@example.com',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: null,
        clearTeamRole: true,
      })

      expect(associationsArchiveLabels).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith('contact-removed', {
        properties: { team_role: '' },
      })
    })

    it('does not throw when HubSpot rejects the removal sync', async () => {
      associationsArchiveLabels.mockRejectedValue(new Error('hubspot down'))

      await expect(
        service.removeTeamMemberAssociation({
          email: 'removed@example.com',
          role: OrganizationRole.campaignAdmin,
          crmCompanyId: 'company-1',
          clearTeamRole: false,
        }),
      ).resolves.toBeUndefined()

      expect(logger.error).toHaveBeenCalled()
    })

    it('skips entirely when HubSpot is not configured', async () => {
      hubspot.isConfigured = false

      await service.removeTeamMemberAssociation({
        email: 'removed@example.com',
        role: OrganizationRole.campaignAdmin,
        crmCompanyId: 'company-1',
        clearTeamRole: true,
      })

      expect(doSearch).not.toHaveBeenCalled()
      expect(associationsArchiveLabels).not.toHaveBeenCalled()
    })
  })
})
