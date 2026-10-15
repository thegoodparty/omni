import { StatsResponse } from '@/contacts/contacts.types'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { useTestService } from '@/test-service'
import { addDays, format, isWeekend } from 'date-fns'
import { v7 as uuidv7 } from 'uuid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PollBiasAnalysisService } from './services/pollBiasAnalysis.service'

const service = useTestService()

const getStats = vi.fn(ContactsService.prototype.getDistrictStats)

const sampleContacts = vi.fn()

const people = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `person-${index}`,
    cellPhone: `512555${String(index).padStart(4, '0')}`,
  }))

const validDate = (): string => {
  let date = addDays(new Date(), 14)
  while (isWeekend(date)) date = addDays(date, 1)
  return format(date, 'yyyy-MM-dd')
}

let eoOrgSlug: string

beforeEach(async () => {
  const campaignId = 8888
  const organizationSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: {
      slug: organizationSlug,
      ownerId: service.user.id,
      positionId: 'gp-position-1',
    },
  })

  const campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug,
      userId: service.user.id,
      slug: 'test-campaign',
      details: {
        state: 'WY',
      },
    },
  })

  const electedOfficeId = uuidv7()
  eoOrgSlug = `eo-${electedOfficeId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: {
      id: electedOfficeId,
      userId: service.user.id,
      campaignId: campaign.id,
      organizationSlug: eoOrgSlug,
    },
  })

  getStats.mockResolvedValue({
    totalConstituentsWithCellPhone: 1000,
  } as StatsResponse)

  const contacts = service.app.get(ContactsService)
  vi.spyOn(contacts, 'getDistrictStats').mockImplementation(getStats)
  sampleContacts
    .mockReset()
    .mockImplementation(async ({ size }) => people(size))
  vi.spyOn(contacts, 'sampleContacts').mockImplementation(sampleContacts)
  vi.spyOn(
    service.app.get(ContactInteractionTextService),
    'findOptedOutPersonIds',
  ).mockResolvedValue([])
  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolvePositionNameByOrganizationSlug',
  ).mockResolvedValue('City Council Member')
})

describe('POST /polls/initial-poll', () => {
  const eoHeaders = () => ({
    headers: { 'x-organization-slug': eoOrgSlug },
  })

  const body = (overrides: Record<string, unknown> = {}) => ({
    question: 'What issues do you think should be our top priority?',
    swornInDate: '2025-01-01',
    scheduledLocalDate: validDate(),
    ...overrides,
  })

  const postInitial = (overrides: Record<string, unknown> = {}) =>
    service.client.post<{ outreachId: number; recipientCount: number }>(
      '/v1/polls/initial-poll',
      body(overrides),
      eoHeaders(),
    )

  it.each([{ question: '' }, { scheduledLocalDate: 'tomorrow' }])(
    'blocks bad input',
    async (overrides) => {
      const result = await postInitial(overrides)
      expect(result).toMatchObject({
        status: 400,
        data: { message: 'Validation failed' },
      })
    },
  )

  it('fails if total constituents is less than 500', async () => {
    getStats.mockResolvedValue({
      totalConstituents: 499,
      totalConstituentsWithCellPhone: 499,
    } as StatsResponse)
    const result = await postInitial()
    expect(result).toMatchObject({
      status: 400,
      data: {
        message:
          'You need at least 500 constituents with cell phones to create a poll.',
      },
    })
  })

  it('creates a poll outreach held for review and no legacy poll', async () => {
    const result = await postInitial()

    expect(result).toMatchObject({
      status: 201,
      data: { outreachId: expect.any(Number), recipientCount: 500 },
    })
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: result.data.outreachId },
      include: { pollDetails: true },
    })
    expect(outreach).toMatchObject({
      organizationSlug: eoOrgSlug,
      campaignId: null,
      outreachType: 'poll',
      status: 'pending',
      textCount: 500,
      pollDetails: { topic: 'custom', audienceKind: 'sample' },
    })
    expect(outreach.message).toContain(
      'What issues do you think should be our top priority?',
    )
    expect(await service.prisma.poll.count()).toBe(0)
  })

  it('sizes the poll to the sample left after the opt-out scrub', async () => {
    sampleContacts.mockImplementation(async () => people(497))

    const result = await postInitial()

    expect(result.data.recipientCount).toBe(497)
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: result.data.outreachId },
    })
    expect(outreach.textCount).toBe(497)
  })

  it('rejects a second initial poll', async () => {
    await postInitial()

    const second = await postInitial()

    expect(second).toMatchObject({
      status: 409,
      data: {
        message: 'You already have a poll. You cannot create an initial poll.',
      },
    })
  })

  it('reports has-polls once the poll outreach is submitted', async () => {
    const before = await service.client.get('/v1/polls/has-polls', eoHeaders())
    expect(before.data).toEqual({ hasPolls: false })

    await postInitial()

    const after = await service.client.get('/v1/polls/has-polls', eoHeaders())
    expect(after.data).toEqual({ hasPolls: true })
  })

  it('does not count an unsubmitted poll draft as having a poll', async () => {
    await service.prisma.outreach.create({
      data: {
        organizationSlug: eoOrgSlug,
        outreachType: 'poll',
        status: 'pending_payment',
        name: 'Poll',
        message: 'draft',
        textCount: 500,
      },
    })

    const result = await service.client.get('/v1/polls/has-polls', eoHeaders())

    expect(result.data).toEqual({ hasPolls: false })
  })
})

describe('GET /polls/:pollId/download-responses', () => {
  const eoHeaders = () => ({
    headers: { 'x-organization-slug': eoOrgSlug },
    responseType: 'arraybuffer' as const,
  })

  const seedPoll = async (overrides: Partial<{ name: string }> = {}) => {
    const electedOffice = await service.prisma.electedOffice.findFirst({
      where: { organizationSlug: eoOrgSlug },
    })
    if (!electedOffice) {
      throw new Error('test setup: elected office not seeded')
    }

    return service.prisma.poll.create({
      data: {
        name: overrides.name ?? 'My Test Poll',
        messageContent: 'How do you feel about local issues?',
        targetAudienceSize: 1000,
        scheduledDate: new Date('2025-01-01T00:00:00Z'),
        estimatedCompletionDate: new Date('2025-01-08T00:00:00Z'),
        electedOfficeId: electedOffice.id,
      },
    })
  }

  const seedIssue = (pollId: string, title: string) =>
    service.prisma.pollIssue.create({
      data: {
        id: uuidv7(),
        pollId,
        title,
        summary: `summary for ${title}`,
        details: `details for ${title}`,
        mentionCount: 1,
        representativeComments: [],
      },
    })

  const seedMessage = (
    pollId: string,
    overrides: Partial<{
      content: string
      sender: 'CONSTITUENT' | 'ELECTED_OFFICIAL'
      sentAt: Date
      isOptOut: boolean | null
      issueIds: string[]
    }> = {},
  ) =>
    service.prisma.pollIndividualMessage.create({
      data: {
        id: uuidv7(),
        personId: uuidv7(),
        sentAt: overrides.sentAt ?? new Date('2025-01-02T00:00:00Z'),
        sender: overrides.sender ?? 'CONSTITUENT',
        content: overrides.content ?? 'Default constituent response',
        isOptOut: overrides.isOptOut ?? null,
        pollId,
        pollIssues: overrides.issueIds
          ? { connect: overrides.issueIds.map((id) => ({ id })) }
          : undefined,
      },
    })

  it('streams constituent responses as CSV with the BOM + poll name header', async () => {
    const poll = await seedPoll({ name: 'Town Hall Poll' })
    const housing = await seedIssue(poll.id, 'Housing')
    const transit = await seedIssue(poll.id, 'Transit')

    await seedMessage(poll.id, {
      content: 'We need more affordable housing',
      sentAt: new Date('2025-01-02T00:00:00Z'),
      issueIds: [housing.id],
    })
    await seedMessage(poll.id, {
      content: 'Buses need to run later',
      sentAt: new Date('2025-01-03T00:00:00Z'),
      issueIds: [transit.id, housing.id],
    })
    // Excluded: ELECTED_OFFICIAL sender
    await seedMessage(poll.id, {
      content: 'Thanks for your feedback',
      sender: 'ELECTED_OFFICIAL',
      sentAt: new Date('2025-01-04T00:00:00Z'),
    })
    // Excluded: opt-out
    await seedMessage(poll.id, {
      content: 'STOP',
      isOptOut: true,
      sentAt: new Date('2025-01-05T00:00:00Z'),
    })

    const result = await service.client.get(
      `/v1/polls/${poll.id}/download-responses`,
      eoHeaders(),
    )

    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toContain('text/csv')
    expect(result.headers['content-disposition']).toContain(
      'attachment; filename="Town Hall Poll.csv"',
    )

    const body = Buffer.from(result.data as ArrayBuffer).toString('utf-8')
    const lines = body.split('\n')

    expect(lines[0]).toBe('\uFEFFTown Hall Poll')
    expect(lines[1]).toBe('message_content,associated_clusters')
    // Postgres COPY only quotes fields that contain the delimiter, quote
    // characters, or newlines. Issues are joined alphabetically with "; ".
    expect(lines[2]).toBe('We need more affordable housing,Housing')
    expect(lines[3]).toBe('Buses need to run later,Housing; Transit')
    // No ELECTED_OFFICIAL row and no opt-out row
    expect(body).not.toContain('Thanks for your feedback')
    expect(body).not.toContain('STOP')
  })

  it('returns 404 for an unknown poll id', async () => {
    const result = await service.client.get(
      `/v1/polls/${uuidv7()}/download-responses`,
      eoHeaders(),
    )
    expect(result.status).toBe(404)
  })

  it('returns 403 when the poll belongs to a different elected office', async () => {
    // A user owns at most one elected office, so the "other" office must
    // belong to a different user. The caller still reaches the endpoint
    // through their own office header and is rejected on poll ownership.
    const otherUser = await service.prisma.user.create({
      data: { email: `other-office-${uuidv7()}@example.com` },
    })
    const otherEoId = uuidv7()
    const otherOrgSlug = `eo-${otherEoId}`
    await service.prisma.organization.create({
      data: { slug: otherOrgSlug, ownerId: otherUser.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        id: otherEoId,
        userId: otherUser.id,
        organizationSlug: otherOrgSlug,
      },
    })
    const foreignPoll = await service.prisma.poll.create({
      data: {
        name: 'Foreign Poll',
        messageContent: 'msg',
        targetAudienceSize: 100,
        scheduledDate: new Date(),
        estimatedCompletionDate: new Date(),
        electedOfficeId: otherEoId,
      },
    })

    const result = await service.client.get(
      `/v1/polls/${foreignPoll.id}/download-responses`,
      eoHeaders(),
    )
    expect(result.status).toBe(403)
  })

  it('emits only the BOM + name + header when the poll has no constituent responses', async () => {
    const poll = await seedPoll({ name: 'Empty Poll' })
    await seedMessage(poll.id, {
      sender: 'ELECTED_OFFICIAL',
      content: 'Hello',
    })

    const result = await service.client.get(
      `/v1/polls/${poll.id}/download-responses`,
      eoHeaders(),
    )

    expect(result.status).toBe(200)
    const body = Buffer.from(result.data as ArrayBuffer).toString('utf-8')
    expect(body).toBe('\uFEFFEmpty Poll\nmessage_content,associated_clusters\n')
  })
})

describe('POST /polls/analyze-bias', () => {
  let pollBiasAnalysisService: PollBiasAnalysisService

  beforeEach(() => {
    pollBiasAnalysisService = service.app.get(PollBiasAnalysisService)
  })

  it('returns bias analysis response', async () => {
    const mockResponse = {
      bias_spans: [
        {
          start: 0,
          end: 5,
          reason: 'bias',
          suggestion: 'neutral term',
        },
      ],
      grammar_spans: [],
      rewritten_text: 'Neutral text',
    }

    const spy = vi
      .spyOn(pollBiasAnalysisService, 'analyzePollText')
      .mockResolvedValue(mockResponse)

    const result = await service.client.post('/v1/polls/analyze-bias', {
      pollText: 'Test poll text',
    })

    expect(result).toMatchObject({
      status: 201,
      data: mockResponse,
    })
    expect(spy).toHaveBeenCalledWith(
      'Test poll text',
      service.user.id.toString(),
    )
  })
})
