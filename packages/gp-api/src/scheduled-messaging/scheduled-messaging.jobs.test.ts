import { addHours, subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailService } from '@/email/email.service'
import { ScheduledMessageTypes } from '@/email/email.types'
import { useTestService } from '@/test-service'

const service = useTestService({ jobs: true })

const message = {
  to: 'candidate@example.com',
  subject: 'Reminder',
  message: 'Your filing deadline is tomorrow',
}

describe('scheduledMessagesSend schedule', () => {
  let campaignId: number
  let sendEmail: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    sendEmail = vi
      .spyOn(service.app.get(EmailService), 'sendEmail')
      .mockResolvedValue({ status: 'sent', id: 'email-1' })
    await service.prisma.organization.create({
      data: { slug: 'scheduled-messaging', ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        slug: 'scheduled-messaging',
        organizationSlug: 'scheduled-messaging',
        userId: service.user.id,
        details: {},
      },
    })
    campaignId = campaign.id
  })

  afterEach(() => vi.restoreAllMocks())

  const seedMessage = (scheduledAt: Date) =>
    service.prisma.scheduledMessage.create({
      data: {
        campaignId,
        scheduledAt,
        messageConfig: { type: ScheduledMessageTypes.EMAIL, message },
      },
    })

  it('sends due messages once and leaves future ones', async () => {
    const due = await seedMessage(subMinutes(new Date(), 5))
    const future = await seedMessage(addHours(new Date(), 2))

    await service.jobs.runSchedule('scheduledMessagesSend')
    await service.jobs.runSchedule('scheduledMessagesSend')

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(message)
    const sent = await service.prisma.scheduledMessage.findUniqueOrThrow({
      where: { id: due.id },
    })
    expect(sent.sentAt).not.toBeNull()
    expect(sent.processing).toBe(false)
    const pending = await service.prisma.scheduledMessage.findUniqueOrThrow({
      where: { id: future.id },
    })
    expect(pending.sentAt).toBeNull()
  })
})
