import {
  HttpStatus,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { PriorityResults } from '@goodparty_org/contracts'
import {
  OutreachStatus,
  PrioritySource,
  SynthesisRunStatus,
  SynthesisScope,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { FeedbackSynthesisService } from '../services/feedbackSynthesis.service'
import { FeedbackSynthesisIngestService } from '../services/feedbackSynthesisIngest.service'
import { MockSynthesisEngine } from '../services/mockSynthesisEngine'
import { PriorityFlowOutreachService } from '@/chats/general/priority-flow/services/priorityFlowOutreach.service'
import { SynthesisStaleRunSweepService } from '../services/synthesisStaleRunSweep.service'
import {
  completionEvent,
  createServeOrg,
  ownerHeaders,
  seedKnockMemo,
  seedReply,
  seedTextEffort,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService()

const engine = () => service.app.get(MockSynthesisEngine)
const synthesis = () => service.app.get(FeedbackSynthesisService)
const ingest = () => service.app.get(FeedbackSynthesisIngestService)

let scheduled: Array<Parameters<MockSynthesisEngine['scheduleCompletion']>>

// Every send for one priority, texts and doors together, read as one
// answer. Each new run replaces the last, so the themes keep up as sends
// finish.
// Slots the real every-ten-minutes @Cron in the test app never claims. With
// sweep(new Date()), a test that crossed a ten-minute boundary lost the slot
// to that cron and its sweep did nothing. No run is old enough to count as
// stale against them, so only the re-pool half of the sweep acts.
const SWEEP_SLOT_A = new Date('2001-01-01T00:00:00Z')
const SWEEP_SLOT_B = new Date('2001-01-01T01:00:00Z')

describe('feedback synthesis across a priority', () => {
  let slug: string
  let priorityId: string
  let textId: number
  let turf: Awaited<ReturnType<typeof seedTurfEffort>>

  const createPriority = async (title: string) => {
    const office = await service.prisma.electedOffice.findFirstOrThrow({
      where: { organizationSlug: slug },
    })
    return (
      await service.prisma.priority.create({
        data: {
          electedOfficeId: office.id,
          title,
          description: title,
          source: PrioritySource.user_stated,
        },
      })
    ).id
  }

  const replies = (count: number, outreachId = textId) =>
    Promise.all(
      Array.from({ length: count }, (_, i) =>
        seedReply(service, {
          outreachId,
          content: `The drain on Oak backs up, reply ${i}.`,
        }),
      ),
    )

  const notes = (count: number) =>
    Promise.all(
      turf.targets.slice(0, count).map((target) =>
        seedKnockMemo(service, {
          slug,
          outreachId: turf.outreachId,
          personId: target.personId,
        }),
      ),
    )

  const run = () =>
    synthesis().requestPriorityRun({
      organizationSlug: slug,
      priorityId,
      requestedByUserId: service.user.id,
    })

  const results = () =>
    service.client.get<PriorityResults>(
      `/v1/priorities/${priorityId}/results`,
      ownerHeaders(slug),
    )

  beforeEach(async () => {
    scheduled = []
    const spy = vi
      .spyOn(engine(), 'scheduleCompletion')
      .mockImplementation((...args) => {
        scheduled.push(args)
      })
    onTestFinished(() => spy.mockRestore())
    vi.spyOn(
      service.app.get(ContactsService),
      'pointsForPeople',
    ).mockResolvedValue({ points: [], truncated: false })

    slug = await createServeOrg(service)
    priorityId = await createPriority('Oak Street flooding')
    textId = (await seedTextEffort(service, slug)).id
    turf = await seedTurfEffort(service, slug)
    await service.prisma.outreach.updateMany({
      where: { id: { in: [textId, turf.outreachId] } },
      data: { priorityId },
    })
  })

  it("hands the engine every send's answers together", async () => {
    const texted = await replies(3)
    const knocked = await notes(2)

    const started = await run()

    expect(started.status).toBe(SynthesisRunStatus.running)
    const handed = scheduled[0]![1].map((memo) => memo.id).sort()
    expect(handed).toEqual(
      [...texted.map((r) => r.id), ...knocked.map((n) => n.memo.id)].sort(),
    )
    const row = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
      where: { id: started.id },
    })
    expect(row).toMatchObject({
      scope: SynthesisScope.priority,
      priorityId,
      outreachId: null,
      confirmed: 5,
    })
  })

  it('refuses under the floor even when each send is under it alone', async () => {
    await replies(2)
    await notes(2)

    await expect(run()).rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('leaves out sends that have not gone out or belong to another priority', async () => {
    await replies(5)
    const other = await seedTextEffort(service, slug)
    await service.prisma.outreach.update({
      where: { id: other.id },
      data: { priorityId: await createPriority('Parks') },
    })
    await replies(4, other.id)
    const draft = await seedTextEffort(service, slug)
    await service.prisma.outreach.update({
      where: { id: draft.id },
      data: { priorityId, status: OutreachStatus.pending_payment },
    })
    await replies(4, draft.id)

    await run()

    expect(scheduled[0]![1]).toHaveLength(5)
  })

  it('writes themes with no tags, and drops members from other priorities', async () => {
    const texted = await replies(3)
    const knocked = await notes(2)
    const stray = await seedTextEffort(service, slug)
    const [strayReply] = await replies(1, stray.id)
    const started = await run()

    await ingest().handle(
      completionEvent(started.id, [
        {
          theme: 'Drains back up',
          memberIds: [
            ...texted.map((r) => r.id),
            knocked[0]!.memo.id,
            strayReply!.id,
          ],
        },
        { theme: 'Street closes', memberIds: [knocked[1]!.memo.id] },
      ]),
    )

    const themes = await service.prisma.feedbackTheme.findMany({
      where: { runId: started.id },
      include: { members: true },
      orderBy: { rank: 'asc' },
    })
    expect(themes.map((theme) => theme.members.length)).toEqual([4, 1])
    expect(themes.every((theme) => theme.tagId === null)).toBe(true)
    expect(
      await service.prisma.constituentFeedbackTag.count({
        where: { runId: started.id },
      }),
    ).toBe(0)
    expect(
      await service.prisma.issueTag.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(0)
  })

  it('replaces the last pooled run and shows its themes in the results', async () => {
    const texted = await replies(4)
    await service.prisma.pollIndividualMessage.create({
      data: {
        id: crypto.randomUUID(),
        outreachId: textId,
        personId: texted[0]!.personId,
        sentAt: new Date(),
        isOptOut: false,
        sender: texted[0]!.sender,
        content: 'And again last night.',
      },
    })
    const knocked = await notes(1)
    const first = await run()
    await ingest().handle(
      completionEvent(first.id, [
        { theme: 'Old theme', memberIds: texted.map((r) => r.id) },
      ]),
    )
    const second = await run()
    const again = await service.prisma.pollIndividualMessage.findFirstOrThrow({
      where: { content: 'And again last night.' },
    })
    await ingest().handle(
      completionEvent(second.id, [
        {
          theme: 'Drains back up',
          memberIds: [texted[0]!.id, again.id, knocked[0]!.memo.id],
        },
      ]),
    )

    expect(
      (
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).status,
    ).toBe(SynthesisRunStatus.superseded)
    const res = await results()
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.summarizing).toBe(false)
    // Three members, two people: one texted twice.
    expect(res.data.themes).toEqual([
      expect.objectContaining({ title: 'Drains back up', people: 2 }),
    ])
    // The agent's read counts people the same way.
    expect(
      await service.app
        .get(PriorityFlowOutreachService)
        .pooledThemes(slug, priorityId),
    ).toEqual([expect.objectContaining({ title: 'Drains back up', people: 2 })])
  })

  it('pools again once a run in flight is done when another send finished under it', async () => {
    const texted = await replies(5)
    const first = await run()

    await expect(run()).rejects.toMatchObject({ status: HttpStatus.CONFLICT })
    expect(
      (
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).repoolOwed,
    ).toBe(true)

    await ingest().handle(
      completionEvent(first.id, [
        { theme: 'Drains back up', memberIds: texted.map((r) => r.id) },
      ]),
    )
    await service.app.get(SynthesisStaleRunSweepService).sweep(SWEEP_SLOT_A)

    const runs = await service.prisma.feedbackSynthesisRun.findMany({
      where: { priorityId, scope: SynthesisScope.priority },
      orderBy: { createdAt: 'asc' },
    })
    expect(runs.map((row) => [row.status, row.repoolOwed])).toEqual([
      [SynthesisRunStatus.completed, false],
      [SynthesisRunStatus.running, false],
    ])
  })

  it('keeps a re-pool owed when starting it fails unexpectedly', async () => {
    const texted = await replies(5)
    const first = await run()
    await expect(run()).rejects.toMatchObject({ status: HttpStatus.CONFLICT })
    await ingest().handle(
      completionEvent(first.id, [
        { theme: 'Drains back up', memberIds: texted.map((r) => r.id) },
      ]),
    )
    const failing = vi
      .spyOn(synthesis(), 'requestPriorityRun')
      .mockRejectedValueOnce(new InternalServerErrorException())
    onTestFinished(() => failing.mockRestore())

    await service.app.get(SynthesisStaleRunSweepService).sweep(SWEEP_SLOT_B)

    expect(
      (
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).repoolOwed,
    ).toBe(true)
  })

  it('counts the people a theme covers by one rule on every path', async () => {
    const texted = await replies(3)
    const again = await service.prisma.pollIndividualMessage.create({
      data: {
        id: crypto.randomUUID(),
        outreachId: textId,
        personId: texted[0]!.personId,
        sentAt: new Date(),
        isOptOut: false,
        sender: texted[0]!.sender,
        content: 'And again last night.',
      },
    })
    const knocked = await notes(2)
    const textMembers = [...texted.map((r) => r.id), again.id]
    const noteMembers = knocked.map((n) => n.memo.id)

    const pooled = await run()
    await ingest().handle(
      completionEvent(pooled.id, [
        {
          theme: 'Drains back up',
          memberIds: [...textMembers, ...noteMembers],
        },
      ]),
    )
    const effortRun = async (outreachId: number, memberIds: string[]) => {
      const row = await service.prisma.feedbackSynthesisRun.create({
        data: {
          organizationSlug: slug,
          scope: SynthesisScope.effort,
          outreachId,
          status: SynthesisRunStatus.running,
          conversations: 0,
          memos: 0,
          confirmed: memberIds.length,
          engine: 'mock',
        },
      })
      await ingest().handle(
        completionEvent(row.id, [{ theme: 'Drains back up', memberIds }]),
      )
    }
    await effortRun(textId, textMembers)
    await effortRun(turf.outreachId, noteMembers)
    await service.prisma.constituentFeedback.update({
      where: { id: knocked[0]!.memo.id },
      data: { confirmedAt: null },
    })

    const agent = service.app.get(PriorityFlowOutreachService)
    const page = (await results()).data.themes
    const pooledRead = await agent.pooledThemes(slug, priorityId)
    const perSend = await agent.feedbackFor(slug, { priorityId })
    const peopleOn = (outreachId: number) =>
      perSend
        .find((send) => send.outreachId === outreachId)!
        .themes.map((theme) => theme.people)

    // Three people texted (one twice) and one confirmed note: four.
    expect(page.map((theme) => theme.people)).toEqual([4])
    expect(pooledRead.map((theme) => theme.people)).toEqual([4])
    expect(peopleOn(textId)).toEqual([3])
    expect(peopleOn(turf.outreachId)).toEqual([1])
  })

  it('says a run is in flight while the last themes stay up', async () => {
    await replies(5)
    await run()

    const res = await results()

    expect(res.data).toMatchObject({ summarizing: true, themes: [] })
  })

  it('re-pools the priority when one of its sends is summarized again', async () => {
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    await replies(5)

    const res = await service.client.post(
      `/v1/constituent-feedback/efforts/${textId}/synthesize`,
      {},
      ownerHeaders(slug),
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    await vi.waitFor(async () => {
      expect(
        await service.prisma.feedbackSynthesisRun.count({
          where: { priorityId, scope: SynthesisScope.priority },
        }),
      ).toBe(1)
    })
  })

  it('starts a pooled run when one of the priority sends finishes', async () => {
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    await replies(3)
    await notes(2)

    synthesis().requestRunOnEffortCompleted({
      organizationSlug: slug,
      outreachId: turf.outreachId,
    })

    await vi.waitFor(async () => {
      expect(
        await service.prisma.feedbackSynthesisRun.count({
          where: { priorityId, scope: SynthesisScope.priority },
        }),
      ).toBe(1)
    })
  })
})
