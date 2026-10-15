import { HttpStatus } from '@nestjs/common'
import { isHighConfidence } from '@goodparty_org/contracts'
import { addDays, subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { completionEvent } from '@/constituentFeedback/tests/issueCaptureFixtures'
import { FeedbackSynthesisIngestService } from '@/constituentFeedback/services/feedbackSynthesisIngest.service'
import { FeaturesService } from '@/features/services/features.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { useTestService } from '@/test-service'
import {
  ContactStatusField,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  SynthesisRunStatus,
  SynthesisScope,
} from '../generated/prisma'

const service = useTestService()

const OTHER_ORG_SLUG = 'eo-other-poll-org'
const PERSON_NAMED = '11111111-1111-4111-8111-111111111111'

let orgSlug: string
let outreachId: number
let replyCount = 0
const isFeatureEnabled = vi.fn()

const eoHeaders = (slug = orgSlug) => ({
  headers: { 'x-organization-slug': slug },
})
const getResults = (id = outreachId) =>
  service.client.get(`/v1/outreach/serve/${id}/poll-results`, eoHeaders())
const getReplies = (query = '', id = outreachId) =>
  service.client.get(`/v1/outreach/serve/${id}/replies${query}`, eoHeaders())
const putFlags = (replyId: string, body: object, id = outreachId) =>
  service.client.put(
    `/v1/outreach/serve/${id}/replies/${replyId}/flags`,
    body,
    eoHeaders(),
  )

const createOrg = async (slug: string, ownerId: number) => {
  await service.prisma.organization.create({
    data: { slug, ownerId, positionId: 'pos-1' },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId: ownerId },
  })
}

const createPoll = async (slug: string, sent: number) => {
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType: OutreachType.poll,
      status: OutreachStatus.in_progress,
      name: 'Parks poll',
      message: 'What should we fix first?',
      pollDetails: {
        create: { topic: 'parks_recreation', audienceKind: 'sample' },
      },
    },
  })
  await service.prisma.outreachTextRecipient.createMany({
    data: Array.from({ length: sent }, (_, i) => ({
      outreachId: outreach.id,
      organizationSlug: slug,
      personId: `recipient-${outreach.id}-${i}`,
      phone: `+1303555${String(i).padStart(4, '0')}`,
    })),
  })
  return outreach.id
}

const addReply = async (
  overrides: {
    personId?: string
    content?: string
    isOptOut?: boolean
    createdAt?: Date
    sentAt?: Date
    outreachId?: number
  } = {},
) => {
  replyCount += 1
  return service.prisma.pollIndividualMessage.create({
    data: {
      id: `reply-${replyCount}`,
      personId: overrides.personId ?? `recipient-${outreachId}-${replyCount}`,
      personCellPhone: '+13035550101',
      sentAt: overrides.sentAt ?? new Date('2026-09-01T12:00:00Z'),
      createdAt: overrides.createdAt,
      content: overrides.content ?? `Fix the park ${replyCount}`,
      isOptOut: overrides.isOptOut ?? false,
      sender: PollIndividualMessageSender.CONSTITUENT,
      outreachId: overrides.outreachId ?? outreachId,
    },
  })
}

const addReplies = async (count: number) =>
  Promise.all(Array.from({ length: count }, () => addReply()))

const addCompletedRun = async (
  completedAt: Date,
  themes: { title: string; replyIds: string[] }[],
  status: SynthesisRunStatus = SynthesisRunStatus.completed,
) => {
  const run = await service.prisma.feedbackSynthesisRun.create({
    data: {
      organizationSlug: orgSlug,
      scope: SynthesisScope.effort,
      outreachId,
      status,
      completedAt,
      conversations: 0,
      memos: 0,
      confirmed: 0,
      engine: 'mock',
    },
  })
  for (const [rank, theme] of themes.entries()) {
    await service.prisma.feedbackTheme.create({
      data: {
        runId: run.id,
        rank: rank + 1,
        title: theme.title,
        summary: `${theme.title} summary`,
        details: '',
        members: {
          create: theme.replyIds.map((textReplyId) => ({ textReplyId })),
        },
      },
    })
  }
  return run
}

beforeEach(async () => {
  orgSlug = `eo-poll-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await createOrg(orgSlug, service.user.id)
  outreachId = await createPoll(orgSlug, 100)
  isFeatureEnabled.mockReset().mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
  vi.spyOn(
    service.app.get(ContactsService),
    'resolveEligibleDistrict',
  ).mockResolvedValue({
    districtId: '33333333-3333-4333-8333-333333333333',
    dataset: 'voters',
  } as Awaited<ReturnType<ContactsService['resolveEligibleDistrict']>>)
  vi.spyOn(service.app.get(VoterQueryService), 'findPeople').mockResolvedValue({
    people: [{ id: PERSON_NAMED, firstName: 'Dana', lastName: 'Whitfield' }],
  } as Awaited<ReturnType<VoterQueryService['findPeople']>>)
})

describe('GET /v1/outreach/serve/:id/poll-results', () => {
  it('reports no themes and no confidence at 19 responses', async () => {
    const replies = await addReplies(19)
    await addCompletedRun(new Date(), [
      { title: 'Parks', replyIds: replies.map((r) => r.id) },
    ])

    const res = await getResults()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({
      outreachId,
      sent: 100,
      responses: 19,
      notEnoughResponses: true,
      confidence: null,
      isHighConfidence: false,
      themes: [],
      nonClustered: { count: 0 },
    })
  })

  it('returns themes at 20 responses and sizes confidence against sent', async () => {
    const replies = await addReplies(20)
    await addReply({ isOptOut: true, content: 'STOP' })
    await addCompletedRun(new Date('2026-09-02T00:00:00Z'), [
      { title: 'Parks', replyIds: replies.slice(0, 12).map((r) => r.id) },
      { title: 'Roads', replyIds: replies.slice(12, 18).map((r) => r.id) },
    ])

    const res = await getResults()

    expect(res.data.notEnoughResponses).toBe(false)
    expect(res.data.responses).toBe(20)
    expect(res.data.responseRate).toBe(0.2)
    expect(res.data.optOutRate).toBe(0.01)
    expect(res.data.confidence).toBe(0.2)
    // 20 replies of 100 sent clears the share bar; against a district of
    // thousands it would not.
    expect(res.data.isHighConfidence).toBe(
      isHighConfidence({ replies: 20, population: 100 }),
    )
    expect(res.data.isHighConfidence).toBe(true)
    expect(
      res.data.themes.map(
        (t: { label: string; mentionCount: number }) =>
          `${t.label}:${t.mentionCount}`,
      ),
    ).toEqual(['Parks:12', 'Roads:6'])
    expect(res.data.themes[0].sampleQuotes).toHaveLength(3)
    expect(res.data.analysis).toEqual({ status: 'completed' })
  })

  it('counts a reply added after the previous run as a new mention', async () => {
    const previousAt = new Date('2026-09-02T00:00:00Z')
    const before = await Promise.all(
      Array.from({ length: 20 }, () =>
        addReply({ createdAt: subDays(previousAt, 1) }),
      ),
    )
    await addCompletedRun(
      previousAt,
      [{ title: 'Parks', replyIds: before.map((r) => r.id) }],
      SynthesisRunStatus.superseded,
    )
    const late = await Promise.all([
      addReply({ createdAt: addDays(previousAt, 1) }),
      addReply({ createdAt: addDays(previousAt, 2) }),
    ])
    await addCompletedRun(addDays(previousAt, 3), [
      { title: 'Parks', replyIds: [...before, ...late].map((r) => r.id) },
    ])

    const res = await getResults()

    expect(res.data.themes[0]).toMatchObject({
      mentionCount: 22,
      newMentions: 2,
    })
  })

  it('counts only replies with no theme in the latest run as non-clustered', async () => {
    const replies = await addReplies(24)
    await addReply({ isOptOut: true, content: 'STOP' })
    await addCompletedRun(new Date(), [
      { title: 'Parks', replyIds: replies.slice(0, 20).map((r) => r.id) },
    ])

    const res = await getResults()

    expect(res.data.nonClustered).toEqual({ count: 4 })
  })

  it('names a quote by the first name the CRM holds', async () => {
    const named = await addReply({
      personId: PERSON_NAMED,
      content: 'The splash pad is broken',
    })
    const others = await addReplies(19)
    await addCompletedRun(new Date(), [
      { title: 'Parks', replyIds: [named, ...others].map((r) => r.id) },
    ])

    const res = await getResults()

    expect(res.data.themes[0].sampleQuotes).toContainEqual({
      text: 'The splash pad is broken',
      firstName: 'Dana',
    })
  })

  it('counts replies since the last analysis off the poll row', async () => {
    const replies = await Promise.all(
      Array.from({ length: 20 }, () =>
        addReply({ createdAt: subDays(new Date(), 2) }),
      ),
    )
    const analyzedAt = subDays(new Date(), 1)
    await addCompletedRun(analyzedAt, [
      { title: 'Parks', replyIds: replies.map((r) => r.id) },
    ])
    await service.prisma.outreachPoll.update({
      where: { outreachId },
      data: { lastAnalysisAt: analyzedAt },
    })
    await addReply({ createdAt: new Date() })

    const res = await getResults()

    expect(res.data.newSinceLastAnalysis).toBe(1)
    expect(new Date(res.data.lastAnalysisAt).getTime()).toBe(
      analyzedAt.getTime(),
    )
  })

  it('reports a run in flight and lists expansions', async () => {
    await service.prisma.feedbackSynthesisRun.create({
      data: {
        organizationSlug: orgSlug,
        scope: SynthesisScope.effort,
        outreachId,
        status: SynthesisRunStatus.running,
        activeKey: `${orgSlug}:${outreachId}`,
        conversations: 0,
        memos: 0,
        confirmed: 0,
        engine: 'mock',
      },
    })
    await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId,
        sendSeq: 2,
        textCount: 50,
        status: OutreachStatus.pending_payment,
      },
    })

    const res = await getResults()

    expect(res.data.analysis).toEqual({ status: 'running' })
    expect(res.data.expansions).toEqual([
      { sendSeq: 2, textCount: 50, status: OutreachStatus.pending_payment },
    ])
  })

  it('404s another office’s poll and a non-poll outreach', async () => {
    await createOrg(OTHER_ORG_SLUG, (await otherUser()).id)
    const theirs = await createPoll(OTHER_ORG_SLUG, 10)
    const text = await service.prisma.outreach.create({
      data: {
        organizationSlug: orgSlug,
        outreachType: OutreachType.text,
        status: OutreachStatus.in_progress,
        name: 'A text',
      },
    })

    expect((await getResults(theirs)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await getResults(text.id)).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s with the rollout flag off', async () => {
    isFeatureEnabled.mockResolvedValue(false)

    expect((await getResults()).status).toBe(HttpStatus.NOT_FOUND)
  })
})

let otherUserCount = 0
const otherUser = () => {
  otherUserCount += 1
  return service.prisma.user.create({
    data: { email: `teammate-${otherUserCount}-${Date.now()}@example.com` },
  })
}

describe('PUT /v1/outreach/serve/:id/replies/:replyId/flags', () => {
  it('upserts per user and clears favorited without touching read', async () => {
    const reply = await addReply()

    const first = await putFlags(reply.id, { favorited: true, read: true })
    expect(first.status).toBe(HttpStatus.OK)
    expect(first.data).toEqual({ favorited: true, read: true })

    const second = await putFlags(reply.id, { favorited: false })
    expect(second.data).toEqual({ favorited: false, read: true })
    const row = await service.prisma.outreachReplyFlag.findUniqueOrThrow({
      where: {
        userId_replyId: { userId: service.user.id, replyId: reply.id },
      },
    })
    expect(row.favoritedAt).toBeNull()
    expect(row.readAt).not.toBeNull()
  })

  it('shows only the session user’s flags on the list', async () => {
    const reply = await addReply()
    const teammate = await otherUser()
    await service.prisma.outreachReplyFlag.create({
      data: {
        userId: teammate.id,
        replyId: reply.id,
        favoritedAt: new Date(),
        readAt: new Date(),
      },
    })

    const res = await getReplies()

    expect(res.data.replies[0]).toMatchObject({
      id: reply.id,
      favorited: false,
      read: false,
    })
  })

  it('filters the list to favorited and unread replies', async () => {
    const [a, b, c] = await Promise.all([addReply(), addReply(), addReply()])
    await putFlags(a.id, { favorited: true, read: true })
    await putFlags(b.id, { read: true })

    const favorited = await getReplies('?filter=favorited')
    const unread = await getReplies('?filter=unread')

    expect(favorited.data.replies.map((r: { id: string }) => r.id)).toEqual([
      a.id,
    ])
    expect(favorited.data.total).toBe(1)
    expect(unread.data.replies.map((r: { id: string }) => r.id)).toEqual([c.id])
  })

  it('404s a reply on another office’s poll', async () => {
    await createOrg(OTHER_ORG_SLUG, (await otherUser()).id)
    const theirs = await createPoll(OTHER_ORG_SLUG, 10)
    const reply = await addReply({ outreachId: theirs })

    expect((await putFlags(reply.id, { read: true }, theirs)).status).toBe(
      HttpStatus.NOT_FOUND,
    )
    expect((await putFlags(reply.id, { read: true })).status).toBe(
      HttpStatus.NOT_FOUND,
    )
    expect(await service.prisma.outreachReplyFlag.count()).toBe(0)
  })

  it('404s with the rollout flag off', async () => {
    const reply = await addReply()
    isFeatureEnabled.mockResolvedValue(false)

    expect((await putFlags(reply.id, { read: true })).status).toBe(
      HttpStatus.NOT_FOUND,
    )
  })
})

describe('GET /v1/outreach/serve/:id/replies on a poll', () => {
  it('limits the list to a theme, or to replies the latest run left out', async () => {
    const replies = await addReplies(5)
    await addCompletedRun(new Date(), [
      { title: 'Parks', replyIds: replies.slice(0, 3).map((r) => r.id) },
    ])
    const theme = await service.prisma.feedbackTheme.findFirstOrThrow({
      where: { title: 'Parks' },
    })

    const inTheme = await getReplies(`?themeId=${theme.id}`)
    const left = await getReplies('?nonClustered=true')

    expect(inTheme.data.total).toBe(3)
    expect(left.data.replies.map((r: { id: string }) => r.id).sort()).toEqual(
      replies
        .slice(3)
        .map((r) => r.id)
        .sort(),
    )
  })

  it('returns the CRM contact id and the label the contact card shows', async () => {
    const reply = await addReply({ personId: PERSON_NAMED })
    await service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug: orgSlug,
        personId: PERSON_NAMED,
        field: ContactStatusField.civic_panel,
        value: 'member',
      },
    })

    const res = await getReplies()

    expect(res.data.replies[0]).toMatchObject({
      id: reply.id,
      crm: { contactId: PERSON_NAMED, statusLabel: 'Civic panel member' },
    })
  })

  it('still returns the list, without a crm block, when the CRM read fails', async () => {
    await addReply({ personId: PERSON_NAMED })
    vi.spyOn(
      service.app.get(ContactStatusService),
      'currentStatusForPeople',
    ).mockRejectedValue(new Error('crm down'))

    const res = await getReplies()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.total).toBe(1)
    expect(res.data.replies[0]).not.toHaveProperty('crm')
  })
})

describe('synthesis completion on a poll', () => {
  it('stamps lastAnalysisAt when an effort run completes', async () => {
    const replies = await addReplies(3)
    const run = await service.prisma.feedbackSynthesisRun.create({
      data: {
        organizationSlug: orgSlug,
        scope: SynthesisScope.effort,
        outreachId,
        status: SynthesisRunStatus.running,
        activeKey: `${orgSlug}:${outreachId}`,
        conversations: 3,
        memos: 3,
        confirmed: 3,
        engine: 'mock',
      },
    })

    await service.app
      .get(FeedbackSynthesisIngestService)
      .handle(
        completionEvent(run.id, [
          { theme: 'Parks', memberIds: replies.map((r) => r.id) },
        ]),
      )

    const poll = await service.prisma.outreachPoll.findUniqueOrThrow({
      where: { outreachId },
    })
    const done = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
      where: { id: run.id },
    })
    expect(poll.lastAnalysisAt).toEqual(done.completedAt)
  })
})
