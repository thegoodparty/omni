import { randomUUID } from 'node:crypto'
import { addDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PollIndividualMessageSender } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import type {
  PollAnalysisCompleteEvent,
  PollResponseJsonRow,
} from '@/queue/queue.types'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'

const service = useTestService({ jobs: true })

const BUCKET = 'serve-analysis-test'
const RESPONSES_KEY = 'polls/analysis.json'
const PHONE = '+15551234567'
const PERSON_ID = 'person-1'

let pollId: string

beforeEach(async () => {
  vi.stubEnv('SERVE_ANALYSIS_BUCKET_NAME', BUCKET)
  const slug = `eo-poll-analysis-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const office = await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: slug },
  })
  const poll = await service.prisma.poll.create({
    data: {
      name: 'Parks poll',
      messageContent: 'What should the city fix first?',
      targetAudienceSize: 10,
      scheduledDate: new Date('2025-01-01T00:00:00Z'),
      estimatedCompletionDate: addDays(new Date(), 3),
      electedOfficeId: office.id,
    },
  })
  pollId = poll.id
  await service.prisma.pollIndividualMessage.create({
    data: {
      id: `${pollId}-${PERSON_ID}`,
      pollId,
      personId: PERSON_ID,
      personCellPhone: PHONE,
      sentAt: new Date('2025-01-01T00:00:00Z'),
      sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
      electedOfficeId: office.id,
    },
  })

  const rows: PollResponseJsonRow[] = [
    {
      atomicId: 'a-1',
      phoneNumber: PHONE,
      receivedAt: '2025-01-02T10:00:00Z',
      originalMessage: 'Fix the swings at Lincoln Park',
      atomicMessage: 'Fix the swings',
      pollId,
      clusterId: 1,
      theme: 'Parks',
      category: 'infrastructure',
      summary: 'Playground repairs',
      sentiment: 'negative',
      isOptOut: false,
    },
  ]
  vi.spyOn(service.app.get(S3Service), 'getFile').mockImplementation(
    async (bucket, key) =>
      bucket === BUCKET && key === RESPONSES_KEY
        ? JSON.stringify(rows)
        : undefined,
  )
  vi.spyOn(service.app.get(ContactsService), 'findContacts').mockResolvedValue({
    people: [],
    pagination: {
      totalResults: 100,
      currentPage: 1,
      pageSize: 5,
      totalPages: 20,
      hasNextPage: true,
      hasPreviousPage: false,
    },
  })
  const analytics = service.app.get(AnalyticsService)
  vi.spyOn(analytics, 'identify').mockResolvedValue(undefined)
  vi.spyOn(analytics, 'track').mockResolvedValue({
    event: 'tracked',
    userId: 'tracked',
  })
})

// What the SQS consumer does with a pollAnalysisComplete message.
const receive = (data: PollAnalysisCompleteEvent['data']) =>
  service.app
    .get(JobsService)
    .sendMany('pollAnalysisComplete', [
      { data, key: randomUUID(), group: data.pollId },
    ])

const analysis = (): PollAnalysisCompleteEvent['data'] => ({
  pollId,
  totalResponses: 1,
  responsesLocation: RESPONSES_KEY,
  issues: [
    {
      pollId,
      rank: 1,
      theme: 'Parks',
      summary: 'Playground repairs',
      analysis: 'Residents want the swings fixed.',
      responseCount: 1,
      quotes: [{ quote: 'Fix the swings', phone_number: PHONE }],
    },
  ],
})

describe('the pollAnalysisComplete job', () => {
  it('writes the issues and responses and completes the poll', async () => {
    await receive(analysis())
    await service.jobs.settle()

    const poll = await service.prisma.poll.findUniqueOrThrow({
      where: { id: pollId },
    })
    expect(poll.isCompleted).toBe(true)
    const issues = await service.prisma.pollIssue.findMany({
      where: { pollId },
      select: { title: true, mentionCount: true },
    })
    expect(issues).toEqual([{ title: 'Parks', mentionCount: 1 }])
    const responses = await service.prisma.pollIndividualMessage.findMany({
      where: { pollId, sender: PollIndividualMessageSender.CONSTITUENT },
      select: { personId: true, content: true },
    })
    expect(responses).toEqual([
      { personId: PERSON_ID, content: 'Fix the swings at Lincoln Park' },
    ])
  })

  it('dead-letters when the responses file is missing from S3', async () => {
    await receive({ ...analysis(), responsesLocation: 'polls/missing.json' })
    const { deadLetters } = await service.jobs.settle({
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([
      expect.objectContaining({
        name: 'pollAnalysisComplete',
        error: `Unable to fetch responses from S3 for pollId: ${pollId}`,
      }),
    ])
    const poll = await service.prisma.poll.findUniqueOrThrow({
      where: { id: pollId },
    })
    expect(poll.isCompleted).toBe(false)
  })
})
