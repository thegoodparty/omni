import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { subMinutes } from 'date-fns'
import { FEEDBACK_REPORT_MEMO_LIMIT } from '@goodparty_org/contracts'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
  ConstituentFeedbackStance,
  DoorKnockOutcome,
  IssueTagSource,
  IssueTagStatus,
  OrganizationRole,
  OutreachStatus,
  PhoneBankCallOutcome,
  Prisma,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { FeaturesService } from '@/features/services/features.service'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ConstituentFeedbackExtractionService } from '../services/constituentFeedbackExtraction.service'
import { FeedbackSynthesisIngestService } from '../services/feedbackSynthesisIngest.service'
import { MockSynthesisEngine } from '../services/mockSynthesisEngine'
import {
  call,
  completionEvent,
  createServeOrg,
  createWinOrg,
  knock,
  ownerHeaders,
  seedCallMemo,
  seedKnockMemo,
  seedPhoneEffort,
  seedTurfEffort,
  type StopTarget,
} from './issueCaptureFixtures'

const service = useTestService()

const engine = () => service.app.get(MockSynthesisEngine)
const ingest = () => service.app.get(FeedbackSynthesisIngestService)

// The mock engine waits five seconds before it hands its payload to the
// ingest. The suite captures what it scheduled and completes it on demand
// instead of sleeping.
let scheduled: Array<Parameters<MockSynthesisEngine['scheduleCompletion']>>

const flushEngine = async () => {
  for (const args of scheduled.splice(0)) {
    await engine().complete(...args)
  }
}

describe('feedback synthesis routes', () => {
  let slug: string
  let effort: Awaited<ReturnType<typeof seedTurfEffort>>

  beforeEach(async () => {
    scheduled = []
    const spy = vi
      .spyOn(engine(), 'scheduleCompletion')
      .mockImplementation((...args) => {
        scheduled.push(args)
      })
    onTestFinished(() => spy.mockRestore())

    slug = await createServeOrg(service)
    effort = await seedTurfEffort(service, slug, {
      question: 'What should the city fix first?',
      people: 8,
    })
  })

  const synthesize = (outreachId = effort.outreachId, orgSlug = slug) =>
    service.client.post(
      `/v1/constituent-feedback/efforts/${outreachId}/synthesize`,
      {},
      ownerHeaders(orgSlug),
    )

  const report = (outreachId = effort.outreachId, orgSlug = slug) =>
    service.client.get(
      `/v1/constituent-feedback/efforts/${outreachId}/report`,
      ownerHeaders(orgSlug),
    )

  const seedConfirmed = async (targets: StopTarget[]) => {
    const memos = []
    for (const target of targets) {
      memos.push(
        await seedKnockMemo(service, {
          slug,
          outreachId: effort.outreachId,
          personId: target.personId,
        }),
      )
    }
    return memos
  }

  // A run whose memos are already on disk, completed through the ingest
  // with the themes the test names.
  const completeRun = async (
    issues: Array<{ theme: string; memberIds: string[] }>,
  ) => {
    const res = await synthesize()
    expect(res.status).toBe(HttpStatus.CREATED)
    scheduled.splice(0)
    await ingest().handle(completionEvent(res.data.id, issues))
    return res.data.id as string
  }

  // Lets the next request clear the ten-minute cooldown.
  const ageCompletedRuns = () =>
    service.prisma.feedbackSynthesisRun.updateMany({
      where: { organizationSlug: slug, status: SynthesisRunStatus.completed },
      data: { completedAt: subMinutes(new Date(), 11) },
    })

  describe('the floor', () => {
    // Grouping three memos is meaningless, and a percentage over three
    // conversations is the misleading number the report exists to avoid.
    it('refuses three confirmed memos with how many it has and needs', async () => {
      await seedConfirmed(effort.targets.slice(0, 3))

      const res = await synthesize()

      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
      expect(res.data).toMatchObject({ confirmed: 3, required: 5 })
      expect(
        await service.prisma.feedbackSynthesisRun.count({
          where: { organizationSlug: slug },
        }),
      ).toBe(0)
    })

    it('does not count memos nobody confirmed toward the floor', async () => {
      await seedConfirmed(effort.targets.slice(0, 4))
      await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: effort.targets[4]!.personId,
        confirmed: false,
      })

      const res = await synthesize()

      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
      expect(res.data).toMatchObject({ confirmed: 4, required: 5 })
    })
  })

  // The unique activeKey is the race guard between the report's button and
  // the completion trigger. A second request inside the window must lose on
  // the index, not on a read that both could pass.
  it('refuses a second run while one is in flight, writing no second row', async () => {
    await seedConfirmed(effort.targets.slice(0, 5))

    const first = await synthesize()
    const second = await synthesize()

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(first.data.status).toBe('running')
    expect(second.status).toBe(HttpStatus.CONFLICT)
    // Mapped by the service, not left to the global Prisma filter: the
    // completion trigger tells this refusal apart from a real failure.
    expect(second.data.message).toBe('This effort is already being summarized')
    const runs = await service.prisma.feedbackSynthesisRun.findMany({
      where: { organizationSlug: slug },
    })
    expect(runs).toHaveLength(1)
    expect(runs[0]!.activeKey).toBe(`${slug}:${effort.outreachId}`)
  })

  it('refuses a run inside the cooldown after a completed one', async () => {
    const memos = await seedConfirmed(effort.targets.slice(0, 5))
    await completeRun([
      { theme: 'Flooding', memberIds: memos.map((m) => m.memo.id) },
    ])

    const res = await synthesize()

    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
  })

  // A memo confirmed by hand after its recording failed has no words, and
  // would be an empty row in the pipeline's CSV. The run's count is what it
  // was handed, so its caption never claims more than went in.
  it('leaves a confirmed memo with no transcript out of the run', async () => {
    const memos = await seedConfirmed(effort.targets.slice(0, 5))
    const { memo: wordless } = await seedKnockMemo(service, {
      slug,
      outreachId: effort.outreachId,
      personId: effort.targets[5]!.personId,
    })
    await service.prisma.constituentFeedback.update({
      where: { id: wordless.id },
      data: { transcript: null },
    })

    const res = await synthesize()

    expect(res.status).toBe(HttpStatus.CREATED)
    const handed = scheduled[0]![1]
    expect(handed.map((memo) => memo.id).sort()).toEqual(
      memos.map((m) => m.memo.id).sort(),
    )
    const run = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
      where: { id: res.data.id },
    })
    expect(run.confirmed).toBe(5)
  })

  it('runs the mock engine end to end through the same ingest', async () => {
    await seedConfirmed(effort.targets.slice(0, 6))

    const res = await synthesize()
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.engine).toBe('mock')
    expect(scheduled).toHaveLength(1)
    await flushEngine()

    const run = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
      where: { id: res.data.id },
    })
    expect(run.status).toBe(SynthesisRunStatus.completed)
    expect(run.activeKey).toBeNull()
    expect(run.completedAt).not.toBeNull()
    expect(run.confirmed).toBe(6)

    const themes = await service.prisma.feedbackTheme.findMany({
      where: { runId: run.id },
      include: { members: true, tag: true },
      orderBy: { rank: Prisma.SortOrder.asc },
    })
    expect(themes.map((t) => t.rank)).toEqual([1, 2, 3])
    expect(themes.flatMap((t) => t.members)).toHaveLength(6)
    for (const theme of themes) {
      expect(theme.tag?.status).toBe(IssueTagStatus.proposed)
      expect(theme.tag?.source).toBe(IssueTagSource.synthesis)
      expect(theme.tag?.proposedByRunId).toBe(run.id)
    }
    expect(
      await service.prisma.constituentFeedbackTag.count({
        where: { runId: run.id },
      }),
    ).toBe(6)

    const read = await report()
    expect(read.status).toBe(HttpStatus.OK)
    expect(read.data.run).toMatchObject({
      id: run.id,
      status: 'completed',
      engine: 'mock',
    })
    expect(read.data.themes).toHaveLength(3)
    expect(
      read.data.themes.reduce(
        (n: number, t: { conversationCount: number }) =>
          n + t.conversationCount,
        0,
      ),
    ).toBe(6)
  })

  // Completion is server truth, so the ingest reports it, with counts and
  // ids only: nothing anyone said rides along.
  it('reports a completed run to analytics without what anyone said', async () => {
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' })
    onTestFinished(() => track.mockRestore())
    await seedConfirmed(effort.targets.slice(0, 6))

    const res = await synthesize()
    await flushEngine()

    const calls = track.mock.calls.filter(
      ([, event]) => event === EVENTS.IssueCapture.SynthesisCompleted,
    )
    expect(calls).toEqual([
      [
        service.user.id,
        EVENTS.IssueCapture.SynthesisCompleted,
        {
          scope: 'effort',
          outreachId: effort.outreachId,
          themeCount: 3,
          confirmedCount: 6,
          product: 'serve',
        },
      ],
    ])
    const run = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
      where: { id: res.data.id },
    })
    expect(run.status).toBe(SynthesisRunStatus.completed)
  })

  // A caller re-records a note the next day to fix a mistake, which clears
  // its confirmation. Counts are computed from member rows at read time, so
  // the theme stops counting it on the very next read, with no new run.
  it('drops a re-recorded memo out of the counts without a new run', async () => {
    const memos = await seedConfirmed(effort.targets.slice(0, 5))
    const runId = await completeRun([
      { theme: 'Flooding', memberIds: memos.map((m) => m.memo.id) },
    ])

    const before = await report()
    expect(before.data.themes[0].conversationCount).toBe(5)
    expect(before.data.denominators).toMatchObject({
      confirmed: 5,
      pending: 0,
    })

    vi.spyOn(
      service.app.get(ConstituentFeedbackExtractionService),
      'extract',
    ).mockResolvedValue({
      extraction: {
        issues: [
          {
            issueLabel: 'Street flooding',
            stance: 'opposes',
            desiredOutcome: null,
          },
        ],
        confidence: 0.9,
      },
      model: 'claude-test',
    })
    const rerecorded = await service.client.post(
      '/v1/constituent-feedback',
      {
        channel: 'door_knock',
        knockClientKey: memos[0]!.knockClientKey,
        stopTargetId: effort.targets[0]!.id,
        clientKey: memos[0]!.knockClientKey,
        transcript: 'Correction: it is the drain two houses down.',
        captureMethod: 'dictation',
      },
      ownerHeaders(slug),
    )
    expect(rerecorded.status).toBe(HttpStatus.CREATED)

    const after = await report()
    expect(after.data.run.id).toBe(runId)
    expect(after.data.themes[0].conversationCount).toBe(4)
    expect(after.data.denominators).toMatchObject({
      memos: 5,
      confirmed: 4,
      pending: 1,
    })
    expect(
      await service.prisma.feedbackSynthesisRun.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(1)
  })

  describe('the ingest', () => {
    it('links a theme to the accepted tag with the same name', async () => {
      const accepted = await service.prisma.issueTag.create({
        data: {
          organizationSlug: slug,
          name: 'Street flooding',
          normalizedName: 'street flooding',
          status: IssueTagStatus.accepted,
          source: IssueTagSource.human,
        },
      })
      const memos = await seedConfirmed(effort.targets.slice(0, 5))

      const runId = await completeRun([
        {
          theme: '  Street   Flooding ',
          memberIds: memos.map((m) => m.memo.id),
        },
      ])

      const theme = await service.prisma.feedbackTheme.findFirstOrThrow({
        where: { runId },
      })
      expect(theme.tagId).toBe(accepted.id)
      const tags = await service.prisma.issueTag.findMany({
        where: { organizationSlug: slug },
      })
      expect(tags).toHaveLength(1)
      expect(tags[0]!.status).toBe(IssueTagStatus.accepted)
      const applied = await service.prisma.constituentFeedbackTag.findMany({
        where: { tagId: accepted.id },
      })
      expect(applied).toHaveLength(5)
      expect(applied.every((row) => row.runId === runId)).toBe(true)
    })

    // The normalized name is the uniqueness key, so a proposal matching a
    // retired tag must revive it rather than collide on the index or fork a
    // second row.
    it('revives a retired tag whose name a theme matches, case-insensitively', async () => {
      const retired = await service.prisma.issueTag.create({
        data: {
          organizationSlug: slug,
          name: 'Composting pilot',
          normalizedName: 'composting pilot',
          status: IssueTagStatus.retired,
          source: IssueTagSource.synthesis,
        },
      })
      const memos = await seedConfirmed(effort.targets.slice(0, 5))

      const runId = await completeRun([
        { theme: 'COMPOSTING PILOT', memberIds: memos.map((m) => m.memo.id) },
      ])

      const tags = await service.prisma.issueTag.findMany({
        where: { organizationSlug: slug },
      })
      expect(tags).toHaveLength(1)
      expect(tags[0]!.id).toBe(retired.id)
      expect(tags[0]!.status).toBe(IssueTagStatus.proposed)
      expect(tags[0]!.proposedByRunId).toBe(runId)
      const theme = await service.prisma.feedbackTheme.findFirstOrThrow({
        where: { runId },
      })
      expect(theme.tagId).toBe(retired.id)
    })

    it('keeps an old run’s themes but removes its tagging when superseded', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const ids = memos.map((m) => m.memo.id)
      const firstRunId = await completeRun([
        { theme: 'Flooding', memberIds: ids.slice(0, 3) },
        { theme: 'Speeding near the school', memberIds: ids.slice(3) },
      ])
      // A human accepted one of the first run's proposals; the other was
      // left untouched.
      await service.prisma.issueTag.updateMany({
        where: { organizationSlug: slug, normalizedName: 'flooding' },
        data: { status: IssueTagStatus.accepted },
      })
      await ageCompletedRuns()

      const secondRunId = await completeRun([
        { theme: 'Flooding', memberIds: ids },
      ])

      const first = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: firstRunId } },
      )
      expect(first.status).toBe(SynthesisRunStatus.superseded)
      expect(
        await service.prisma.feedbackTheme.count({
          where: { runId: firstRunId },
        }),
      ).toBe(2)
      expect(
        await service.prisma.constituentFeedbackTag.count({
          where: { runId: firstRunId },
        }),
      ).toBe(0)
      const tags = await service.prisma.issueTag.findMany({
        where: { organizationSlug: slug },
      })
      expect(tags.map((t) => t.normalizedName)).toEqual(['flooding'])

      const second =
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: secondRunId },
        })
      expect(second.status).toBe(SynthesisRunStatus.completed)
      expect(
        await service.prisma.constituentFeedbackTag.count({
          where: { runId: secondRunId },
        }),
      ).toBe(5)

      const read = await report()
      expect(read.data.run.id).toBe(secondRunId)
      expect(read.data.themes).toHaveLength(1)
    })

    // Relinking a proposal to the run that repeats it is not a human
    // touching it, so it still goes once a later run stops proposing it.
    it('drops a carried-over proposal once no run makes it', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const ids = memos.map((m) => m.memo.id)
      await completeRun([{ theme: 'Potholes', memberIds: ids }])
      await ageCompletedRuns()
      const secondRunId = await completeRun([
        { theme: 'Potholes', memberIds: ids },
      ])
      const carried = await service.prisma.issueTag.findFirstOrThrow({
        where: { organizationSlug: slug, normalizedName: 'potholes' },
      })
      expect(carried.proposedByRunId).toBe(secondRunId)
      await ageCompletedRuns()

      await completeRun([{ theme: 'Flooding', memberIds: ids }])

      expect(
        await service.prisma.issueTag.count({
          where: { organizationSlug: slug, normalizedName: 'potholes' },
        }),
      ).toBe(0)
    })

    // A dismissed proposal a later run raises again is that run's proposal,
    // untouched since, so it goes like any other once no run makes it. A
    // tag a person typed is not a run's to delete.
    it('drops a revived proposal once no run makes it', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const ids = memos.map((m) => m.memo.id)
      const typed = await service.prisma.issueTag.create({
        data: {
          organizationSlug: slug,
          name: 'Bike lanes',
          normalizedName: 'bike lanes',
          status: IssueTagStatus.retired,
          source: IssueTagSource.human,
        },
      })
      await completeRun([{ theme: 'Potholes', memberIds: ids }])
      const potholes = await service.prisma.issueTag.findFirstOrThrow({
        where: { organizationSlug: slug, normalizedName: 'potholes' },
      })
      const dismissed = await service.client.patch(
        `/v1/constituent-feedback/tags/${potholes.id}`,
        { action: 'retire' },
        ownerHeaders(slug),
      )
      expect(dismissed.status).toBe(HttpStatus.OK)
      await ageCompletedRuns()
      const secondRunId = await completeRun([
        { theme: 'Potholes', memberIds: ids.slice(0, 3) },
        { theme: 'Bike lanes', memberIds: ids.slice(3) },
      ])
      expect(
        await service.prisma.issueTag.findUniqueOrThrow({
          where: { id: potholes.id },
        }),
      ).toMatchObject({
        status: IssueTagStatus.proposed,
        proposedByRunId: secondRunId,
      })
      await ageCompletedRuns()

      await completeRun([{ theme: 'Flooding', memberIds: ids }])

      expect(
        await service.prisma.issueTag.count({ where: { id: potholes.id } }),
      ).toBe(0)
      expect(
        await service.prisma.issueTag.count({ where: { id: typed.id } }),
      ).toBe(1)
    })

    // A run never overwrites a human's row for the same pair, and
    // superseding deletes only rows carrying the run's own id.
    it('leaves a human’s tag on a memo through a re-run', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const ids = memos.map((m) => m.memo.id)
      const tag = await service.prisma.issueTag.create({
        data: {
          organizationSlug: slug,
          name: 'Flooding',
          normalizedName: 'flooding',
          status: IssueTagStatus.accepted,
          source: IssueTagSource.human,
        },
      })
      await service.prisma.constituentFeedbackTag.create({
        data: { feedbackId: ids[0]!, tagId: tag.id, runId: null },
      })

      await completeRun([{ theme: 'Flooding', memberIds: ids }])
      await ageCompletedRuns()
      await completeRun([{ theme: 'Flooding', memberIds: ids.slice(1) }])

      const human =
        await service.prisma.constituentFeedbackTag.findUniqueOrThrow({
          where: {
            feedbackId_tagId: { feedbackId: ids[0]!, tagId: tag.id },
          },
        })
      expect(human.runId).toBeNull()
    })

    it('drops respondents outside the run’s effort', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const elsewhere = await seedTurfEffort(service, slug, { people: 1 })
      const stranger = await seedKnockMemo(service, {
        slug,
        outreachId: elsewhere.outreachId,
        personId: elsewhere.targets[0]!.personId,
      })

      const runId = await completeRun([
        {
          theme: 'Flooding',
          memberIds: [...memos.map((m) => m.memo.id), stranger.memo.id],
        },
      ])

      const members = await service.prisma.feedbackThemeMember.findMany({
        where: { theme: { runId } },
      })
      expect(members.map((m) => m.feedbackId)).not.toContain(stranger.memo.id)
      expect(members).toHaveLength(5)
    })

    // The real pipeline lists every respondent in its S3 rows; the event
    // only quotes a few. Members come from the rows.
    it('reads members from the pipeline’s S3 rows when it names them', async () => {
      vi.stubEnv('SERVE_ANALYSIS_BUCKET_NAME', 'serve-analyze-test')
      onTestFinished(() => {
        vi.unstubAllEnvs()
      })
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const ids = memos.map((m) => m.memo.id)
      const getFile = vi
        .spyOn(service.app.get(S3Service), 'getFile')
        .mockResolvedValue(
          JSON.stringify([
            ...ids.slice(0, 3).map((id) => ({ respondent_id: id, theme: 'A' })),
            ...ids.slice(3).map((id) => ({ respondent_id: id, theme: 'B' })),
            { respondent_id: ids[0], theme: '' },
          ]),
        )
      onTestFinished(() => getFile.mockRestore())

      const res = await synthesize()
      scheduled.splice(0)
      const event = completionEvent(res.data.id, [
        { theme: 'A', memberIds: [] },
        { theme: 'B', memberIds: [] },
      ])
      await ingest().handle({
        ...event,
        data: {
          ...event.data,
          responsesLocation: `output/feedback/${res.data.id}.json`,
        },
      })

      expect(getFile).toHaveBeenCalledWith(
        'serve-analyze-test',
        `output/feedback/${res.data.id}.json`,
      )
      const themes = await service.prisma.feedbackTheme.findMany({
        where: { runId: res.data.id },
        include: { members: true },
        orderBy: { rank: Prisma.SortOrder.asc },
      })
      expect(themes.map((t) => t.members.length)).toEqual([3, 2])
    })

    // An engine that names nobody in scope would otherwise supersede a good
    // run with an empty one.
    it('fails a run with no members in scope and keeps the previous themes', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const firstRunId = await completeRun([
        { theme: 'Flooding', memberIds: memos.map((m) => m.memo.id) },
      ])
      await ageCompletedRuns()
      const elsewhere = await seedTurfEffort(service, slug, { people: 1 })
      const stranger = await seedKnockMemo(service, {
        slug,
        outreachId: elsewhere.outreachId,
        personId: elsewhere.targets[0]!.personId,
      })

      const secondRunId = await completeRun([
        { theme: 'Potholes', memberIds: [stranger.memo.id, randomUUID()] },
      ])

      const second =
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: secondRunId },
        })
      expect(second).toMatchObject({
        status: SynthesisRunStatus.failed,
        error: 'no_members_in_scope',
        activeKey: null,
      })
      expect(
        await service.prisma.feedbackTheme.count({
          where: { runId: secondRunId },
        }),
      ).toBe(0)
      const first = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: firstRunId } },
      )
      expect(first.status).toBe(SynthesisRunStatus.completed)
      expect(
        await service.prisma.constituentFeedbackTag.count({
          where: { runId: firstRunId },
        }),
      ).toBe(5)
      const read = await report()
      expect(read.data.run).toMatchObject({ id: secondRunId, status: 'failed' })
      expect(read.data.themes.map((t: { title: string }) => t.title)).toEqual([
        'Flooding',
      ])
    })

    it('ignores an event for a run that is no longer running', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const runId = await completeRun([
        { theme: 'Flooding', memberIds: memos.map((m) => m.memo.id) },
      ])

      await ingest().handle(
        completionEvent(runId, [
          { theme: 'Something else', memberIds: [memos[0]!.memo.id] },
        ]),
      )

      expect(
        await service.prisma.feedbackTheme.count({ where: { runId } }),
      ).toBe(1)
    })
  })

  describe('the report', () => {
    // Under the floor and while a run is in flight there are no themes to
    // show, so the report lists the memos themselves, pending ones included
    // and told apart by confirmedAt.
    it('lists the effort’s memos newest first, pending included', async () => {
      const [a, b, c] = effort.targets
      const older = await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: a!.personId,
        desiredOutcome: 'Clear the drain',
      })
      const newer = await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: b!.personId,
        confirmed: false,
        stance: null,
      })
      await service.prisma.constituentFeedback.update({
        where: { id: older.memo.id },
        data: { occurredAt: subMinutes(new Date(), 30) },
      })
      const elsewhere = await seedTurfEffort(service, slug, { people: 1 })
      await seedKnockMemo(service, {
        slug,
        outreachId: elsewhere.outreachId,
        personId: c!.personId,
      })

      const res = await report()

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.memos).toEqual([
        {
          id: newer.memo.id,
          personId: b!.personId,
          occurredAt: expect.any(String),
          channel: 'door_knock',
          transcript: newer.memo.transcript,
          issues: [
            {
              id: expect.any(String),
              position: 0,
              issueLabel: 'Street flooding',
              stance: null,
              desiredOutcome: null,
            },
          ],
          actorName: 'Johnny Goodparty',
          confirmedAt: null,
        },
        {
          id: older.memo.id,
          personId: a!.personId,
          occurredAt: expect.any(String),
          channel: 'door_knock',
          transcript: older.memo.transcript,
          issues: [
            {
              id: expect.any(String),
              position: 0,
              issueLabel: 'Street flooding',
              stance: 'opposes',
              desiredOutcome: 'Clear the drain',
            },
          ],
          actorName: 'Johnny Goodparty',
          confirmedAt: expect.any(String),
        },
      ])
    })

    it('caps the memo list at the newest 200', async () => {
      const now = new Date()
      const total = FEEDBACK_REPORT_MEMO_LIMIT + 5
      await service.prisma.constituentFeedback.createMany({
        data: Array.from({ length: total }, (_, i) => ({
          organizationSlug: slug,
          personId: randomUUID(),
          occurredAt: subMinutes(now, i),
          actorUserId: service.user.id,
          channel: ConstituentFeedbackChannel.door_knock,
          transcript: `Memo ${i}`,
          captureMethod: ConstituentFeedbackCaptureMethod.typed,
          extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
          confirmedAt: now,
          clientKey: randomUUID(),
          outreachId: effort.outreachId,
        })),
      })

      const res = await report()

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.memos).toHaveLength(FEEDBACK_REPORT_MEMO_LIMIT)
      expect(res.data.memos[0].transcript).toBe('Memo 0')
      expect(res.data.memos.at(-1).transcript).toBe(
        `Memo ${FEEDBACK_REPORT_MEMO_LIMIT - 1}`,
      )
      expect(res.data.denominators.memos).toBe(total)
    })

    it('counts distinct people who answered, not knocks', async () => {
      const [a, b, c] = effort.targets
      // A corrected re-knock on the same person is one conversation.
      await knock(service, {
        slug,
        outreachId: effort.outreachId,
        personId: a!.personId,
      })
      await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: a!.personId,
        desiredOutcome: 'Clear the drain',
      })
      await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: b!.personId,
        confirmed: false,
      })
      await knock(service, {
        slug,
        outreachId: effort.outreachId,
        personId: c!.personId,
        outcome: DoorKnockOutcome.not_home,
      })
      // An answered knock on another effort, and one with no effort.
      const other = await seedTurfEffort(service, slug, { people: 1 })
      await knock(service, {
        slug,
        outreachId: other.outreachId,
        personId: other.targets[0]!.personId,
      })
      await knock(service, {
        slug,
        outreachId: null,
        personId: c!.personId,
      })

      const res = await report()

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data).toEqual({
        question: 'What should the city fix first?',
        channel: ConstituentFeedbackChannel.door_knock,
        floor: 5,
        denominators: { conversations: 2, memos: 2, confirmed: 1, pending: 1 },
        run: null,
        themes: [],
        memos: [expect.any(Object), expect.any(Object)],
      })
    })

    it('counts answered calls on a phone list by person', async () => {
      const phone = await seedPhoneEffort(service, slug, {
        question: 'Would you join a compost pilot?',
        people: 3,
      })
      const [a, b, c] = phone.entries
      const answered = await call(service, {
        slug,
        listId: phone.listId,
        personId: a!.personId,
      })
      await seedCallMemo(service, {
        slug,
        outreachId: phone.outreachId,
        phoneBankingInteractionId: answered.id,
        personId: a!.personId,
      })
      await call(service, {
        slug,
        listId: phone.listId,
        personId: b!.personId,
      })
      await call(service, {
        slug,
        listId: phone.listId,
        personId: c!.personId,
        outcome: PhoneBankCallOutcome.voicemail,
      })

      const res = await report(phone.outreachId)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.question).toBe('Would you join a compost pilot?')
      expect(res.data.channel).toBe(ConstituentFeedbackChannel.phone_bank)
      expect(res.data.denominators).toEqual({
        conversations: 2,
        memos: 1,
        confirmed: 1,
        pending: 0,
      })
    })

    it('tallies stances and outcomes from confirmed members only', async () => {
      const stances = [
        ConstituentFeedbackStance.supports,
        ConstituentFeedbackStance.supports,
        ConstituentFeedbackStance.opposes,
        ConstituentFeedbackStance.mixed,
        null,
      ]
      const memos = []
      for (const [i, stance] of stances.entries()) {
        memos.push(
          await seedKnockMemo(service, {
            slug,
            outreachId: effort.outreachId,
            personId: effort.targets[i]!.personId,
            stance,
            desiredOutcome: i < 2 ? `Outcome ${i}` : null,
          }),
        )
      }
      const runId = await completeRun([
        { theme: 'Flooding', memberIds: memos.map((m) => m.memo.id) },
      ])

      const res = await report()
      expect(res.data.themes).toEqual([
        expect.objectContaining({
          rank: 1,
          title: 'Flooding',
          summary: 'Flooding summary',
          conversationCount: 5,
          stanceCounts: { supports: 2, opposes: 1, mixed: 1, unclear: 1 },
          desiredOutcomes: expect.arrayContaining(['Outcome 0', 'Outcome 1']),
          tag: expect.objectContaining({
            name: 'Flooding',
            status: 'proposed',
          }),
        }),
      ])

      const themeId = res.data.themes[0].id
      const detail = await service.client.get(
        `/v1/constituent-feedback/themes/${themeId}`,
        ownerHeaders(slug),
      )
      expect(detail.status).toBe(HttpStatus.OK)
      expect(detail.data.details).toBe('Flooding analysis')
      expect(detail.data.members).toHaveLength(5)
      expect(detail.data.members[0]).toEqual(
        expect.objectContaining({
          feedbackId: expect.any(String),
          personId: expect.any(String),
          channel: 'door_knock',
          transcript: expect.any(String),
          actorName: 'Johnny Goodparty',
        }),
      )
      expect(runId).toBe(res.data.run.id)
    })

    // Membership is per conversation, but a stance belongs to an issue. A
    // conversation that raised only this theme's issue counts whatever it
    // was labelled; one that raised several counts only the issue matching
    // the theme's tag, so its other issues cannot leak into this split.
    it('counts a several-issue memo only by the issue matching the theme', async () => {
      const { opposes, supports, mixed } = ConstituentFeedbackStance
      const issue = (
        issueLabel: string,
        stance: ConstituentFeedbackStance,
        desiredOutcome: string | null = null,
      ) => ({ issueLabel, stance, desiredOutcome })
      const shapes = [
        [
          issue('Street flooding', opposes, 'Clear the drain'),
          issue('Property taxes', supports, 'A freeze for seniors'),
        ],
        [issue('  street   FLOODING ', opposes), issue('Parks', supports)],
        [issue('Street flooding', supports)],
        [issue('Potholes', mixed, 'Fill the potholes')],
        [issue('Street flooding', opposes)],
      ]
      const memos: Array<Awaited<ReturnType<typeof seedKnockMemo>>> = []
      for (const [i, issues] of shapes.entries()) {
        memos.push(
          await seedKnockMemo(service, {
            slug,
            outreachId: effort.outreachId,
            personId: effort.targets[i]!.personId,
            issues,
          }),
        )
      }
      const runId = await completeRun([
        { theme: 'Street flooding', memberIds: memos.map((m) => m.memo.id) },
      ])

      const res = await report()

      expect(res.data.themes[0]).toEqual(
        expect.objectContaining({
          conversationCount: 5,
          stanceCounts: { supports: 1, opposes: 3, mixed: 1, unclear: 0 },
          desiredOutcomes: ['Clear the drain', 'Fill the potholes'],
        }),
      )
      const detail = await service.client.get(
        `/v1/constituent-feedback/themes/${res.data.themes[0].id}`,
        ownerHeaders(slug),
      )
      expect(detail.data.stanceCounts).toEqual({
        supports: 1,
        opposes: 3,
        mixed: 1,
        unclear: 0,
      })
      // The member still lists every issue it raised.
      const twoIssues = detail.data.members.find(
        (member: { feedbackId: string }) =>
          member.feedbackId === memos[0]!.memo.id,
      )
      expect(
        twoIssues.issues.map((i: { issueLabel: string }) => i.issueLabel),
      ).toEqual(['Street flooding', 'Property taxes'])

      // With no tag there is nothing to match, so only the memos that
      // raised one issue count.
      await service.prisma.feedbackTheme.updateMany({
        where: { runId },
        data: { tagId: null },
      })
      const untagged = await report()
      expect(untagged.data.themes[0].stanceCounts).toEqual({
        supports: 1,
        opposes: 1,
        mixed: 1,
        unclear: 0,
      })
    })

    it('404s a theme from another org', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const runId = await completeRun([
        { theme: 'Flooding', memberIds: memos.map((m) => m.memo.id) },
      ])
      const theme = await service.prisma.feedbackTheme.findFirstOrThrow({
        where: { runId },
      })
      const otherSlug = await createServeOrg(service)

      const res = await service.client.get(
        `/v1/constituent-feedback/themes/${theme.id}`,
        ownerHeaders(otherSlug),
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('404s an effort from another org', async () => {
      const otherSlug = await createServeOrg(service)

      expect((await report(effort.outreachId, otherSlug)).status).toBe(
        HttpStatus.NOT_FOUND,
      )
      expect((await synthesize(effort.outreachId, otherSlug)).status).toBe(
        HttpStatus.NOT_FOUND,
      )
    })
  })

  describe('access', () => {
    it('404s every route when the org’s flag is off', async () => {
      const spy = vi
        .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
        .mockResolvedValue(false)
      onTestFinished(() => spy.mockRestore())

      expect((await report()).status).toBe(HttpStatus.NOT_FOUND)
      expect((await synthesize()).status).toBe(HttpStatus.NOT_FOUND)
      expect(
        (
          await service.client.get(
            '/v1/constituent-feedback/tags',
            ownerHeaders(slug),
          )
        ).status,
      ).toBe(HttpStatus.NOT_FOUND)
    })

    it('keeps volunteers off the report and the synthesize button', async () => {
      const win = await createWinOrg(service)
      const winEffort = await seedTurfEffort(service, win.slug)
      const label = `syn-volunteer-${randomUUID()}`
      await service.prisma.user.create({
        data: { email: `${label}@example.com`, clerkId: `user_${label}` },
      })
      const user = await service.prisma.user.findUniqueOrThrow({
        where: { clerkId: `user_${label}` },
      })
      await service.prisma.organizationMembership.create({
        data: {
          organizationSlug: win.slug,
          userId: user.id,
          role: OrganizationRole.volunteer,
        },
      })
      const token = jwt.sign(
        { sub: `user_${label}` },
        process.env.AUTH_SECRET!,
        { expiresIn: '1h' },
      )
      const config = {
        headers: {
          'x-organization-slug': win.slug,
          Authorization: `Bearer ${token}`,
        },
        validateStatus: () => true,
      }

      const read = await service.client.get(
        `/v1/constituent-feedback/efforts/${winEffort.outreachId}/report`,
        config,
      )
      const run = await service.client.post(
        `/v1/constituent-feedback/efforts/${winEffort.outreachId}/synthesize`,
        {},
        config,
      )

      expect(read.status).toBe(HttpStatus.FORBIDDEN)
      expect(run.status).toBe(HttpStatus.FORBIDDEN)

      const others = await Promise.all([
        service.client.get(
          `/v1/constituent-feedback/themes/${randomUUID()}`,
          config,
        ),
        service.client.get('/v1/constituent-feedback/tags', config),
        service.client.patch(
          `/v1/constituent-feedback/tags/${randomUUID()}`,
          { action: 'accept' },
          config,
        ),
        service.client.post(
          '/v1/constituent-feedback/seed',
          { outreachId: winEffort.outreachId, count: 5 },
          config,
        ),
      ])
      expect(others.map((res) => res.status)).toEqual([
        HttpStatus.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        HttpStatus.FORBIDDEN,
      ])
      expect(
        await service.prisma.constituentFeedback.count({
          where: { organizationSlug: win.slug },
        }),
      ).toBe(0)
    })
  })

  // On Win the first run seeds the tag list from the candidate's declared
  // positions, by the specific position rather than its category.
  it('seeds a Win org’s accepted tags from its positions before its first run', async () => {
    const win = await createWinOrg(service)
    const topIssue = await service.prisma.topIssue.create({
      data: { name: `Parks ${randomUUID()}` },
    })
    const position = await service.prisma.position.create({
      data: {
        name: `Expand the splash pad ${randomUUID()}`,
        topIssueId: topIssue.id,
      },
    })
    await service.prisma.campaignPosition.create({
      data: { campaignId: win.campaignId, positionId: position.id },
    })
    const winEffort = await seedTurfEffort(service, win.slug)
    for (const target of winEffort.targets.slice(0, 5)) {
      await seedKnockMemo(service, {
        slug: win.slug,
        outreachId: winEffort.outreachId,
        personId: target.personId,
      })
    }

    const res = await synthesize(winEffort.outreachId, win.slug)

    expect(res.status).toBe(HttpStatus.CREATED)
    const tags = await service.prisma.issueTag.findMany({
      where: { organizationSlug: win.slug },
    })
    expect(tags).toEqual([
      expect.objectContaining({
        name: position.name,
        normalizedName: position.name.toLowerCase(),
        status: IssueTagStatus.accepted,
        source: IssueTagSource.seed,
        declaredTopIssueId: topIssue.id,
      }),
    ])
  })

  describe('when an effort completes', () => {
    // The trigger is fire-and-forget after the response, so the run row
    // lands a moment later. Absence is checked over a shorter window.
    const waitForRun = async (
      orgSlug: string,
      attempts = 50,
      where: Prisma.FeedbackSynthesisRunWhereInput = {},
    ) => {
      for (let i = 0; i < attempts; i++) {
        const run = await service.prisma.feedbackSynthesisRun.findFirst({
          where: { ...where, organizationSlug: orgSlug },
        })
        if (run !== null) return run
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return null
    }

    it('starts a run when the turf is completed', async () => {
      await seedConfirmed(effort.targets.slice(0, 5))

      const res = await service.client.post(
        `/v1/door-knocking/turfs/${effort.turfId}/complete`,
        {},
        ownerHeaders(slug),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      const run = await waitForRun(slug)
      expect(run).toMatchObject({
        outreachId: effort.outreachId,
        status: SynthesisRunStatus.running,
        requestedByUserId: null,
      })
    })

    // The cooldown is a brake on the button. An effort finishing is when
    // its report matters most, so the trigger does not wait it out.
    it('starts a run on completion inside the button’s cooldown', async () => {
      const memos = await seedConfirmed(effort.targets.slice(0, 5))
      const firstRunId = await completeRun([
        { theme: 'Flooding', memberIds: memos.map((m) => m.memo.id) },
      ])
      expect((await synthesize()).status).toBe(HttpStatus.TOO_MANY_REQUESTS)

      const res = await service.client.post(
        `/v1/door-knocking/turfs/${effort.turfId}/complete`,
        {},
        ownerHeaders(slug),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      const run = await waitForRun(slug, 50, { id: { not: firstRunId } })
      expect(run).toMatchObject({
        outreachId: effort.outreachId,
        status: SynthesisRunStatus.running,
        requestedByUserId: null,
      })
    })

    it('starts a run when the last call on the list is logged', async () => {
      const phone = await seedPhoneEffort(service, slug, { people: 6 })
      for (const entry of phone.entries.slice(0, 5)) {
        const logged = await service.client.post(
          `/v1/phone-banking/lists/${phone.listId}/calls`,
          { entryId: entry.id, outcome: 'answered', personId: entry.personId },
          ownerHeaders(slug),
        )
        expect(logged.status).toBe(HttpStatus.CREATED)
        const row =
          await service.prisma.contactInteractionPhoneBanking.findFirstOrThrow({
            where: {
              phoneBankingListId: phone.listId,
              personId: entry.personId,
            },
          })
        await seedCallMemo(service, {
          slug,
          outreachId: phone.outreachId,
          phoneBankingInteractionId: row.id,
          personId: entry.personId,
        })
      }
      expect(await waitForRun(slug, 5)).toBeNull()

      const last = phone.entries[5]!
      const res = await service.client.post(
        `/v1/phone-banking/lists/${phone.listId}/calls`,
        { entryId: last.id, outcome: 'answered', personId: last.personId },
        ownerHeaders(slug),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.envelopeCompleted).toBe(true)
      const run = await waitForRun(slug)
      expect(run?.outreachId).toBe(phone.outreachId)
    })

    it('starts nothing when the effort is under the floor', async () => {
      await seedConfirmed(effort.targets.slice(0, 2))

      const res = await service.client.post(
        `/v1/door-knocking/turfs/${effort.turfId}/complete`,
        {},
        ownerHeaders(slug),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      const envelope = await service.prisma.outreach.findUniqueOrThrow({
        where: { id: effort.outreachId },
      })
      expect(envelope.status).toBe(OutreachStatus.completed)
      expect(await waitForRun(slug, 10)).toBeNull()
    })

    // Every turf a campaign's Done flips is an effort of its own.
    it('starts a run for each turf a campaign completion finishes', async () => {
      await seedConfirmed(effort.targets.slice(0, 5))
      const sibling = await seedTurfEffort(service, slug, { people: 5 })
      await service.prisma.outreach.update({
        where: { id: sibling.outreachId },
        data: { campaignOutreachId: effort.outreachId },
      })
      for (const target of sibling.targets) {
        await seedKnockMemo(service, {
          slug,
          outreachId: sibling.outreachId,
          personId: target.personId,
        })
      }

      const res = await service.client.post(
        `/v1/door-knocking/campaigns/${effort.outreachId}/complete`,
        {},
        ownerHeaders(slug),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      let runs: Array<{ outreachId: number | null }> = []
      for (let i = 0; i < 50 && runs.length < 2; i++) {
        runs = await service.prisma.feedbackSynthesisRun.findMany({
          where: { organizationSlug: slug },
          select: { outreachId: true },
        })
        if (runs.length < 2) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
      expect(runs.map((run) => run.outreachId).sort()).toEqual(
        [effort.outreachId, sibling.outreachId].sort(),
      )
    })

    // The routes are gated per request; the trigger has no request, so it
    // asks the flag itself. Turning the product off stops automatic runs.
    it('starts nothing when the org’s flag is off', async () => {
      const flags = vi
        .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
        .mockImplementation(
          async ({ feature }) => feature !== 'serve-issue-capture',
        )
      onTestFinished(() => flags.mockRestore())
      await seedConfirmed(effort.targets.slice(0, 5))

      const res = await service.client.post(
        `/v1/door-knocking/turfs/${effort.turfId}/complete`,
        {},
        ownerHeaders(slug),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      const asked = async () =>
        flags.mock.calls.some(
          ([params]) =>
            params.feature === 'serve-issue-capture' &&
            params.user === service.user.id,
        )
      for (let i = 0; i < 50 && !(await asked()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(await asked()).toBe(true)
      expect(await waitForRun(slug, 10)).toBeNull()
    })
  })
})
