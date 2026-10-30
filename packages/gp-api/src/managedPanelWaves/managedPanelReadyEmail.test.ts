import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { CIVIC_PANEL_JOIN_LINE } from '@goodparty_org/contracts'
import { EmailService } from '@/email/email.service'
import { FeaturesService } from '@/features/services/features.service'
import { ManagedCivicPanelStatus } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import {
  ManagedPanelWaveJobService,
  managedPanelReadyEmail,
} from './managedPanelWaveJob.service'

const service = useTestService()

const INVITE = `Hi, it's Mayor Lee. ${CIVIC_PANEL_JOIN_LINE}\nReply STOP to opt out.`

let sendEmail: Mock<EmailService['sendEmail']>
let isFeatureEnabled: Mock<FeaturesService['isFeatureEnabled']>

const job = () => service.app.get(ManagedPanelWaveJobService)

beforeEach(() => {
  sendEmail = vi
    .fn<EmailService['sendEmail']>()
    .mockResolvedValue({ status: 'queued', id: 'email-1' })
  vi.spyOn(service.app.get(EmailService), 'sendEmail').mockImplementation(
    sendEmail,
  )
  isFeatureEnabled = vi
    .fn<FeaturesService['isFeatureEnabled']>()
    .mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
})

const enroll = async (status: ManagedCivicPanelStatus) => {
  const slug = `eo-managed-ready-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug: slug,
      status,
      inviteMessage: INVITE,
      consentVersion: '2026-10-22',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers: 3,
      readyAt: status === ManagedCivicPanelStatus.ready ? new Date() : null,
    },
  })
}

const readyEmailSentAt = async (id: string) =>
  (await service.prisma.managedCivicPanel.findUniqueOrThrow({ where: { id } }))
    .readyEmailSentAt

describe('the managed panel ready email', () => {
  it('goes to the official once, however many runs see the panel ready', async () => {
    const enrollment = await enroll(ManagedCivicPanelStatus.ready)

    await job().sendReadyEmails()
    await job().sendReadyEmails()
    await job().runWaves()

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: service.user.email,
        subject: 'Your civic panel is ready',
      }),
    )
    expect(await readyEmailSentAt(enrollment.id)).not.toBeNull()
  })

  it('is tried again on the next run when the send fails', async () => {
    const enrollment = await enroll(ManagedCivicPanelStatus.ready)
    sendEmail.mockRejectedValueOnce(new Error('mailgun down'))

    await job().sendReadyEmails()
    expect(await readyEmailSentAt(enrollment.id)).toBeNull()
    await job().sendReadyEmails()

    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(await readyEmailSentAt(enrollment.id)).not.toBeNull()
  })

  it('is not sent for a panel that is not ready, or with the flag off', async () => {
    await enroll(ManagedCivicPanelStatus.exhausted)
    await enroll(ManagedCivicPanelStatus.building)
    const flagged = await enroll(ManagedCivicPanelStatus.ready)
    isFeatureEnabled.mockResolvedValue(false)

    await job().sendReadyEmails()

    expect(sendEmail).not.toHaveBeenCalled()
    expect(await readyEmailSentAt(flagged.id)).toBeNull()
  })

  it('names residents and links the panel page, with nothing personal in the link', () => {
    const words = managedPanelReadyEmail('Dana', 250)

    expect(words).toContain('Hi Dana,')
    expect(words).toContain('250 residents')
    expect(words).toContain(
      'Ask them what they think whenever you want to hear from your whole ' +
        'district.',
    )
    expect(words).toContain('/dashboard/contacts/citizens-panel')
    expect(words).not.toMatch(/voter|campaign/i)
    expect(words).not.toContain('?')
  })
})
