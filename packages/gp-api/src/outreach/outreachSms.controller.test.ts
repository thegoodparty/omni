import { describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { User } from '../generated/prisma'
import { OutreachSmsController } from './outreachSms.controller'
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'
import { CampaignTcrComplianceService } from 'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service'

const requester = { id: 7, firstName: 'Derek', lastName: 'Lane' } as User

const campaign = {
  id: 1,
  userId: 2,
  organizationSlug: 'jared-smith',
  details: { normalizedOffice: 'State Senate' },
  user: { id: 2, firstName: 'Jared', lastName: 'Smith', name: null },
} as unknown as CampaignWith<'user'>

const buildController = () => {
  const generateDraft = vi.fn().mockResolvedValue('draft text')
  const generationService = {
    generateDraft,
  } as unknown as OutreachSmsGenerationService
  const composeContext = {
    buildCampaignContext: vi.fn().mockResolvedValue([]),
  } as unknown as OutreachComposeContextService
  const organizations = {
    resolvePositionNameByOrganizationSlug: vi
      .fn()
      .mockResolvedValue('State Senate'),
  } as unknown as OrganizationsService
  const findFirst = vi.fn().mockResolvedValue({
    candidateName: 'Jared T. Smith',
    committeeName: 'Friends of Jared Smith',
  })
  const tcrCompliance = {
    findFirst,
  } as unknown as CampaignTcrComplianceService
  const controller = new OutreachSmsController(
    generationService,
    composeContext,
    organizations,
    tcrCompliance,
    createMockLogger(),
  )
  return { controller, generateDraft, findFirst }
}

describe('OutreachSmsController.draft', () => {
  it("grounds the draft in the campaign OWNER's name, not the requester's", async () => {
    const { controller, generateDraft } = buildController()

    await controller.draft(requester, campaign, {
      purpose: 'introduce_myself',
      tone: 'friendly',
    })

    expect(generateDraft).toHaveBeenCalledWith(
      expect.anything(),
      'Jared Smith',
      'State Senate',
      // LLM-call attribution stays on the requester, the acting user.
      '7',
      expect.anything(),
      // A fresh draft writes only the body, so nothing is locked yet.
      undefined,
    )
  })

  it('hands Improve the names and committee scheduling will check', async () => {
    const { controller, generateDraft, findFirst } = buildController()

    await controller.draft(requester, campaign, {
      purpose: 'custom',
      tone: 'warm',
      currentDraft: "Hello {first_name}, it's Jared. Reply STOP to opt out.",
    })

    expect(findFirst).toHaveBeenCalledWith({ where: { campaignId: 1 } })
    expect(generateDraft.mock.calls[0]?.[5]).toEqual({
      candidateNames: ['Jared Smith', 'Jared T. Smith'],
      committeeName: 'Friends of Jared Smith',
      channel: 'peerly',
      ignoredRules: [],
    })
  })
})
