import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import {
  Outreach,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
} from '../../generated/prisma'

const service = useTestService()

let eoOrgSlug: string
let outreach: Outreach

const PERSON_1 = '11111111-1111-4111-8111-111111111111'
const PERSON_2 = '22222222-2222-4222-8222-222222222222'

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  eoOrgSlug = `eo-${suffix}`

  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: eoOrgSlug },
  })

  outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: eoOrgSlug,
      outreachType: OutreachType.text,
      status: OutreachStatus.completed,
      name: 'Library hours',
      textCount: 400,
    },
  })
})

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const getResults = (id: number) =>
  service.client.get(`/v1/outreach/serve/${id}/results`, eoHeaders())

const getReplies = (id: number, query = '') =>
  service.client.get(`/v1/outreach/serve/${id}/replies${query}`, eoHeaders())

describe('GET /v1/outreach/serve/:id/results', () => {
  it('counts contacts, responders and opt-outs for the elected official', async () => {
    await service.prisma.contactInteractionText.createMany({
      data: [
        {
          organizationSlug: eoOrgSlug,
          personId: PERSON_1,
          outreachId: outreach.id,
          occurredAt: new Date(),
          respondedAt: new Date(),
        },
        {
          organizationSlug: eoOrgSlug,
          personId: PERSON_2,
          outreachId: outreach.id,
          occurredAt: new Date(),
          optedOutAt: new Date(),
        },
        {
          organizationSlug: eoOrgSlug,
          personId: '33333333-3333-4333-8333-333333333333',
          outreachId: outreach.id,
          occurredAt: new Date(),
        },
      ],
    })

    const res = await getResults(outreach.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ contacts: 3, responded: 1, optedOut: 1 })
  })

  it('falls back to the purchase-time count before any recipient rows exist', async () => {
    const res = await getResults(outreach.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ contacts: 400, responded: 0, optedOut: 0 })
  })

  it('404s a row that belongs to a different organization', async () => {
    const otherSlug = `eo-other-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: otherSlug },
    })
    const other = await service.prisma.outreach.create({
      data: {
        organizationSlug: otherSlug,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
        name: 'Somebody else',
      },
    })

    const res = await getResults(other.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/outreach/serve/:id/replies', () => {
  const seedReply = (personId: string, content: string, sentAt: string) =>
    service.prisma.pollIndividualMessage.create({
      data: {
        id: `${personId}-${sentAt}`,
        personId,
        personCellPhone: '+13035550101',
        sentAt: new Date(sentAt),
        content,
        isOptOut: false,
        sender: PollIndividualMessageSender.CONSTITUENT,
        outreachId: outreach.id,
      },
    })

  it('returns the replies newest first with the send total', async () => {
    await seedReply(PERSON_1, 'Sunday hours would help', '2026-09-01T12:00:00Z')
    await seedReply(PERSON_2, 'Thanks for the update', '2026-09-03T12:00:00Z')

    const res = await getReplies(outreach.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.total).toBe(2)
    expect(
      res.data.replies.map((reply: { content: string }) => reply.content),
    ).toEqual(['Thanks for the update', 'Sunday hours would help'])
  })

  it('honors limit and offset', async () => {
    await seedReply(PERSON_1, 'First', '2026-09-01T12:00:00Z')
    await seedReply(PERSON_2, 'Second', '2026-09-03T12:00:00Z')

    const res = await getReplies(outreach.id, '?limit=1&offset=1')

    expect(res.data.total).toBe(2)
    expect(res.data.replies).toHaveLength(1)
    expect(res.data.replies[0].content).toBe('First')
  })

  it('404s a row that belongs to a different organization', async () => {
    const otherSlug = `eo-other-replies-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: otherSlug },
    })
    const other = await service.prisma.outreach.create({
      data: {
        organizationSlug: otherSlug,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
        name: 'Somebody else',
      },
    })

    const res = await getReplies(other.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
