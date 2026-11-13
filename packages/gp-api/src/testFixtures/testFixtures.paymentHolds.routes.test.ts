import { HttpStatus } from '@nestjs/common'
import { addDays, differenceInMinutes, subMinutes } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'
import { useTestService } from '@/test-service'
import {
  StripeOutreachHoldDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true, VENDOR_MODE: 'mock' })

const service = useTestService({ jobs: true })

const TEST_USER_EMAIL = 'qa-00000000-0000-0000-0000-000000000000@goodparty.org'

beforeEach(async () => {
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { email: TEST_USER_EMAIL },
  })
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(
    async () => undefined as never,
  )
})

const seedEmailHold = async (
  state: OutreachHoldState,
  date: Date,
  userId = service.user.id,
) => {
  const slug = `test-campaign-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  const campaign = await service.prisma.campaign.create({
    data: { userId, slug, organizationSlug: slug },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      outreachType: OutreachType.email,
      campaignId: campaign.id,
      organizationSlug: slug,
      status: OutreachStatus.pending,
      date,
    },
  })
  await service.prisma.outreachPaymentHold.create({
    data: {
      outreachId: outreach.id,
      channel: OutreachType.email,
      state,
      stripeCustomerId: 'cus_fixture',
      paymentMethodId: 'pm_fixture',
      estimateCents: 50,
    },
  })
  return outreach.id
}

const readHold = (outreachId: number) =>
  service.client.get(
    `/v1/test-fixtures/vendor-mocks/outreach/${outreachId}/payment-hold`,
    { validateStatus: () => true },
  )

const runJob = (name: string) =>
  service.client.post(
    `/v1/test-fixtures/vendor-mocks/jobs/${name}/run`,
    {},
    { validateStatus: () => true },
  )

describe('the payment hold fixture hooks', () => {
  it('moves an email send inside the hold lead with email.send_in_2_days', async () => {
    const outreachId = await seedEmailHold(
      OutreachHoldState.scheduled,
      addDays(new Date(), 5),
    )

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId, action: 'email.send_in_2_days' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(
      Math.abs(differenceInMinutes(outreach.date!, addDays(new Date(), 2))),
    ).toBeLessThan(1)
  })

  it('places a due hold through its pg-boss schedule with paymentHolds.placement', async () => {
    vi.spyOn(
      service.app.get(StripeService),
      'createOutreachManualCaptureHold',
    ).mockResolvedValue({
      paymentIntentId: 'pi_fixture',
      captureBefore: addDays(new Date(), 6),
    })
    const outreachId = await seedEmailHold(
      OutreachHoldState.scheduled,
      addDays(new Date(), 2),
    )

    expect((await runJob('paymentHolds.placement')).status).toBe(
      HttpStatus.CREATED,
    )
    await service.jobs.settle()

    const res = await readHold(outreachId)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ state: 'held', declineCode: null })
  })

  it('reads a declined placement back as hold_failed with its code', async () => {
    vi.spyOn(
      service.app.get(StripeService),
      'createOutreachManualCaptureHold',
    ).mockRejectedValue(
      new StripeOutreachHoldDeclinedError('declined', 'card_declined'),
    )
    const outreachId = await seedEmailHold(
      OutreachHoldState.scheduled,
      addDays(new Date(), 2),
    )

    await runJob('paymentHolds.placement')
    await service.jobs.settle()

    expect((await readHold(outreachId)).data).toEqual({
      state: 'hold_failed',
      declineCode: 'card_declined',
    })
  })

  it('releases a declined hold at its send time with paymentHolds.unpaid', async () => {
    const outreachId = await seedEmailHold(
      OutreachHoldState.hold_failed,
      subMinutes(new Date(), 1),
    )

    expect((await runJob('paymentHolds.unpaid')).status).toBe(
      HttpStatus.CREATED,
    )
    await service.jobs.settle()

    expect((await readHold(outreachId)).data).toMatchObject({
      state: 'released',
    })
  })

  it('refuses the hold jobs outside vendor-mock mode', async () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    const send = vi.spyOn(service.app.get(JobsService), 'sendScheduleRun')

    for (const job of ['paymentHolds.placement', 'paymentHolds.unpaid']) {
      expect((await runJob(job)).status).toBe(HttpStatus.NOT_FOUND)
    }
    expect(send).not.toHaveBeenCalled()
  })

  describe('GET /v1/test-fixtures/vendor-mocks/outreach/:id/payment-hold', () => {
    it('404s for a send with no hold', async () => {
      const outreachId = await seedEmailHold(
        OutreachHoldState.scheduled,
        addDays(new Date(), 5),
      )
      await service.prisma.outreachPaymentHold.delete({
        where: { outreachId },
      })

      expect((await readHold(outreachId)).status).toBe(HttpStatus.NOT_FOUND)
    })

    it("403s for another user's send", async () => {
      const other = await service.prisma.user.create({
        data: {
          email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
          name: 'Other',
          firstName: 'Other',
          lastName: 'User',
        },
      })
      const outreachId = await seedEmailHold(
        OutreachHoldState.scheduled,
        addDays(new Date(), 5),
        other.id,
      )

      expect((await readHold(outreachId)).status).toBe(HttpStatus.FORBIDDEN)
    })

    it('403s for a user who is not a test user', async () => {
      const outreachId = await seedEmailHold(
        OutreachHoldState.scheduled,
        addDays(new Date(), 5),
      )
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { email: 'nottest@goodparty.org' },
      })

      expect((await readHold(outreachId)).status).toBe(HttpStatus.FORBIDDEN)
    })

    it('404s where vendors are live and outside a non-prod deploy', async () => {
      const outreachId = await seedEmailHold(
        OutreachHoldState.scheduled,
        addDays(new Date(), 5),
      )

      appEnvOverrides.VENDOR_MODE = 'live'
      expect((await readHold(outreachId)).status).toBe(HttpStatus.NOT_FOUND)

      appEnvOverrides.VENDOR_MODE = 'mock'
      appEnvOverrides.IS_NON_PROD_DEPLOY = false
      expect((await readHold(outreachId)).status).toBe(HttpStatus.NOT_FOUND)
    })
  })
})
