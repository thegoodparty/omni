import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallHoldReconcileService } from '@/outreach/services/outreachRobocallHoldReconcile.service'
import { RobocallOrphanedHoldService } from '@/outreach/services/robocallOrphanedHold.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'

const service = useTestService()

let reconcile: OutreachRobocallHoldReconcileService
let orphans: RobocallOrphanedHoldService
let retrieveSpy: ReturnType<typeof vi.spyOn>
let cancelSpy: ReturnType<typeof vi.spyOn>

const piWith = (status: string) =>
  ({ id: 'pi', status }) as unknown as Stripe.Response<Stripe.PaymentIntent>

beforeEach(() => {
  reconcile = service.app.get(OutreachRobocallHoldReconcileService)
  orphans = service.app.get(RobocallOrphanedHoldService)
  retrieveSpy = vi
    .spyOn(service.app.get(StripeService), 'retrievePaymentIntent')
    .mockResolvedValue(piWith('requires_capture'))
  cancelSpy = vi
    .spyOn(service.app.get(StripeService), 'cancelHold')
    .mockResolvedValue(undefined)
})

const readHold = (paymentIntentId: string) =>
  service.prisma.robocallOrphanedHold.findUnique({ where: { paymentIntentId } })

describe('RobocallOrphanedHoldService.record', () => {
  it('upserts idempotently and never un-stamps a voided row', async () => {
    await orphans.record('pi_dup', 1, 'window_fit')
    await orphans.record('pi_dup', 1, 'window_fit')
    const rows = await service.prisma.robocallOrphanedHold.findMany({
      where: { paymentIntentId: 'pi_dup' },
    })
    expect(rows).toHaveLength(1)

    await orphans.markVoided(rows[0]!.id)
    await orphans.record('pi_dup', 1, 'window_fit')
    expect((await readHold('pi_dup'))?.voidedAt).not.toBeNull()
  })
})

describe('OutreachRobocallHoldReconcileService.sweepOrphanedHolds', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('re-voids a still-live hold and stamps it voided', async () => {
    await orphans.record('pi_live', 1, 'lost_commit')
    retrieveSpy.mockResolvedValue(piWith('requires_capture'))

    await reconcile.sweepOrphanedHolds()

    expect(cancelSpy).toHaveBeenCalledWith('pi_live')
    expect((await readHold('pi_live'))?.voidedAt).not.toBeNull()
  })

  it('stamps an already-canceled hold without cancelling again', async () => {
    await orphans.record('pi_gone', 1, 'window_fit')
    retrieveSpy.mockResolvedValue(piWith('canceled'))

    await reconcile.sweepOrphanedHolds()

    expect(cancelSpy).not.toHaveBeenCalled()
    expect((await readHold('pi_gone'))?.voidedAt).not.toBeNull()
  })

  it('never cancels a succeeded (captured) hold', async () => {
    await orphans.record('pi_captured', 1, 'zero_billable')
    retrieveSpy.mockResolvedValue(piWith('succeeded'))

    await reconcile.sweepOrphanedHolds()

    expect(cancelSpy).not.toHaveBeenCalled()
    expect((await readHold('pi_captured'))?.voidedAt).not.toBeNull()
  })

  it('leaves the row unvoided when the PI read fails (retries next sweep)', async () => {
    await orphans.record('pi_readfail', 1, 'window_fit')
    retrieveSpy.mockRejectedValue(new Error('stripe read down'))

    await reconcile.sweepOrphanedHolds()

    expect(cancelSpy).not.toHaveBeenCalled()
    expect((await readHold('pi_readfail'))?.voidedAt).toBeNull()
  })

  it('leaves the row unvoided when the cancel fails (never stamps a still-live hold)', async () => {
    await orphans.record('pi_cancelfail', 1, 'lost_commit')
    retrieveSpy.mockResolvedValue(piWith('requires_capture'))
    cancelSpy.mockRejectedValue(new Error('stripe cancel down'))

    await reconcile.sweepOrphanedHolds()

    expect((await readHold('pi_cancelfail'))?.voidedAt).toBeNull()
  })

  it('skips an already-voided row', async () => {
    await orphans.record('pi_done', 1, 'window_fit')
    const row = await readHold('pi_done')
    await orphans.markVoided(row!.id)

    await reconcile.sweepOrphanedHolds()

    expect(retrieveSpy).not.toHaveBeenCalled()
  })

  it('elects a single stamp under a concurrent double-run', async () => {
    await orphans.record('pi_race', 1, 'lost_commit')

    await Promise.all([
      reconcile.sweepOrphanedHolds(),
      reconcile.sweepOrphanedHolds(),
    ])

    expect((await readHold('pi_race'))?.voidedAt).not.toBeNull()
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    await orphans.record('pi_dev', 1, 'window_fit')

    await reconcile.sweepOrphanedHolds()

    expect(retrieveSpy).not.toHaveBeenCalled()
    expect((await readHold('pi_dev'))?.voidedAt).toBeNull()
  })
})
