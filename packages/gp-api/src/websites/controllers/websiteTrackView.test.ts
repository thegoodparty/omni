import { HttpStatus } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { WebsiteStatus } from '../../generated/prisma'

const service = useTestService()

const PUBLISHED_PATH = 'jordan-for-council'
const DRAFT_PATH = 'jordan-draft'
const route = (vanityPath: string) => `/v1/websites/${vanityPath}/track-view`

// `trustProxy` is on, so an X-Forwarded-For header is what the rate-limit
// guard keys on. Each test uses its own address so one test's spend cannot
// exhaust another's budget.
const from = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } })

const countViews = () => service.prisma.websiteView.count()

describe('POST /v1/websites/:vanityPath/track-view', () => {
  beforeEach(async () => {
    await service.prisma.organization.create({
      data: { slug: 'org-track-view', ownerId: service.user.id },
    })
    await service.prisma.organization.create({
      data: { slug: 'org-track-view-draft', ownerId: service.user.id },
    })
    await service.prisma.campaign.createMany({
      data: [
        {
          id: 1,
          organizationSlug: 'org-track-view',
          userId: service.user.id,
          slug: 'jordan-smith',
          isActive: true,
        },
        {
          id: 2,
          organizationSlug: 'org-track-view-draft',
          userId: service.user.id,
          slug: 'jordan-smith-draft',
          isActive: true,
        },
      ],
    })
    await service.prisma.website.createMany({
      data: [
        {
          campaignId: 1,
          vanityPath: PUBLISHED_PATH,
          status: WebsiteStatus.published,
          content: {},
        },
        {
          campaignId: 2,
          vanityPath: DRAFT_PATH,
          status: WebsiteStatus.unpublished,
          content: {},
        },
      ],
    })
  })

  it('records a view for a published site', async () => {
    const result = await service.client.post(
      route(PUBLISHED_PATH),
      { visitorId: randomUUID() },
      from('10.2.0.1'),
    )

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(await countViews()).toBe(1)
  })

  it('rejects a visitorId that is not a UUID without writing', async () => {
    const result = await service.client.post(
      route(PUBLISHED_PATH),
      { visitorId: 'visitor-1' },
      from('10.2.0.2'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await countViews()).toBe(0)
  })

  it('records no view for a draft site', async () => {
    const result = await service.client.post(
      route(DRAFT_PATH),
      { visitorId: randomUUID() },
      from('10.2.0.3'),
    )

    expect(result.status).toBe(HttpStatus.FORBIDDEN)
    expect(await countViews()).toBe(0)
  })

  it('refuses the 61st view from one address, each with a fresh visitorId', async () => {
    for (let i = 0; i < 60; i++) {
      const allowed = await service.client.post(
        route(PUBLISHED_PATH),
        { visitorId: randomUUID() },
        from('10.2.0.4'),
      )
      expect(allowed.status).toBe(HttpStatus.CREATED)
    }
    expect(await countViews()).toBe(60)

    const refused = await service.client.post(
      route(PUBLISHED_PATH),
      { visitorId: randomUUID() },
      from('10.2.0.4'),
    )

    expect(refused.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(await countViews()).toBe(60)
  })
})
