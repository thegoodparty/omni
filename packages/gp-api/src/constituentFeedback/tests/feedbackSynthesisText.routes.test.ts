import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  onTestFinished,
  vi,
} from 'vitest'
import { subMinutes } from 'date-fns'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
  ConstituentFeedbackStance,
  PollIndividualMessageSender,
  Prisma,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { FeedbackSynthesisIngestService } from '../services/feedbackSynthesisIngest.service'
import { FeedbackThemeIssueMatchService } from '../services/feedbackThemeIssueMatch.service'
import { MockSynthesisEngine } from '../services/mockSynthesisEngine'
import {
  completionEvent,
  createServeOrg,
  createWinOrg,
  ownerHeaders,
  seedKnockMemo,
  seedReply,
  seedTextEffort,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService()

const engine = () => service.app.get(MockSynthesisEngine)
const ingest = () => service.app.get(FeedbackSynthesisIngestService)

let scheduled: Array<Parameters<MockSynthesisEngine['scheduleCompletion']>>

const flushEngine = async () => {
  for (const args of scheduled.splice(0)) {
    await engine().complete(...args)
  }
}

const REPLIES = [
  'The potholes on Elm are getting worse.',
  'Fix Main Street first, it floods every spring.',
  'Elm, by the school.',
  'Please do something about the drainage on 5th.',
  'Potholes everywhere on Elm.',
  'The crosswalk on Main needs a light.',
]

// A Serve text send's replies are the input to synthesis, the way a turf's
// confirmed notes are. Nobody confirms a reply: it is the constituent's own
// words, and an opt-out or an empty body is not one.
describe('feedback synthesis on a text send', () => {
  let slug: string
  let outreachId: number
  let llm: MockInstance<LlmService['jsonCompletion']>

  beforeEach(async () => {
    scheduled = []
    const spy = vi
      .spyOn(engine(), 'scheduleCompletion')
      .mockImplementation((...args) => {
        scheduled.push(args)
      })
    onTestFinished(() => spy.mockRestore())
    // A completed run with memo issues asks the model to match them to
    // themes. Unanswered, a theme counts every issue in its notes.
    llm = vi
      .spyOn(service.app.get(LlmService), 'jsonCompletion')
      .mockRejectedValue(new Error('No model in this suite'))
    onTestFinished(() => llm.mockRestore())

    slug = await createServeOrg(service)
    outreachId = (await seedTextEffort(service, slug)).id
  })

  const synthesize = (id = outreachId, orgSlug = slug) =>
    service.client.post(
      `/v1/constituent-feedback/efforts/${id}/synthesize`,
      {},
      ownerHeaders(orgSlug),
    )

  const report = (id = outreachId, orgSlug = slug) =>
    service.client.get(
      `/v1/constituent-feedback/efforts/${id}/report`,
      ownerHeaders(orgSlug),
    )

  // Oldest first, a minute apart, so the order the engine is handed them in
  // is checkable.
  const seedReplies = async (contents: string[], id = outreachId) => {
    const rows = []
    for (const [i, content] of contents.entries()) {
      rows.push(
        await seedReply(service, {
          outreachId: id,
          content,
          sentAt: subMinutes(new Date(), contents.length - i),
        }),
      )
    }
    return rows
  }

  const completeRun = async (
    issues: Array<{ theme: string; memberIds: string[] }>,
  ) => {
    const res = await synthesize()
    expect(res.status).toBe(HttpStatus.CREATED)
    scheduled.splice(0)
    await ingest().handle(completionEvent(res.data.id, issues))
    return res.data.id as string
  }

  describe('the run', () => {
    it('hands the engine the replies with words, oldest first, and nothing else', async () => {
      const replies = await seedReplies(REPLIES)
      await seedReply(service, { outreachId, content: 'STOP', isOptOut: true })
      await seedReply(service, {
        outreachId,
        content: 'Stop texting me about the potholes',
        isOptOut: true,
      })
      await seedReply(service, { outreachId, content: null })
      await seedReply(service, { outreachId, content: '   ' })
      await seedReply(service, {
        outreachId,
        content: 'Which street needs fixing first?',
        sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
      })

      const res = await synthesize()

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.status).toBe('running')
      expect(scheduled).toHaveLength(1)
      const handed = scheduled[0]![1]
      expect(handed).toEqual(
        replies.map((reply) => ({
          id: reply.id,
          text: reply.content,
          occurredAt: reply.sentAt,
        })),
      )
      const run = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
        where: { id: res.data.id },
      })
      expect(run).toMatchObject({
        outreachId,
        confirmed: 6,
        memos: 6,
        conversations: 6,
        activeKey: `${slug}:${outreachId}`,
      })
    })

    it('refuses under the floor, counting only replies with words', async () => {
      await seedReplies(REPLIES.slice(0, 4))
      await seedReply(service, { outreachId, content: 'STOP', isOptOut: true })
      await seedReply(service, { outreachId, content: '' })

      const res = await synthesize()

      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
      expect(res.data).toMatchObject({ confirmed: 4, required: 5 })
      expect(
        await service.prisma.feedbackSynthesisRun.count({
          where: { organizationSlug: slug },
        }),
      ).toBe(0)
    })

    it('runs the mock engine end to end into themes of replies', async () => {
      await seedReplies(REPLIES)

      const res = await synthesize()
      expect(res.status).toBe(HttpStatus.CREATED)
      await flushEngine()

      const run = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
        where: { id: res.data.id },
      })
      expect(run.status).toBe(SynthesisRunStatus.completed)
      expect(run.activeKey).toBeNull()
      const members = await service.prisma.feedbackThemeMember.findMany({
        where: { theme: { runId: run.id } },
      })
      expect(members).toHaveLength(6)
      expect(members.every((m) => m.feedbackId === null)).toBe(true)
      expect(members.every((m) => m.textReplyId !== null)).toBe(true)

      const read = await report()
      expect(read.status).toBe(HttpStatus.OK)
      expect(read.data.themes).toHaveLength(3)
      expect(
        read.data.themes.reduce(
          (n: number, t: { conversationCount: number }) =>
            n + t.conversationCount,
          0,
        ),
      ).toBe(6)
    })

    // A Win text's replies come back from the vendor as timestamps, never
    // words: there is nothing to group, so it is not an effort at all.
    it('404s a Win text send', async () => {
      const win = await createWinOrg(service)
      const send = await seedTextEffort(service, win.slug, {
        campaignId: win.campaignId,
      })

      expect((await report(send.id, win.slug)).status).toBe(
        HttpStatus.NOT_FOUND,
      )
      expect((await synthesize(send.id, win.slug)).status).toBe(
        HttpStatus.NOT_FOUND,
      )
    })

    it('404s a text send from another org', async () => {
      const otherSlug = await createServeOrg(service)

      expect((await report(outreachId, otherSlug)).status).toBe(
        HttpStatus.NOT_FOUND,
      )
    })
  })

  describe('the ingest', () => {
    // Reply ids come back from outside like memo ids do. Only this send's
    // replies become members; another send's reply, a memo from a turf and
    // a made-up id are dropped. A reply has no record for a tag to land on.
    it('writes reply members and drops ids outside the send', async () => {
      const replies = await seedReplies(REPLIES.slice(0, 5))
      const elsewhere = await seedTextEffort(service, slug)
      const stranger = await seedReply(service, {
        outreachId: elsewhere.id,
        content: 'A reply on another send.',
      })
      const turf = await seedTurfEffort(service, slug, { people: 1 })
      const memo = await seedKnockMemo(service, {
        slug,
        outreachId: turf.outreachId,
        personId: turf.targets[0]!.personId,
      })

      const runId = await completeRun([
        {
          theme: 'Potholes on Elm',
          memberIds: [
            ...replies.map((reply) => reply.id),
            stranger.id,
            memo.memo.id,
            randomUUID(),
          ],
        },
      ])

      const members = await service.prisma.feedbackThemeMember.findMany({
        where: { theme: { runId } },
      })
      expect(members.map((m) => m.textReplyId).sort()).toEqual(
        replies.map((reply) => reply.id).sort(),
      )
      expect(members.every((m) => m.feedbackId === null)).toBe(true)
      expect(
        await service.prisma.constituentFeedbackTag.count({
          where: { runId },
        }),
      ).toBe(0)
      const theme = await service.prisma.feedbackTheme.findFirstOrThrow({
        where: { runId },
        include: { tag: true },
      })
      expect(theme.tag).toMatchObject({
        name: 'Potholes on Elm',
        status: 'proposed',
        proposedByRunId: runId,
      })
    })

    it('fails a run whose every member is outside the send', async () => {
      await seedReplies(REPLIES.slice(0, 5))
      const elsewhere = await seedTextEffort(service, slug)
      const stranger = await seedReply(service, {
        outreachId: elsewhere.id,
        content: 'A reply on another send.',
      })

      const runId = await completeRun([
        { theme: 'Potholes', memberIds: [stranger.id, randomUUID()] },
      ])

      expect(
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: runId },
        }),
      ).toMatchObject({
        status: SynthesisRunStatus.failed,
        error: 'no_members_in_scope',
        activeKey: null,
      })
    })

    it('writes a member once however many times the engine names it', async () => {
      const replies = await seedReplies(REPLIES.slice(0, 5))
      const ids = replies.map((reply) => reply.id)

      const runId = await completeRun([
        { theme: 'Potholes', memberIds: [...ids, ids[0]!, ids[0]!] },
      ])

      expect(
        await service.prisma.feedbackThemeMember.count({
          where: { theme: { runId } },
        }),
      ).toBe(5)
    })
  })

  describe('the report', () => {
    it('lists the replies newest first as what each person wrote', async () => {
      const replies = await seedReplies(REPLIES.slice(0, 2))
      await seedReply(service, { outreachId, content: 'STOP', isOptOut: true })
      await seedReply(service, { outreachId, content: null })

      const res = await report()

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data).toEqual({
        question: null,
        channel: 'text',
        floor: 5,
        denominators: { conversations: 2, memos: 2, confirmed: 2, pending: 0 },
        run: null,
        themes: [],
        memos: [
          {
            id: replies[1]!.id,
            personId: replies[1]!.personId,
            occurredAt: replies[1]!.sentAt.toISOString(),
            channel: 'text',
            transcript: REPLIES[1],
            issues: [],
            actorName: null,
            confirmedAt: replies[1]!.sentAt.toISOString(),
            extractionStatus: null,
          },
          {
            id: replies[0]!.id,
            personId: replies[0]!.personId,
            occurredAt: replies[0]!.sentAt.toISOString(),
            channel: 'text',
            transcript: REPLIES[0],
            issues: [],
            actorName: null,
            confirmedAt: replies[0]!.sentAt.toISOString(),
            extractionStatus: null,
          },
        ],
      })
    })

    it('counts people once however many replies they sent', async () => {
      const personId = randomUUID()
      await seedReply(service, { outreachId, personId, content: 'Elm.' })
      await seedReply(service, { outreachId, personId, content: 'And Main.' })
      await seedReply(service, { outreachId, content: '5th Street.' })

      const res = await report()

      expect(res.data.denominators).toEqual({
        conversations: 2,
        memos: 3,
        confirmed: 3,
        pending: 0,
      })
    })

    // A reply carries no stance and no ask. A theme made of replies counts
    // its conversations and has no split at all, rather than four zeros.
    it('counts a theme of replies with no stance split or outcomes', async () => {
      const replies = await seedReplies(REPLIES.slice(0, 5))
      const match = vi.spyOn(
        service.app.get(FeedbackThemeIssueMatchService),
        'matchRun',
      )
      onTestFinished(() => match.mockRestore())
      const runId = await completeRun([
        {
          theme: 'Potholes on Elm',
          memberIds: replies.map((reply) => reply.id),
        },
      ])
      await match.mock.results[0]!.value

      // Replies raise no issue, so there is nothing to ask the model.
      expect(llm).not.toHaveBeenCalled()
      const run = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
        where: { id: runId },
      })
      expect(run.issuesMatchedAt).not.toBeNull()

      const res = await report()

      expect(res.data.run.id).toBe(runId)
      expect(res.data.themes).toEqual([
        expect.objectContaining({
          title: 'Potholes on Elm',
          conversationCount: 5,
          stanceCounts: null,
          desiredOutcomes: [],
        }),
      ])
      const detail = await service.client.get(
        `/v1/constituent-feedback/themes/${res.data.themes[0].id}`,
        ownerHeaders(slug),
      )
      expect(detail.status).toBe(HttpStatus.OK)
      expect(detail.data.stanceCounts).toBeNull()
      expect(detail.data.members).toHaveLength(5)
      expect(detail.data.members[0]).toEqual({
        feedbackId: null,
        textReplyId: replies[4]!.id,
        personId: replies[4]!.personId,
        occurredAt: replies[4]!.sentAt.toISOString(),
        channel: 'text',
        transcript: REPLIES[4],
        issues: [],
        actorName: null,
      })
    })

    // Membership is per source, so a theme holding both a memo and replies
    // counts every one of them as a conversation, while its stances come
    // from the memo alone: a reply has none to add.
    it('counts replies and memos together, with stances from the memos only', async () => {
      const replies = await seedReplies(REPLIES.slice(0, 5))
      const memo = await service.prisma.constituentFeedback.create({
        data: {
          organizationSlug: slug,
          personId: randomUUID(),
          occurredAt: new Date(),
          actorUserId: service.user.id,
          channel: ConstituentFeedbackChannel.phone_bank,
          transcript: 'She wants Elm repaved this year.',
          captureMethod: ConstituentFeedbackCaptureMethod.typed,
          extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
          confirmedAt: new Date(),
          clientKey: randomUUID(),
          outreachId,
          issues: {
            create: {
              position: 0,
              issueLabel: 'Potholes',
              stance: ConstituentFeedbackStance.supports,
              desiredOutcome: 'Repave Elm',
            },
          },
        },
      })

      await completeRun([
        {
          theme: 'Potholes',
          memberIds: [...replies.map((reply) => reply.id), memo.id],
        },
      ])

      const res = await report()
      expect(res.data.themes[0]).toEqual(
        expect.objectContaining({
          conversationCount: 6,
          stanceCounts: { supports: 1, opposes: 0, mixed: 0, unclear: 0 },
          desiredOutcomes: ['Repave Elm'],
        }),
      )
      const members = await service.prisma.feedbackThemeMember.findMany({
        where: { theme: { runId: res.data.run.id } },
        orderBy: { feedbackId: Prisma.SortOrder.asc },
      })
      expect(members.filter((m) => m.feedbackId === memo.id)).toHaveLength(1)
      expect(members.filter((m) => m.textReplyId !== null)).toHaveLength(5)
    })
  })
})
