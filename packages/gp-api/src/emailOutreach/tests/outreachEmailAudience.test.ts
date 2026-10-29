import { addMinutes, subMinutes } from 'date-fns'
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest'
import {
  MAX_RESULTS_PER_PAGE,
  type PeopleListResponse,
  type Person,
} from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { useTestService } from '@/test-service'
import {
  OutreachHoldState,
  OutreachStatus,
  Prisma,
} from '../../generated/prisma'
import { EmailDomainCheckService } from '../services/emailDomainCheck.service'
import { OutreachEmailAudienceService } from '../services/outreachEmailAudience.service'
import { OutreachEmailPrepareService } from '../services/outreachEmailPrepare.service'
import { SesService } from '../services/ses.service'
import {
  createEmailOrgs,
  createHold,
  createSend,
  createSender,
  EmailFixtureOrgs,
} from './emailSendFixtures'

const service = useTestService()

let orgs: EmailFixtureOrgs
let sendMessage: MockInstance<QueueProducerService['sendMessage']>

beforeEach(async () => {
  orgs = await createEmailOrgs(service.prisma, service.user.id)
  vi.spyOn(service.app.get(SesService), 'ensureTenant').mockResolvedValue()
  vi.spyOn(service.app.get(SesService), 'createTemplate').mockResolvedValue()
  vi.spyOn(
    service.app.get(EmailDomainCheckService),
    'findUndeliverableDomains',
  ).mockResolvedValue(new Set<string>())
  sendMessage = vi
    .spyOn(service.app.get(QueueProducerService), 'sendMessage')
    .mockResolvedValue(undefined)
})

const personId = (index: number) => `p${String(index).padStart(7, '0')}`

const makePerson = (id: string, email: string | null): Person => ({
  id,
  lalVoterId: null,
  firstName: 'Pat',
  middleName: null,
  lastName: 'Lee',
  nameSuffix: null,
  age: null,
  state: 'TX',
  address: {
    line1: null,
    line2: null,
    city: null,
    state: null,
    zip: null,
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: null,
  landline: null,
  email,
  isNewContact: false,
  gender: null,
  registeredVoter: 'Yes',
  estimatedIncomeAmount: null,
  voterStatus: null,
  earlyVoteStatus: null,
  maritalStatus: null,
  hasChildrenUnder18: null,
  veteranStatus: null,
  homeowner: null,
  businessOwner: null,
  levelOfEducation: null,
  ethnicityGroup: null,
  language: 'English',
})

const page = (people: Person[]): PeopleListResponse => ({
  people,
  pagination: {
    totalResults: 0,
    currentPage: 1,
    pageSize: people.length,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

// The people DB for a list of `size` people with email addresses, served a
// page at a time in id order after the requested cursor. Only the page
// asked for is ever built.
const stubAudience = (
  size: number,
  emailFor: (index: number) => string | null = (i) => `person${i}@example.com`,
) => {
  const pages: { afterId: string | undefined; length: number }[] = []
  const spy = vi
    .spyOn(service.app.get(ContactsService), 'findContactsForFilter')
    .mockImplementation(async (_filter, pagination) => {
      const start =
        pagination.afterId === undefined
          ? 0
          : Number(pagination.afterId.slice(1)) + 1
      const end = Math.min(start + pagination.resultsPerPage, size)
      const people = Array.from({ length: Math.max(end - start, 0) }, (_, k) =>
        makePerson(personId(start + k), emailFor(start + k)),
      )
      pages.push({ afterId: pagination.afterId, length: people.length })
      return page(people)
    })
  return { spy, pages }
}

const pendingSend = async ({
  recipientCap,
  organizationSlug = orgs.winSlug,
  campaignId = orgs.campaignId as number | null,
  warmingStep = 0,
}: {
  recipientCap: number
  organizationSlug?: string
  campaignId?: number | null
  warmingStep?: number
}) => {
  const sender = await createSender(service.prisma, organizationSlug, {
    warmingStep,
  })
  const send = await createSend(service.prisma, {
    organizationSlug,
    campaignId,
    senderId: sender.id,
    emails: [],
    status: OutreachStatus.in_progress,
    recipientCap,
    audienceResolved: false,
  })
  await createHold(service.prisma, send.outreachId, OutreachHoldState.held)
  return { sender, ...send }
}

const recipientsOf = (outreachEmailId: number) =>
  service.prisma.outreachEmailRecipient.findMany({
    where: { outreachEmailId },
    orderBy: { id: Prisma.SortOrder.asc },
    select: { email: true },
  })

const prepare = (outreachEmailId: number) =>
  service.app.get(OutreachEmailPrepareService).prepare(outreachEmailId)

describe('prepare resolves the audience', () => {
  it('reads only the pages the cap needs from a very large list', async () => {
    const { spy, pages } = stubAudience(300_000)
    const { outreachEmailId } = await pendingSend({ recipientCap: 1000 })

    await prepare(outreachEmailId)

    expect(pages).toEqual([
      { afterId: undefined, length: MAX_RESULTS_PER_PAGE },
    ])
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ hasEmail: true }),
      {
        resultsPerPage: MAX_RESULTS_PER_PAGE,
        page: 1,
        skipCount: true,
      },
      expect.objectContaining({ slug: orgs.winSlug }),
      undefined,
      expect.anything(),
    )
    const kept = await recipientsOf(outreachEmailId)
    expect(kept).toHaveLength(1000)
    expect(kept[0]?.email).toBe('person0@example.com')
    const row = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(row.audienceResolvedAt).not.toBeNull()
    expect(row.preparedAt).not.toBeNull()
  })

  it('pages by cursor across deliveries until the cap is reached', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = new Date()
    vi.setSystemTime(start)
    const { pages } = stubAudience(25_000)
    vi.spyOn(
      service.app.get(ContactsService),
      'findContactsForFilter',
    ).mockImplementationOnce(async (_filter, pagination) => {
      // The first page takes this delivery past its time budget.
      vi.setSystemTime(addMinutes(start, 3))
      pages.push({ afterId: pagination.afterId, length: 10_000 })
      return page(
        Array.from({ length: 10_000 }, (_, i) =>
          makePerson(personId(i), `person${i}@example.com`),
        ),
      )
    })
    const { outreachEmailId } = await pendingSend({
      recipientCap: 25_000,
      warmingStep: 2,
    })

    await prepare(outreachEmailId)

    let row = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(row.audienceCursor).toBe(personId(9_999))
    expect(row.preparedAt).toBeNull()
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: QueueType.EMAIL_SEND_PREPARE,
        data: { outreachEmailId },
      },
      expect.any(String),
      expect.objectContaining({
        throwOnError: true,
        deduplicationId: expect.stringContaining(personId(9_999)),
      }),
    )

    await prepare(outreachEmailId)

    expect(pages.map((p) => p.afterId)).toEqual([
      undefined,
      personId(9_999),
      personId(19_999),
    ])
    expect(Math.max(...pages.map((p) => p.length))).toBe(MAX_RESULTS_PER_PAGE)
    row = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(row.preparedAt).not.toBeNull()
    expect(await recipientsOf(outreachEmailId)).toHaveLength(25_000)
  })

  it('dedupes, skips unsubscribes and people with no email, never-emailed first', async () => {
    const audience = [
      'A@Example.com',
      'a@example.com',
      null,
      'gone@example.com',
      'old@example.com',
      'recent@example.com',
      'new1@example.com',
      'new2@example.com',
    ]
    stubAudience(audience.length, (i) => audience[i] ?? null)
    const { sender, outreachEmailId } = await pendingSend({ recipientCap: 4 })
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'gone@example.com',
        organizationSlug: orgs.winSlug,
        reason: 'link',
      },
    })
    const earlier = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: ['old@example.com', 'recent@example.com'],
      status: OutreachStatus.completed,
    })
    for (const [email, minutes] of [
      ['old@example.com', 600],
      ['recent@example.com', 10],
    ] as const) {
      await service.prisma.outreachEmailRecipient.updateMany({
        where: { outreachEmailId: earlier.outreachEmailId, email },
        data: { status: 'sent', sentAt: subMinutes(new Date(), minutes) },
      })
    }

    await prepare(outreachEmailId)

    expect((await recipientsOf(outreachEmailId)).map((r) => r.email)).toEqual([
      'a@example.com',
      'old@example.com',
      'new1@example.com',
      'new2@example.com',
    ])
  })

  it('honors the campaign’s unsubscribes on an office send', async () => {
    const { spy } = stubAudience(3)
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'person1@example.com',
        organizationSlug: orgs.winSlug,
        reason: 'link',
      },
    })
    const { outreachEmailId } = await pendingSend({
      recipientCap: 3,
      organizationSlug: orgs.officeSlug,
      campaignId: null,
    })

    await prepare(outreachEmailId)

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ hasEmail: true }),
      expect.anything(),
      expect.objectContaining({ slug: orgs.officeSlug }),
      undefined,
      expect.anything(),
    )
    expect((await recipientsOf(outreachEmailId)).map((r) => r.email)).toEqual([
      'person0@example.com',
      'person2@example.com',
    ])
  })

  it('writes nobody twice when a delivery repeats a page', async () => {
    stubAudience(5)
    const { outreachEmailId } = await pendingSend({ recipientCap: 5 })
    await service.prisma.outreachEmailRecipient.create({
      data: {
        outreachEmailId,
        senderId: (
          await service.prisma.outreachEmail.findUniqueOrThrow({
            where: { id: outreachEmailId },
          })
        ).senderId,
        email: 'person2@example.com',
      },
    })

    await prepare(outreachEmailId)

    expect(await recipientsOf(outreachEmailId)).toHaveLength(5)
  })

  it('sends to nobody when the list was deleted after confirm', async () => {
    const { spy } = stubAudience(5)
    const { outreachId, outreachEmailId } = await pendingSend({
      recipientCap: 5,
    })
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { voterFileFilterId: null },
    })

    await prepare(outreachEmailId)

    expect(spy).not.toHaveBeenCalled()
    expect(await recipientsOf(outreachEmailId)).toHaveLength(0)
    const row = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(row.preparedAt).not.toBeNull()
  })

  it('lets a stale delivery add nobody once the send is trimmed', async () => {
    stubAudience(3)
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'person1@example.com',
        organizationSlug: orgs.winSlug,
        reason: 'link',
      },
    })
    const { sender, outreachId, outreachEmailId } = await pendingSend({
      recipientCap: 5,
    })
    await prepare(outreachEmailId)
    expect(await recipientsOf(outreachEmailId)).toHaveLength(2)

    // A delivery that read the send before the first one finished, still
    // holding the old cursor.
    const outcome = await service.app.get(OutreachEmailAudienceService).resolve(
      {
        id: outreachEmailId,
        senderId: sender.id,
        recipientCap: 5,
        audienceCursor: null,
        organizationSlug: orgs.winSlug,
        voterFileFilterId: (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).voterFileFilterId,
      },
      [orgs.winSlug],
    )

    expect(outcome).toBe('moved')
    expect(await recipientsOf(outreachEmailId)).toHaveLength(2)
  })

  it('writes a page whose people have no names', async () => {
    vi.spyOn(
      service.app.get(ContactsService),
      'findContactsForFilter',
    ).mockResolvedValue(
      page(
        [0, 1].map((i) => ({
          ...makePerson(personId(i), `person${i}@example.com`),
          firstName: null,
          lastName: null,
        })),
      ),
    )
    const { outreachEmailId } = await pendingSend({ recipientCap: 2 })

    await prepare(outreachEmailId)

    const rows = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmailId },
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.firstName === null && r.lastName === null)).toBe(
      true,
    )
  })
})
