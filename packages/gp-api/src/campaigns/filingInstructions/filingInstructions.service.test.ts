import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { firstOrThrow } from '@/shared/test-utils/arrays.util'
import { EmailService } from 'src/email/email.service'
import { Campaign, User } from 'src/generated/prisma'
import type { RaceTargetMetrics } from '@goodparty_org/contracts'
import { CampaignsService } from '../services/campaigns.service'
import { FilingInstructionsService } from './filingInstructions.service'

const campaign = {
  id: 1,
  details: { filingPeriodsStart: '2026-06-01', filingPeriodsEnd: '2026-06-15' },
} as unknown as Campaign

const user = { id: 7, email: 'candidate@example.com' } as unknown as User

const metrics = {
  filingFee: 100,
  filingRequirementsText: 'Filing fee: $100.',
  filingOfficeAddress: '500 Election Way, Sacramento, CA 95814',
  filingPhoneNumber: '(916) 555-0199',
  paperworkInstructions: 'Submit to the city clerk.',
} as RaceTargetMetrics

describe('FilingInstructionsService.emailToCandidate', () => {
  let service: FilingInstructionsService
  let sendEmail: ReturnType<typeof vi.fn>
  let fetchLiveRaceTargetMetrics: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendEmail = vi.fn().mockResolvedValue({ id: 'mailgun-id' })
    fetchLiveRaceTargetMetrics = vi.fn().mockResolvedValue(metrics)
    service = new FilingInstructionsService(
      { fetchLiveRaceTargetMetrics } as unknown as CampaignsService,
      { sendEmail } as unknown as EmailService,
      createMockLogger(),
    )
  })

  it('emails the candidate the rendered filing instructions', async () => {
    await service.emailToCandidate(campaign, user)

    expect(fetchLiveRaceTargetMetrics).toHaveBeenCalledWith(campaign)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const payload = firstOrThrow(sendEmail.mock.calls)[0]
    expect(payload.to).toBe(user.email)
    expect(payload.subject).toBe('Your filing instructions - GoodParty.org')
    expect(payload.message).toContain(
      'Filing window: June 1, 2026 – June 15, 2026',
    )
    expect(payload.message).toContain('Filing fee: $100')
    expect(payload.message).toContain(
      'Address: 500 Election Way, Sacramento, CA 95814',
    )
    expect(payload.message).toContain('Phone: (916) 555-0199')
  })

  it('sends an HTML body with line breaks so it is not a wall of text', async () => {
    await service.emailToCandidate(campaign, user)

    const payload = firstOrThrow(sendEmail.mock.calls)[0]
    expect(payload.html).toContain('<br />')
    expect(payload.html).not.toContain('\n')
    expect(payload.html).toBe(payload.message.replace(/\n/g, '<br />'))
  })

  it('still sends with just the window when live metrics are unavailable', async () => {
    fetchLiveRaceTargetMetrics.mockResolvedValue(null)

    await service.emailToCandidate(campaign, user)

    const payload = firstOrThrow(sendEmail.mock.calls)[0]
    expect(payload.to).toBe(user.email)
    expect(payload.message).toContain(
      'Filing window: June 1, 2026 – June 15, 2026',
    )
    expect(payload.message).not.toContain('Filing fee:')
    expect(payload.message).not.toContain('Filing office')
  })

  it('propagates the email-service failure (does not swallow)', async () => {
    sendEmail.mockRejectedValue(
      new BadGatewayException('error communicating w/ mail service'),
    )

    await expect(service.emailToCandidate(campaign, user)).rejects.toThrow(
      BadGatewayException,
    )
  })
})

describe('FilingInstructionsService.getContent', () => {
  let service: FilingInstructionsService
  let fetchLiveRaceTargetMetrics: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchLiveRaceTargetMetrics = vi.fn().mockResolvedValue(metrics)
    service = new FilingInstructionsService(
      { fetchLiveRaceTargetMetrics } as unknown as CampaignsService,
      { sendEmail: vi.fn() } as unknown as EmailService,
      createMockLogger(),
    )
  })

  it('returns the structured content the screen renders', async () => {
    const content = await service.getContent(campaign)

    expect(fetchLiveRaceTargetMetrics).toHaveBeenCalledWith(campaign)
    expect(content).toEqual({
      filingWindow: 'June 1, 2026 – June 15, 2026',
      filingFee: 100,
      filingRequirementsText: 'Filing fee: $100.',
      filingOfficeAddress: '500 Election Way, Sacramento, CA 95814',
      filingPhoneNumber: '(916) 555-0199',
      paperworkInstructions: 'Submit to the city clerk.',
    })
  })

  it('returns the window with null metrics fields when live metrics are absent', async () => {
    fetchLiveRaceTargetMetrics.mockResolvedValue(null)

    const content = await service.getContent(campaign)

    expect(content.filingWindow).toBe('June 1, 2026 – June 15, 2026')
    expect(content.filingFee).toBeNull()
    expect(content.filingOfficeAddress).toBeNull()
  })
})
