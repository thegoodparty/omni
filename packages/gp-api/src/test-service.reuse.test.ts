import { describe, expect, it } from 'vitest'
import { BriefingArtifactCacheService } from './chats/briefing-chats/services/briefingArtifactCache.service'
import { RobocallFreeOfferService } from './robocallFreeOffer/services/robocallFreeOffer.service'
import { useTestService } from './test-service'

// Each describe stands in for one test file: in the shared-modules project the
// second one reuses the app and database the first one left behind, which is
// exactly what the next file in a worker sees.
let firstApp: unknown
let bootCouponId: unknown

describe('a file that leaves state behind', () => {
  const service = useTestService()

  it('mutates singletons and advances sequences', async () => {
    firstApp = service.app
    const offer = service.app.get(RobocallFreeOfferService)
    bootCouponId = Reflect.get(offer, 'couponId')
    Object.assign(offer, { couponId: 'leaked-coupon' })
    Reflect.set(offer, 'addedByTest', true)

    const cache = service.app.get(BriefingArtifactCacheService)
    Reflect.get(cache, 'cache').set('leaked/key', { body: 'x', expiresAt: 0 })

    await service.prisma.user.create({ data: { email: 'a@example.com' } })
    await service.prisma.user.create({ data: { email: 'b@example.com' } })
  })
})

describe('the next file in the same worker', () => {
  const service = useTestService()

  it('reuses the app but starts from its post-boot state', async () => {
    expect(service.app).toBe(firstApp)

    const offer = service.app.get(RobocallFreeOfferService)
    expect(Reflect.get(offer, 'couponId')).toBe(bootCouponId)
    expect(Reflect.has(offer, 'addedByTest')).toBe(false)

    const cache = service.app.get(BriefingArtifactCacheService)
    expect(Reflect.get(cache, 'cache').has('leaked/key')).toBe(false)

    const user = await service.prisma.user.create({
      data: { email: 'c@example.com' },
    })
    expect(user.id).toBe(1)

    const me = await service.client.get('/v1/users/me')
    expect(me.status).toBe(200)
    expect(me.data.id).toBe(123)
  })
})
