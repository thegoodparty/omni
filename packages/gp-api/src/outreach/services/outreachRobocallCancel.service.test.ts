import { randomUUID } from 'node:crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { addHours } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallCancelService } from '@/outreach/services/outreachRobocallCancel.service'
import { OutreachRobocallPromoService } from '@/outreach/services/outreachRobocallPromo.service'
import { RobocallOrphanedHoldService } from '@/outreach/services/robocallOrphanedHold.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import {
  Campaign,
  OutreachStatus,
  RobocallSettleState,
} from '../../generated/prisma'

const service = useTestService()

let cancel: OutreachRobocallCancelService
let voidSpy: ReturnType<typeof vi.spyOn>
let restoreSpy: ReturnType<typeof vi.spyOn>
let recordSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

beforeEach(async () => {
  cancel = service.app.get(OutreachRobocallCancelService)

  voidSpy = vi
    .spyOn(service.app.get(StripeService), 'voidHold')
    .mockResolvedValue(undefined)
  restoreSpy = vi
    .spyOn(service.app.get(OutreachRobocallPromoService), 'restore')
    .mockResolvedValue(undefined)
  recordSpy = vi
    .spyOn(service.app.get(RobocallOrphanedHoldService), 'record')
    .mockResolvedValue(undefined)

  const campaignId = 997
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'cancel-me',
      isPro: true,
      details: {},
      data: {},
      aiContent: {},
    },
  })
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug },
  })
  filterId = filter.id
})

const createRobocall = async ({
  settleState,
  spineStatus,
  authorizationIntentId = null as string | null,
  callhubCampaignPkStr = null as string | null,
  campaignId = campaign.id,
}: {
  settleState: RobocallSettleState
  spineStatus: OutreachStatus
  authorizationIntentId?: string | null
  callhubCampaignPkStr?: string | null
  campaignId?: number
}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug: `campaign-${campaignId}`,
      outreachType: 'robocall',
      status: spineStatus,
      date: addHours(new Date(), 72),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/997/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 5000,
      settleState,
      authorizationIntentId,
      callhubCampaignPkStr,
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findFirstOrThrow({ where: { outreachId } })
const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

describe('OutreachRobocallCancelService.cancel', () => {
  it('cancels a pending_payment draft with no hold', async () => {
    const outreachId = await createRobocall({
      settleState: RobocallSettleState.pending_payment,
      spineStatus: OutreachStatus.pending_payment,
    })

    const { outreach, refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(false)
    expect(outreach.status).toBe(OutreachStatus.canceled)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.cancelled,
    )
    expect(voidSpy).not.toHaveBeenCalled()
    expect(restoreSpy).toHaveBeenCalledWith(outreachId)
  })

  it('voids the hold and records it when an authorized run is canceled', async () => {
    const outreachId = await createRobocall({
      settleState: RobocallSettleState.authorized,
      spineStatus: OutreachStatus.pending,
      authorizationIntentId: 'pi_cancel_1',
    })

    await cancel.cancel(outreachId, campaign.id)

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.cancelled,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
    expect(voidSpy).toHaveBeenCalledWith('pi_cancel_1')
    expect(recordSpy).toHaveBeenCalledWith(
      'pi_cancel_1',
      outreachId,
      'cancel_before_send',
    )
    expect(restoreSpy).toHaveBeenCalledWith(outreachId)
  })

  it('refuses a run that has already dialed and leaves it untouched', async () => {
    const outreachId = await createRobocall({
      settleState: RobocallSettleState.dialed,
      spineStatus: OutreachStatus.in_progress,
      authorizationIntentId: 'pi_dialed',
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
    expect(voidSpy).not.toHaveBeenCalled()
  })

  it('refuses a hold_pending run and leaves it for the recovery sweep', async () => {
    // A crashed authorize can strand a row in hold_pending with a live Stripe
    // hold whose intent id was never persisted. Cancelling it would hide the row
    // from the stale-hold recovery sweep (which scans only hold_pending),
    // stranding the hold. The cancel must refuse it, untouched.
    const outreachId = await createRobocall({
      settleState: RobocallSettleState.hold_pending,
      spineStatus: OutreachStatus.pending_payment,
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.hold_pending,
    )
    expect((await readSpine(outreachId)).status).toBe(
      OutreachStatus.pending_payment,
    )
    expect(voidSpy).not.toHaveBeenCalled()
    expect(restoreSpy).not.toHaveBeenCalled()
  })

  it('is idempotent on an already-cancelled run', async () => {
    const outreachId = await createRobocall({
      settleState: RobocallSettleState.cancelled,
      spineStatus: OutreachStatus.canceled,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(false)
    expect(voidSpy).not.toHaveBeenCalled()
    expect(restoreSpy).not.toHaveBeenCalled()
  })

  it('404s a robocall belonging to another campaign', async () => {
    const otherId = 996
    await service.prisma.organization.create({
      data: { slug: `campaign-${otherId}`, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        id: otherId,
        organizationSlug: `campaign-${otherId}`,
        userId: service.user.id,
        slug: 'someone-else',
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const outreachId = await createRobocall({
      settleState: RobocallSettleState.authorized,
      spineStatus: OutreachStatus.pending,
      campaignId: otherId,
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('unwinds once under a concurrent double-cancel', async () => {
    const outreachId = await createRobocall({
      settleState: RobocallSettleState.authorized,
      spineStatus: OutreachStatus.pending,
      authorizationIntentId: 'pi_race',
    })

    const [a, b] = await Promise.allSettled([
      cancel.cancel(outreachId, campaign.id),
      cancel.cancel(outreachId, campaign.id),
    ])

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(2)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.cancelled,
    )
    // The claim CAS elects one owner, so the money unwind runs exactly once.
    expect(voidSpy).toHaveBeenCalledTimes(1)
  })
})
