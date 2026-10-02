import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  IssueTagSource,
  IssueTagStatus,
  SynthesisRunStatus,
  SynthesisScope,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { FeedbackSynthesisIngestService } from '../services/feedbackSynthesisIngest.service'
import {
  completionEvent,
  createServeOrg,
  ownerHeaders,
  seedKnockMemo,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService()

describe('issue tag routes', () => {
  let slug: string

  beforeEach(async () => {
    slug = await createServeOrg(service)
  })

  const createTag = (
    name: string,
    status: IssueTagStatus = IssueTagStatus.proposed,
    orgSlug = slug,
  ) =>
    service.prisma.issueTag.create({
      data: {
        organizationSlug: orgSlug,
        name,
        normalizedName: name.toLowerCase(),
        status,
        source: IssueTagSource.synthesis,
      },
    })

  const patch = (id: string, body: object) =>
    service.client.patch(
      `/v1/constituent-feedback/tags/${id}`,
      body,
      ownerHeaders(slug),
    )

  it('lists the org’s tags with how many memos carry each', async () => {
    const effort = await seedTurfEffort(service, slug, { people: 2 })
    const tag = await createTag('Flooding', IssueTagStatus.accepted)
    for (const target of effort.targets) {
      const { memo } = await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: target.personId,
      })
      await service.prisma.constituentFeedbackTag.create({
        data: { feedbackId: memo.id, tagId: tag.id },
      })
    }
    await createTag('Potholes')
    const otherSlug = await createServeOrg(service)
    await createTag('Not ours', IssueTagStatus.accepted, otherSlug)

    const res = await service.client.get(
      '/v1/constituent-feedback/tags',
      ownerHeaders(slug),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.tags).toEqual([
      {
        id: tag.id,
        name: 'Flooding',
        status: 'accepted',
        source: 'synthesis',
        declaredTopIssueId: null,
        mergedIntoId: null,
        feedbackCount: 2,
      },
      expect.objectContaining({ name: 'Potholes', feedbackCount: 0 }),
    ])

    const proposedOnly = await service.client.get(
      '/v1/constituent-feedback/tags',
      { ...ownerHeaders(slug), params: { status: 'proposed' } },
    )
    expect(proposedOnly.data.tags.map((t: { name: string }) => t.name)).toEqual(
      ['Potholes'],
    )
  })

  it('accepts a proposed tag', async () => {
    const tag = await createTag('Flooding')

    const res = await patch(tag.id, { action: 'accept' })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.status).toBe('accepted')
    const row = await service.prisma.issueTag.findUniqueOrThrow({
      where: { id: tag.id },
    })
    expect(row.status).toBe(IssueTagStatus.accepted)
  })

  it('renames a tag and re-derives its normalized name', async () => {
    const tag = await createTag('Flooding')

    const res = await patch(tag.id, {
      action: 'rename',
      name: '  Street   Flooding ',
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.name).toBe('Street Flooding')
    const row = await service.prisma.issueTag.findUniqueOrThrow({
      where: { id: tag.id },
    })
    expect(row.normalizedName).toBe('street flooding')
  })

  it('refuses a rename onto another tag’s name', async () => {
    await createTag('Flooding', IssueTagStatus.accepted)
    const potholes = await createTag('Potholes')

    const res = await patch(potholes.id, { action: 'rename', name: 'FLOODING' })

    expect(res.status).toBe(HttpStatus.CONFLICT)
    const row = await service.prisma.issueTag.findUniqueOrThrow({
      where: { id: potholes.id },
    })
    expect(row.name).toBe('Potholes')
  })

  // Only an accepted tag may be a merge target, so a merge can never land
  // memos on a suggestion nobody has agreed to.
  it('refuses a merge into a tag that is not accepted', async () => {
    const source = await createTag('Flood')
    const target = await createTag('Flooding')

    const res = await patch(source.id, {
      action: 'merge',
      intoTagId: target.id,
    })

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    const row = await service.prisma.issueTag.findUniqueOrThrow({
      where: { id: source.id },
    })
    expect(row.status).toBe(IssueTagStatus.proposed)
    expect(row.mergedIntoId).toBeNull()
  })

  it('merges a tag’s memos and themes into an accepted tag', async () => {
    const effort = await seedTurfEffort(service, slug, { people: 2 })
    const source = await createTag('Flood')
    const target = await createTag('Flooding', IssueTagStatus.accepted)
    const memoIds: string[] = []
    for (const person of effort.targets) {
      const { memo } = await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: person.personId,
      })
      memoIds.push(memo.id)
      await service.prisma.constituentFeedbackTag.create({
        data: { feedbackId: memo.id, tagId: source.id },
      })
    }
    // The first memo already carries the target: the move skips that pair.
    await service.prisma.constituentFeedbackTag.create({
      data: { feedbackId: memoIds[0]!, tagId: target.id },
    })
    const run = await service.prisma.feedbackSynthesisRun.create({
      data: {
        organizationSlug: slug,
        scope: SynthesisScope.effort,
        outreachId: effort.outreachId,
        status: SynthesisRunStatus.completed,
        conversations: 2,
        memos: 2,
        confirmed: 2,
        engine: 'mock',
      },
    })
    const theme = await service.prisma.feedbackTheme.create({
      data: {
        runId: run.id,
        rank: 1,
        title: 'Flood',
        summary: 's',
        details: 'd',
        tagId: source.id,
      },
    })

    const res = await patch(source.id, {
      action: 'merge',
      intoTagId: target.id,
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({
      status: 'retired',
      mergedIntoId: target.id,
    })
    const rows = await service.prisma.constituentFeedbackTag.findMany({
      where: { feedbackId: { in: memoIds } },
    })
    expect(rows.map((r) => r.tagId).sort()).toEqual([target.id, target.id])
    const movedTheme = await service.prisma.feedbackTheme.findUniqueOrThrow({
      where: { id: theme.id },
    })
    expect(movedTheme.tagId).toBe(target.id)
  })

  it('retires a tag, and a later proposal with its name revives it', async () => {
    const effort = await seedTurfEffort(service, slug, { people: 5 })
    const tag = await createTag('Composting pilot', IssueTagStatus.accepted)

    const retired = await patch(tag.id, { action: 'retire' })
    expect(retired.status).toBe(HttpStatus.OK)
    expect(retired.data.status).toBe('retired')

    const memoIds: string[] = []
    for (const target of effort.targets) {
      const { memo } = await seedKnockMemo(service, {
        slug,
        outreachId: effort.outreachId,
        personId: target.personId,
      })
      memoIds.push(memo.id)
    }
    const synthesized = await service.client.post(
      `/v1/constituent-feedback/efforts/${effort.outreachId}/synthesize`,
      {},
      ownerHeaders(slug),
    )
    expect(synthesized.status).toBe(HttpStatus.CREATED)
    await service.app
      .get(FeedbackSynthesisIngestService)
      .handle(
        completionEvent(synthesized.data.id, [
          { theme: 'Composting Pilot', memberIds: memoIds },
        ]),
      )

    const revived = await service.prisma.issueTag.findUniqueOrThrow({
      where: { id: tag.id },
    })
    expect(revived.status).toBe(IssueTagStatus.proposed)
    expect(revived.proposedByRunId).toBe(synthesized.data.id)
    expect(
      await service.prisma.issueTag.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(1)
  })

  it('404s a tag from another org', async () => {
    const otherSlug = await createServeOrg(service)
    const theirs = await createTag('Theirs', IssueTagStatus.proposed, otherSlug)

    const res = await patch(theirs.id, { action: 'accept' })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('refuses an action it does not know', async () => {
    const tag = await createTag('Flooding')

    const res = await patch(tag.id, { action: 'delete' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('tags on a person’s record', () => {
  it('shows accepted tags only', async () => {
    const slug = await createServeOrg(service)
    const effort = await seedTurfEffort(service, slug, { people: 1 })
    const personId = effort.targets[0]!.personId
    const { memo } = await seedKnockMemo(service, {
      slug,
      outreachId: effort.outreachId,
      personId,
    })
    for (const [name, status] of [
      ['Flooding', IssueTagStatus.accepted],
      ['Drains', IssueTagStatus.proposed],
      ['Storms', IssueTagStatus.retired],
    ] as const) {
      const tag = await service.prisma.issueTag.create({
        data: {
          organizationSlug: slug,
          name,
          normalizedName: name.toLowerCase(),
          status,
          source: IssueTagSource.synthesis,
        },
      })
      await service.prisma.constituentFeedbackTag.create({
        data: { feedbackId: memo.id, tagId: tag.id },
      })
    }

    const res = await service.client.get('/v1/constituent-feedback', {
      ...ownerHeaders(slug),
      params: { personId },
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.feedback[0].tags).toEqual([
      expect.objectContaining({ name: 'Flooding', status: 'accepted' }),
    ])
  })
})
