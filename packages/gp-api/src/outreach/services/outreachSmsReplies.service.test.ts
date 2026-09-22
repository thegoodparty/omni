import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { useTestService } from '@/test-service'
import {
  Outreach,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
} from '../../generated/prisma'
import { OutreachSmsRepliesService } from './outreachSmsReplies.service'

const service = useTestService()

const ORG_SLUG = 'eo-replies-test'
const WIN_ORG_SLUG = 'campaign-replies-test'

// Real guids: people-api's id filter is a guid column, and the service drops
// anything that is not one before it builds the lookup.
const PERSON_1 = '11111111-1111-4111-8111-111111111111'
const PERSON_2 = '22222222-2222-4222-8222-222222222222'

const resolveEligibleDistrictId = vi.fn()
const findPeople = vi.fn()

let replies: OutreachSmsRepliesService
let outreach: Outreach

const seedReply = (
  personId: string,
  content: string,
  sentAt: Date,
  overrides: { isOptOut?: boolean; sender?: PollIndividualMessageSender } = {},
) =>
  service.prisma.pollIndividualMessage.create({
    data: {
      id: `${personId}-${sentAt.toISOString()}`,
      personId,
      personCellPhone: '+13035550101',
      sentAt,
      content,
      isOptOut: overrides.isOptOut ?? false,
      sender: overrides.sender ?? PollIndividualMessageSender.CONSTITUENT,
      outreachId: outreach.id,
    },
  })

beforeEach(async () => {
  resolveEligibleDistrictId
    .mockReset()
    .mockResolvedValue('33333333-3333-4333-8333-333333333333')
  findPeople.mockReset().mockResolvedValue({
    people: [
      {
        id: PERSON_1,
        firstName: 'Dana',
        lastName: 'Whitfield',
        state: 'CO',
        address: { city: 'Northside', state: 'CO' },
      },
      {
        id: PERSON_2,
        firstName: 'Marcus',
        lastName: 'Ortiz',
        state: 'CO',
        address: { city: 'Northside', state: 'CO' },
      },
    ],
  })

  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: ORG_SLUG, userId: service.user.id },
  })

  outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.text,
      status: OutreachStatus.completed,
      name: 'Library hours',
      date: new Date(),
    },
  })

  const module = await Test.createTestingModule({
    providers: [
      OutreachSmsRepliesService,
      { provide: PrismaService, useValue: service.prisma },
      {
        provide: ContactsService,
        useValue: { resolveEligibleDistrictId },
      },
      { provide: VoterQueryService, useValue: { findPeople } },
      { provide: PinoLogger, useValue: createMockLogger() },
    ],
  }).compile()
  await module.init()
  replies = module.get(OutreachSmsRepliesService)
})

const serveScope = { organizationSlug: ORG_SLUG, campaignId: null } as const
const page = { limit: 10, offset: 0 }

describe('OutreachSmsRepliesService.listReplies', () => {
  it('returns inbound replies newest first, named from the People DB', async () => {
    await seedReply(
      PERSON_1,
      'The library hours help a lot',
      new Date('2026-09-01T12:00:00Z'),
    )
    await seedReply(
      PERSON_2,
      'Can we get Sunday hours too?',
      new Date('2026-09-03T12:00:00Z'),
    )

    const result = await replies.listReplies(outreach.id, serveScope, page)

    expect(result.total).toBe(2)
    expect(result.replies.map((reply) => reply.firstName)).toEqual([
      'Marcus',
      'Dana',
    ])
    expect(result.replies[0]).toMatchObject({
      personId: PERSON_2,
      content: 'Can we get Sunday hours too?',
      city: 'Northside',
      state: 'CO',
      phone: '+13035550101',
      isOptOut: false,
    })
    // One people-api read for the whole page, not one per reply.
    expect(findPeople).toHaveBeenCalledTimes(1)
  })

  it('never returns the outbound blast, only what constituents said', async () => {
    await seedReply(PERSON_1, 'Inbound', new Date('2026-09-01T12:00:00Z'))
    await seedReply(
      PERSON_2,
      'The blast itself',
      new Date('2026-09-02T12:00:00Z'),
      {
        sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
      },
    )

    const result = await replies.listReplies(outreach.id, serveScope, page)

    expect(result.total).toBe(1)
    expect(result.replies[0]).toMatchObject({ content: 'Inbound' })
  })

  it('counts the whole send but returns only the requested page', async () => {
    await seedReply(PERSON_1, 'First', new Date('2026-09-01T12:00:00Z'))
    await seedReply(PERSON_2, 'Second', new Date('2026-09-02T12:00:00Z'))

    const result = await replies.listReplies(outreach.id, serveScope, {
      limit: 1,
      offset: 0,
    })

    // total names every reply so "Show all {n} responses" can name a number
    // it has not fetched.
    expect(result.total).toBe(2)
    expect(result.replies).toHaveLength(1)
  })

  it('still lists replies when the People DB read fails', async () => {
    findPeople.mockRejectedValue(new Error('people-api down'))
    await seedReply(
      PERSON_1,
      'Still readable',
      new Date('2026-09-01T12:00:00Z'),
    )

    const result = await replies.listReplies(outreach.id, serveScope, page)

    expect(result.replies).toHaveLength(1)
    expect(result.replies[0]).toMatchObject({
      content: 'Still readable',
      firstName: null,
    })
  })

  it('404s a row belonging to another organization', async () => {
    await expect(
      replies.listReplies(
        outreach.id,
        { organizationSlug: 'eo-somebody-else', campaignId: null },
        page,
      ),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('404s a Win row read through the Serve scope, slug match or not', async () => {
    // The ENG-10976 shape: a Win row carries an organizationSlug too, so the
    // Serve scope has to pin campaignId: null or it would match.
    await service.prisma.organization.create({
      data: {
        slug: WIN_ORG_SLUG,
        ownerId: service.user.id,
        positionId: 'pos-2',
      },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: WIN_ORG_SLUG,
        userId: service.user.id,
        slug: 'win-replies-test',
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const winRow = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: WIN_ORG_SLUG,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.completed,
        name: 'Win blast',
      },
    })

    await expect(
      replies.listReplies(
        winRow.id,
        { organizationSlug: WIN_ORG_SLUG, campaignId: null },
        page,
      ),
    ).rejects.toBeInstanceOf(NotFoundException)

    await expect(
      replies.listReplies(winRow.id, { campaignId: campaign.id }, page),
    ).resolves.toMatchObject({ total: 0 })
  })

  it('rejects a channel that has no replies to read', async () => {
    const social = await service.prisma.outreach.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
        name: 'Town hall post',
      },
    })

    await expect(
      replies.listReplies(social.id, serveScope, page),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
