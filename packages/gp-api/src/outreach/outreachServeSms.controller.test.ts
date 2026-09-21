import { describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ElectedOffice, User } from '../generated/prisma'
import { OutreachServeSmsController } from './outreachServeSms.controller'
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import { OutreachServeSmsCreateService } from './services/outreachServeSmsCreate.service'
import { SERVE_SMS_VOICE } from './util/serveSmsVoice.util'

// Direct instantiation rather than the HTTP harness: the controller is not
// registered in OutreachModule yet (module wiring is task B1), so there is no
// route to drive. Swap these for route tests once B1 lands.
const user = { id: 7, firstName: 'Alex', lastName: 'Rivera' } as User
const electedOffice = {
  id: 'eo-1',
  userId: 7,
  organizationSlug: 'eo-alex-rivera',
} as ElectedOffice

const buildController = (
  overrides: { positionName?: string | null; districtThrows?: boolean } = {},
) => {
  const generateDraftWithVoice = vi.fn().mockResolvedValue('draft body')
  const buildProfileContext = vi
    .fn()
    .mockResolvedValue(["The official's bio, in their own words:"])
  const organizations = {
    resolvePositionNameByOrganizationSlug: vi
      .fn()
      .mockResolvedValue(
        overrides.positionName === undefined
          ? 'City Council'
          : overrides.positionName,
      ),
    getDistrictForOrgSlug: overrides.districtThrows
      ? vi.fn().mockRejectedValue(new Error('election-api down'))
      : vi.fn().mockResolvedValue({ l2Name: 'Austin City', state: 'TX' }),
  } as unknown as OrganizationsService
  vi.spyOn(OrganizationsService, 'extractCityFromDistrictName').mockReturnValue(
    'Austin',
  )
  const createDraft = vi.fn().mockResolvedValue({
    outreachId: 12,
    recipientCount: 480,
    excludedOptedOutCount: 3,
    excludedDuplicateCount: 7,
  })
  const controller = new OutreachServeSmsController(
    { generateDraftWithVoice } as unknown as OutreachSmsGenerationService,
    {
      buildProfileContext,
    } as unknown as OutreachServeComposeContextService,
    organizations,
    { createDraft } as unknown as OutreachServeSmsCreateService,
    createMockLogger(),
  )
  return {
    controller,
    generateDraftWithVoice,
    buildProfileContext,
    createDraft,
  }
}

describe('OutreachServeSmsController.draft', () => {
  it('composes with the serve voice, the office held, and profile context', async () => {
    const { controller, generateDraftWithVoice, buildProfileContext } =
      buildController()

    const result = await controller.draft(user, electedOffice, {
      purpose: 'community_input',
      tone: 'warm',
    })

    expect(result).toEqual({ draft: 'draft body' })
    expect(buildProfileContext).toHaveBeenCalledWith(electedOffice.userId)
    expect(generateDraftWithVoice).toHaveBeenCalledWith(
      { purpose: 'community_input', tone: 'warm' },
      'Alex Rivera',
      'City Council',
      '7',
      [
        'Where the elected official serves: Austin, TX.',
        "The official's bio, in their own words:",
      ],
      SERVE_SMS_VOICE,
    )
  })

  // Office and place are prompt enrichment: election-api is not on the
  // critical path for a draft, so its failure degrades rather than 502s.
  it('still drafts when office/place resolution fails', async () => {
    const { controller, generateDraftWithVoice } = buildController({
      districtThrows: true,
    })

    await controller.draft(user, electedOffice, {
      purpose: 'introduce_myself',
      tone: 'direct',
    })

    expect(generateDraftWithVoice).toHaveBeenCalledWith(
      expect.anything(),
      'Alex Rivera',
      '',
      '7',
      ["The official's bio, in their own words:"],
      SERVE_SMS_VOICE,
    )
  })
})

describe('OutreachServeSmsController.create', () => {
  // The org is the guard's, not the body's: a client that names another
  // organization is not naming the scope this row is written under.
  it('scopes the create to the guard-resolved org and returns the counts', async () => {
    const { controller, createDraft } = buildController()

    const input = {
      name: 'Budget hearing reminder',
      message: 'The budget hearing is Thursday at 6pm at City Hall.',
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: 55,
    }

    const result = await controller.create(electedOffice, input)

    expect(createDraft).toHaveBeenCalledWith('eo-alex-rivera', input)
    expect(result).toEqual({
      outreachId: 12,
      recipientCount: 480,
      excludedOptedOutCount: 3,
      excludedDuplicateCount: 7,
    })
  })
})
