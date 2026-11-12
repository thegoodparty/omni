import { setTimeout as sleep } from 'node:timers/promises'
import { ModuleRef } from '@nestjs/core'
import { subMinutes } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { JOBS, SCHEDULES } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { PrismaService } from '@/prisma/prisma.service'
import { useTestService } from '@/test-service'
import {
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
} from '../../generated/prisma'
import {
  createEmailOrgs,
  createHold,
  createSend,
  createSender,
  emails,
} from './emailSendFixtures'

// A deploy stopping an emailDueSweep or emailSettleSweep run part way
// through its sends. The test app runs no workers; a stand-in gp-api task
// does, stopped while the run is in its first send's Stripe call.
const service = useTestService()

const startTask = async (): Promise<JobsService> => {
  const task = new JobsService(
    JOBS,
    SCHEDULES,
    service.app.get(PrismaService),
    service.app.get(ModuleRef),
    await service.app.resolve(PinoLogger),
  )
  vi.stubEnv('TEST_JOBS', 'on')
  try {
    await task.onModuleInit()
    await task.onApplicationBootstrap()
  } finally {
    vi.unstubAllEnvs()
  }
  return task
}

const waitFor = async (check: () => boolean) => {
  const deadline = performance.now() + 15_000
  while (!check()) {
    if (performance.now() > deadline) throw new Error('waitFor timed out')
    await sleep(100)
  }
}

// A call that waits, on its first use only, until the test lets it go.
const holdFirstCall = () => {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  return {
    release,
    calls: () => calls,
    wait: async () => {
      calls++
      if (calls === 1) await released
    },
  }
}

describe('email lifecycle sweeps at shutdown', () => {
  it('the due sweep stops before starting its next send', async () => {
    const orgs = await createEmailOrgs(service.prisma, service.user.id)
    const sender = await createSender(service.prisma, orgs.winSlug)
    const dueSend = async () => {
      const send = await createSend(service.prisma, {
        organizationSlug: orgs.winSlug,
        campaignId: orgs.campaignId,
        senderId: sender.id,
        emails: emails(2),
        status: OutreachStatus.pending,
        date: subMinutes(new Date(), 1),
        recipientCap: 2,
      })
      await createHold(service.prisma, send.outreachId, OutreachHoldState.held)
      return send
    }
    const sends = [await dueSend(), await dueSend()]
    const stripe = holdFirstCall()
    vi.spyOn(
      service.app.get(PaymentHoldsService),
      'getHold',
    ).mockImplementation(async () => {
      await stripe.wait()
      return {
        state: OutreachHoldState.held,
        authorizedCents: 1000,
        captureBefore: null,
      }
    })

    const task = await startTask()
    await task.sendScheduleRun('emailDueSweep')
    await waitFor(() => stripe.calls() === 1)
    const stopping = task.onModuleDestroy()
    stripe.release()
    await stopping

    expect(stripe.calls()).toBe(1)
    const statuses = await service.prisma.outreach.findMany({
      where: { id: { in: sends.map((send) => send.outreachId) } },
      select: { status: true },
    })
    expect(statuses.map(({ status }) => status).sort()).toEqual([
      OutreachStatus.in_progress,
      OutreachStatus.pending,
    ])
  })

  it('the settle sweep stops before settling its next send', async () => {
    const orgs = await createEmailOrgs(service.prisma, service.user.id)
    const sender = await createSender(service.prisma, orgs.winSlug)
    for (let i = 0; i < 2; i++) {
      const send = await createSend(service.prisma, {
        organizationSlug: orgs.winSlug,
        campaignId: orgs.campaignId,
        senderId: sender.id,
        emails: emails(2),
        status: OutreachStatus.in_progress,
        recipientCap: 2,
        prepared: true,
      })
      // Sent just now, so after settling the send waits on SES's numbers
      // instead of closing out.
      await service.prisma.outreachEmailRecipient.updateMany({
        where: { outreachEmailId: send.outreachEmailId },
        data: { status: OutreachEmailRecipientStatus.sent, sentAt: new Date() },
      })
      await createHold(service.prisma, send.outreachId, OutreachHoldState.held)
    }
    const stripe = holdFirstCall()
    vi.spyOn(service.app.get(PaymentHoldsService), 'settle').mockImplementation(
      async ({ outreachId }) => {
        await stripe.wait()
        await service.prisma.outreachPaymentHold.update({
          where: { outreachId },
          data: { state: OutreachHoldState.captured, capturedCents: 50 },
        })
      },
    )

    const task = await startTask()
    await task.sendScheduleRun('emailSettleSweep')
    await waitFor(() => stripe.calls() === 1)
    const stopping = task.onModuleDestroy()
    stripe.release()
    await stopping

    expect(stripe.calls()).toBe(1)
  })
})
