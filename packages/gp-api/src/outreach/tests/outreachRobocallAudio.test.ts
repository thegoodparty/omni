import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { Campaign } from '../../generated/prisma'

const service = useTestService()

let campaign: Campaign
let orgSlug: string

const mockUpload = () =>
  vi
    .spyOn(service.app.get(S3Service), 'createPresignedUpload')
    .mockResolvedValue({
      url: 'https://s3.example/robocall-audio-test',
      fields: { key: 'stub', 'Content-Type': 'stub', Policy: 'stub' },
    })

beforeEach(async () => {
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
      slug: 'jane-doe',
      isPro: true,
      details: { state: 'TX', city: 'Georgetown', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
})

const orgHeaders = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const postPresign = (body: object, slug = orgSlug) =>
  service.client.post(
    '/v1/outreach/robocall/audio/presign',
    body,
    orgHeaders(slug),
  )

describe('POST /v1/outreach/robocall/audio/presign', () => {
  it('returns a presigned POST, a campaign-scoped key, and the expiry', async () => {
    const spy = mockUpload()

    const res = await postPresign({ contentType: 'audio/webm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.url).toBe('https://s3.example/robocall-audio-test')
    expect(res.data.fields).toMatchObject({ 'Content-Type': 'stub' })
    expect(res.data.expiresIn).toBeGreaterThan(0)
    expect(res.data.key).toMatch(
      new RegExp(`^robocall/${campaign.id}/[0-9a-f-]+\\.webm$`),
    )

    // The presign is bound to our bucket, the returned key, the requested
    // content type, and a byte cap S3 enforces on upload.
    const call = spy.mock.calls[0]
    expect(call?.[0]).toBe('robocall-audio-test')
    expect(call?.[1]).toBe(res.data.key)
    expect(call?.[2]).toMatchObject({ contentType: 'audio/webm' })
    expect(call?.[2]?.maxBytes).toBeGreaterThan(0)
  })

  it('maps the mp3 content type to an .mp3 key extension', async () => {
    mockUpload()

    const res = await postPresign({ contentType: 'audio/mpeg' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.key.endsWith('.mp3')).toBe(true)
  })

  it('rejects a non-audio content type', async () => {
    const spy = mockUpload()

    const res = await postPresign({ contentType: 'image/png' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects a non-pro campaign', async () => {
    const spy = mockUpload()

    const freeSlug = 'campaign-996'
    await service.prisma.organization.create({
      data: { slug: freeSlug, ownerId: service.user.id, positionId: 'pos-2' },
    })
    await service.prisma.campaign.create({
      data: {
        id: 996,
        organizationSlug: freeSlug,
        userId: service.user.id,
        slug: 'free-cand',
        isPro: false,
        details: {},
        data: {},
        aiContent: {},
      },
    })

    const res = await postPresign({ contentType: 'audio/webm' }, freeSlug)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(spy).not.toHaveBeenCalled()
  })
})
