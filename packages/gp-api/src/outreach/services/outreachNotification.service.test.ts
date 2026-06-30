import { Test, TestingModule } from '@nestjs/testing'
import {
  Campaign,
  OutreachType,
  User,
  VoterFileFilter,
} from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { CampaignTcrComplianceService } from 'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { CrmCampaignsService } from 'src/campaigns/services/crmCampaigns.service'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { SlackChannel } from 'src/vendors/slack/slackService.types'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { OutreachWithVoterFileFilter } from '../types/outreach.types'
import {
  OutreachNotificationService,
  shouldNotifyCAS,
} from './outreachNotification.service'

const mockSlackMessage = vi.fn()
const mockCampaignsUpdate = vi.fn()
const mockGetCrmCompanyOwnerName = vi.fn()
const mockVoterFileFilterToAudience = vi.fn()
const mockTcrFindFirst = vi.fn()

const PEERLY_IDENTITY_LABEL = 'Peerly Identity ID: '

type TextNode = { text?: string }

const collectTextGroups = (node: unknown): TextNode[][] => {
  if (!node || typeof node !== 'object') return []
  const { elements } = node as { elements?: unknown }
  if (!Array.isArray(elements)) return []
  const hasText = elements.every(
    (e) => e && typeof e === 'object' && 'text' in (e as object),
  )
  if (hasText) return [elements as TextNode[]]
  return elements.flatMap(collectTextGroups)
}

/** Returns the value rendered next to a bold label in the Slack blocks. */
const findLabeledValue = (
  message: unknown,
  label: string,
): string | undefined => {
  const { blocks } = (message ?? {}) as { blocks?: unknown[] }
  const groups = (blocks ?? []).flatMap(collectTextGroups)
  const group = groups.find((els) => els.some((e) => e.text === label))
  if (!group) return undefined
  return group[group.findIndex((e) => e.text === label) + 1]?.text
}

const mockUser = {
  id: 1,
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  phone: null,
} as unknown as User

const baseCampaign = {
  id: 1,
  slug: 'jane-doe',
  aiContent: {},
  data: { hubspotId: 'hub-1' },
} as unknown as Campaign

const baseOutreach = {
  id: 10,
  outreachType: OutreachType.p2p,
  date: new Date('2026-06-01'),
  script: 'Vote for me. Reply STOP to opt-out.',
  imageUrl: 'https://cdn.example.com/img.png',
  message: '',
  projectId: 'peerly-job-123',
  voterFileFilter: { id: 1 } as unknown as VoterFileFilter,
} as unknown as OutreachWithVoterFileFilter

describe('shouldNotifyCAS', () => {
  it('returns false for undefined', () => {
    expect(shouldNotifyCAS(undefined)).toBe(false)
  })

  it('returns false for non-notifiable types', () => {
    expect(shouldNotifyCAS('doorKnocking')).toBe(false)
    expect(shouldNotifyCAS('phoneBanking')).toBe(false)
    expect(shouldNotifyCAS('socialMedia')).toBe(false)
    expect(shouldNotifyCAS('email')).toBe(false)
  })

  it('returns true for p2p, text, and robocall', () => {
    expect(shouldNotifyCAS(OutreachType.p2p)).toBe(true)
    expect(shouldNotifyCAS(OutreachType.text)).toBe(true)
    expect(shouldNotifyCAS(OutreachType.robocall)).toBe(true)
  })
})

describe('OutreachNotificationService', () => {
  let service: OutreachNotificationService

  beforeEach(async () => {
    mockSlackMessage.mockReset().mockResolvedValue('ok')
    mockCampaignsUpdate.mockReset().mockResolvedValue({})
    mockGetCrmCompanyOwnerName.mockReset().mockResolvedValue('Test PA')
    mockVoterFileFilterToAudience.mockReset().mockResolvedValue({})
    mockTcrFindFirst.mockReset().mockResolvedValue(null)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: SlackService, useValue: { message: mockSlackMessage } },
        {
          provide: CampaignsService,
          useValue: { update: mockCampaignsUpdate },
        },
        {
          provide: CampaignTcrComplianceService,
          useValue: { findFirst: mockTcrFindFirst },
        },
        {
          provide: CrmCampaignsService,
          useValue: { getCrmCompanyOwnerName: mockGetCrmCompanyOwnerName },
        },
        {
          provide: VoterFileFilterService,
          useValue: {
            voterFileFilterToAudience: mockVoterFileFilterToAudience,
          },
        },
        OutreachNotificationService,
      ],
    }).compile()

    service = module.get(OutreachNotificationService)
  })

  describe('notifySuccess', () => {
    it('skips when outreachType is non-notifiable', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: {
          ...baseOutreach,
          outreachType: 'doorKnocking' as OutreachType,
        },
      })

      expect(mockSlackMessage).not.toHaveBeenCalled()
      expect(mockCampaignsUpdate).not.toHaveBeenCalled()
    })

    it('handles null voterFileFilter without crashing', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: {
          ...baseOutreach,
          voterFileFilter: null,
        } as unknown as OutreachWithVoterFileFilter,
      })

      expect(mockVoterFileFilterToAudience).not.toHaveBeenCalled()
      expect(mockSlackMessage).toHaveBeenCalledTimes(1)
      expect(mockCampaignsUpdate).toHaveBeenCalledTimes(1)
    })

    it('includes peerlyJobUrl when projectId is set', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(JSON.stringify(blocks)).toContain('peerly.com')
    })

    it('omits peerlyJobUrl when projectId is null', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: { ...baseOutreach, projectId: null },
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(JSON.stringify(blocks)).not.toContain('peerly.com')
    })

    it('renders the text count with a separate billable line', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
        textCount: 12259,
        billableTextCount: 7259,
      })

      const [message] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(findLabeledValue(message, '# of Texts: ')).toBe('12,259')
      expect(findLabeledValue(message, '# of Billable Texts: ')).toBe('7,259')
    })

    it('includes the campaign plan due date', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
        campaignPlanDueDate: '2026-07-01',
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(JSON.stringify(blocks)).toContain('2026-07-01')
    })

    it('forwards the raw Peerly Job ID from outreach.projectId', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
      })

      const [message] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(findLabeledValue(message, 'Peerly Job ID: ')).toBe(
        'peerly-job-123',
      )
    })

    it('looks up and renders the Peerly Identity ID from TCR compliance', async () => {
      mockTcrFindFirst.mockResolvedValueOnce({
        peerlyIdentityId: 'identity-789',
      })

      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
      })

      expect(mockTcrFindFirst).toHaveBeenCalledWith({
        where: { campaignId: baseCampaign.id },
      })
      const [message] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(findLabeledValue(message, PEERLY_IDENTITY_LABEL)).toBe(
        'identity-789',
      )
    })

    it('renders N/A for the Peerly Identity ID when no TCR record exists', async () => {
      mockTcrFindFirst.mockResolvedValueOnce(null)

      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
      })

      const [message] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(findLabeledValue(message, PEERLY_IDENTITY_LABEL)).toBe('N/A')
    })

    it('renders N/A when the TCR record has a null peerlyIdentityId', async () => {
      mockTcrFindFirst.mockResolvedValueOnce({ peerlyIdentityId: null })

      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
      })

      const [message] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(findLabeledValue(message, PEERLY_IDENTITY_LABEL)).toBe('N/A')
    })

    it('still sends the notification (identity N/A) when the TCR lookup fails', async () => {
      mockTcrFindFirst.mockRejectedValueOnce(new Error('db down'))

      await expect(
        service.notifySuccess({
          user: mockUser,
          campaign: baseCampaign,
          outreach: baseOutreach,
        }),
      ).resolves.toBeUndefined()

      expect(mockSlackMessage).toHaveBeenCalledTimes(1)
      const [message] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(findLabeledValue(message, PEERLY_IDENTITY_LABEL)).toBe('N/A')
    })

    it('looks up assignedPa when hubspotId is present', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: baseCampaign,
        outreach: baseOutreach,
      })

      expect(mockGetCrmCompanyOwnerName).toHaveBeenCalledWith('hub-1')
    })

    it('skips assignedPa lookup when hubspotId is missing', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: { ...baseCampaign, data: {} } as unknown as Campaign,
        outreach: baseOutreach,
      })

      expect(mockGetCrmCompanyOwnerName).not.toHaveBeenCalled()
    })

    it('increments textCampaignCount via campaignsService.update', async () => {
      await service.notifySuccess({
        user: mockUser,
        campaign: {
          ...baseCampaign,
          data: { hubspotId: 'hub-1', textCampaignCount: 4 },
        } as unknown as Campaign,
        outreach: baseOutreach,
      })

      expect(mockCampaignsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: baseCampaign.id },
          data: expect.objectContaining({
            data: expect.objectContaining({ textCampaignCount: 5 }),
          }),
        }),
      )
    })

    it('does not throw when campaignsService.update fails (logs and continues)', async () => {
      mockCampaignsUpdate.mockRejectedValueOnce(new Error('db down'))

      await expect(
        service.notifySuccess({
          user: mockUser,
          campaign: baseCampaign,
          outreach: baseOutreach,
        }),
      ).resolves.toBeUndefined()

      expect(mockSlackMessage).toHaveBeenCalledTimes(1)
    })

    it('still increments the counter when Slack message fails', async () => {
      mockSlackMessage.mockRejectedValueOnce(new Error('slack 5xx'))

      await expect(
        service.notifySuccess({
          user: mockUser,
          campaign: baseCampaign,
          outreach: baseOutreach,
        }),
      ).resolves.toBeUndefined()

      expect(mockSlackMessage).toHaveBeenCalledTimes(1)
      expect(mockCampaignsUpdate).toHaveBeenCalledTimes(1)
    })
  })

  describe('notifyFailure', () => {
    it('skips when outreachType is non-notifiable', async () => {
      await service.notifyFailure({
        user: mockUser,
        campaign: baseCampaign,
        createOutreachDto: { outreachType: 'doorKnocking' as OutreachType },
        step: 'validation',
        error: new Error('boom'),
      })

      expect(mockSlackMessage).not.toHaveBeenCalled()
    })

    it('skips when outreachType is undefined', async () => {
      await service.notifyFailure({
        user: mockUser,
        campaign: baseCampaign,
        createOutreachDto: {},
        step: 'validation',
        error: new Error('boom'),
      })

      expect(mockSlackMessage).not.toHaveBeenCalled()
    })

    it('fires when outreachType is notifiable', async () => {
      await service.notifyFailure({
        user: mockUser,
        campaign: baseCampaign,
        createOutreachDto: { outreachType: OutreachType.p2p },
        step: 'tcrLookup',
        error: new Error('TCR not found'),
      })

      expect(mockSlackMessage).toHaveBeenCalledTimes(1)
      const [blocks, channel] = firstOrThrow(mockSlackMessage.mock.calls)
      const blob = JSON.stringify(blocks)
      expect(blob).toContain('FAILED')
      expect(blob).toContain('tcrLookup')
      expect(blob).toContain('TCR not found')
      expect([SlackChannel.botPolitics, SlackChannel.botDev]).toContain(channel)
    })

    it('handles undefined campaign', async () => {
      await service.notifyFailure({
        user: mockUser,
        campaign: undefined,
        createOutreachDto: { outreachType: OutreachType.p2p },
        step: 'validation',
        error: new Error('bad input'),
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(JSON.stringify(blocks)).toContain('unknown')
    })

    it('truncates error messages longer than 500 chars', async () => {
      const longMessage = 'x'.repeat(800)
      await service.notifyFailure({
        user: mockUser,
        campaign: baseCampaign,
        createOutreachDto: { outreachType: OutreachType.p2p },
        step: 'peerlyJobCreation',
        error: new Error(longMessage),
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      const blob = JSON.stringify(blocks)
      expect(blob).toContain('x'.repeat(500))
      expect(blob).not.toContain('x'.repeat(501))
    })

    it('shows "None" when script is missing', async () => {
      await service.notifyFailure({
        user: mockUser,
        campaign: baseCampaign,
        createOutreachDto: { outreachType: OutreachType.p2p },
        step: 'validation',
        error: new Error('boom'),
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(JSON.stringify(blocks)).toContain('None')
    })

    it('truncates script preview at 200 chars', async () => {
      const longScript = 'a'.repeat(500)
      await service.notifyFailure({
        user: mockUser,
        campaign: baseCampaign,
        createOutreachDto: {
          outreachType: OutreachType.p2p,
          script: longScript,
        },
        step: 'validation',
        error: new Error('boom'),
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      const blob = JSON.stringify(blocks)
      expect(blob).toContain('a'.repeat(200))
      expect(blob).not.toContain('a'.repeat(201))
    })

    it('shows "Not provided" for missing date', async () => {
      await service.notifyFailure({
        user: mockUser,
        campaign: baseCampaign,
        createOutreachDto: { outreachType: OutreachType.p2p },
        step: 'validation',
        error: new Error('boom'),
      })

      const [blocks] = firstOrThrow(mockSlackMessage.mock.calls)
      expect(JSON.stringify(blocks)).toContain('Not provided')
    })
  })
})
