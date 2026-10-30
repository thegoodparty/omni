import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import type { PriorityThemeComments } from '@goodparty_org/contracts'
import {
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  PrioritySource,
  SynthesisRunStatus,
  SynthesisScope,
} from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import {
  seedKnockMemo,
  seedTurfEffort,
} from '@/constituentFeedback/tests/issueCaptureFixtures'

const service = useTestService()

let eoId: string
let eoOrgSlug: string
let priorityId: string

const headers = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const comments = (themeId: string, id = priorityId) =>
  service.client.get<PriorityThemeComments>(
    `/v1/priorities/${id}/results/themes/${themeId}/comments`,
    headers(),
  )

const download = (themeId?: string, id = priorityId) =>
  service.client.get<string>(
    `/v1/priorities/${id}/results/comments/download${
      themeId ? `?themeId=${themeId}` : ''
    }`,
    { ...headers(), responseType: 'text' },
  )

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

const textSend = async () =>
  service.prisma.outreach.create({
    data: {
      outreachType: OutreachType.text,
      organizationSlug: eoOrgSlug,
      campaignId: null,
      status: OutreachStatus.completed,
      name: 'Flooding: homeowners',
      priorityId,
    },
  })

const reply = async (
  outreachId: number,
  content: string,
  at: Date,
  isOptOut = false,
) =>
  service.prisma.pollIndividualMessage.create({
    data: {
      id: uuidv7(),
      personId: uuidv7(),
      outreachId,
      electedOfficeId: eoId,
      sender: PollIndividualMessageSender.CONSTITUENT,
      sentAt: at,
      content,
      isOptOut,
    },
  })

const run = async (
  themes: Array<{
    title: string
    replies?: string[]
    feedback?: string[]
  }>,
  options: { slug?: string; priority?: string; completedAt?: Date } = {},
) => {
  const created = await service.prisma.feedbackSynthesisRun.create({
    data: {
      organizationSlug: options.slug ?? eoOrgSlug,
      scope: SynthesisScope.priority,
      priorityId: options.priority ?? priorityId,
      status: SynthesisRunStatus.completed,
      completedAt: options.completedAt ?? new Date(),
      conversations: 5,
      memos: 5,
      confirmed: 5,
      engine: 'test',
    },
  })
  const ids: string[] = []
  for (const [index, theme] of themes.entries()) {
    const row = await service.prisma.feedbackTheme.create({
      data: {
        runId: created.id,
        rank: index + 1,
        title: theme.title,
        summary: `${theme.title} summary`,
        details: '',
        members: {
          create: [
            ...(theme.replies ?? []).map((textReplyId) => ({ textReplyId })),
            ...(theme.feedback ?? []).map((feedbackId) => ({ feedbackId })),
          ],
        },
      },
    })
    ids.push(row.id)
  }
  return ids
}

beforeEach(async () => {
  eoId = uuidv7()
  eoOrgSlug = `eo-${eoId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: eoId, userId: service.user.id, organizationSlug: eoOrgSlug },
  })
  priorityId = (
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Oak Street flooding',
        description: 'Drains back up into homes.',
        source: PrioritySource.user_stated,
      },
    })
  ).id
})

describe('GET /v1/priorities/:id/results/themes/:themeId/comments', () => {
  it("lists a theme's replies and confirmed notes, oldest first, words only", async () => {
    const send = await textSend()
    const later = await reply(send.id, 'The drain backs up.', minutesAgo(5))
    const earlier = await reply(
      send.id,
      'Water in my basement.',
      minutesAgo(30),
    )
    const walk = await seedTurfEffort(service, eoOrgSlug)
    const { memo } = await seedKnockMemo(service, {
      slug: eoOrgSlug,
      outreachId: walk.outreachId,
      personId: walk.targets[0]!.personId,
      transcript: 'She says the corner floods every storm.',
    })
    const { memo: unconfirmed } = await seedKnockMemo(service, {
      slug: eoOrgSlug,
      outreachId: walk.outreachId,
      personId: walk.targets[1]!.personId,
      confirmed: false,
      transcript: 'Not reviewed yet.',
    })
    const [themeId] = await run([
      {
        title: 'Drains',
        replies: [later.id, earlier.id],
        feedback: [memo.id, unconfirmed.id],
      },
    ])

    const res = await comments(themeId!)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.themeId).toBe(themeId)
    expect(res.data.comments).toEqual([
      { text: 'Water in my basement.', kind: 'reply' },
      { text: 'The drain backs up.', kind: 'reply' },
      { text: 'She says the corner floods every storm.', kind: 'note' },
    ])
    for (const comment of res.data.comments) {
      expect(Object.keys(comment).sort()).toEqual(['kind', 'text'])
    }
  })

  it('leaves out a reply that only opted out', async () => {
    const send = await textSend()
    const kept = await reply(send.id, 'Fix the drains.', minutesAgo(2))
    const stop = await reply(send.id, 'STOP', minutesAgo(1), true)
    const [themeId] = await run([
      { title: 'Drains', replies: [kept.id, stop.id] },
    ])

    const res = await comments(themeId!)

    expect(res.data.comments).toEqual([
      { text: 'Fix the drains.', kind: 'reply' },
    ])
  })

  it("404s on a theme from another priority's run", async () => {
    const other = await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Parks',
        description: 'More parks.',
        source: PrioritySource.user_stated,
      },
    })
    const [themeId] = await run([{ title: 'Parks' }], { priority: other.id })

    const res = await comments(themeId!)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it("404s on another office's priority", async () => {
    const otherId = uuidv7()
    const otherSlug = `eo-${otherId}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        id: otherId,
        userId: service.user.id,
        organizationSlug: otherSlug,
      },
    })
    const otherPriority = await service.prisma.priority.create({
      data: {
        electedOfficeId: otherId,
        title: 'Theirs',
        description: 'Not yours.',
        source: PrioritySource.user_stated,
      },
    })
    const [themeId] = await run([{ title: 'Theirs' }], {
      slug: otherSlug,
      priority: otherPriority.id,
    })

    const res = await comments(themeId!, otherPriority.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s with serve-citizen-panels off', async () => {
    const [themeId] = await run([{ title: 'Drains' }])
    const flag = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flag.mockRestore())

    const res = await comments(themeId!)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/priorities/:id/results/comments/download', () => {
  it('holds only each comment and its themes, from the latest run', async () => {
    const send = await textSend()
    const a = await reply(send.id, 'The drain backs up.', minutesAgo(10))
    const b = await reply(send.id, '=HYPERLINK("x")', minutesAgo(5))
    await run([{ title: 'Old theme', replies: [a.id] }], {
      completedAt: minutesAgo(60),
    })
    await run([
      { title: 'Drains', replies: [a.id, b.id] },
      { title: 'Insurance', replies: [a.id] },
    ])

    const res = await download()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain(
      'Oak Street flooding comments.csv',
    )
    expect(res.data.replace(/^﻿/, '').trim().split('\r\n')).toEqual([
      '"Comment","Theme"',
      '"The drain backs up.","Drains; Insurance"',
      '"\'=HYPERLINK(""x"")","Drains"',
    ])
  })

  it("holds one theme's comments when given a theme", async () => {
    const send = await textSend()
    const a = await reply(send.id, 'The drain backs up.', minutesAgo(10))
    const b = await reply(send.id, 'Premiums went up.', minutesAgo(5))
    const [, insurance] = await run([
      { title: 'Drains', replies: [a.id] },
      { title: 'Insurance', replies: [b.id] },
    ])

    const res = await download(insurance)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.headers['content-disposition']).toContain(
      'Oak Street flooding - Insurance comments.csv',
    )
    expect(res.data.replace(/^﻿/, '').trim().split('\r\n')).toEqual([
      '"Comment","Theme"',
      '"Premiums went up.","Insurance"',
    ])
  })

  it("404s on another office's priority", async () => {
    const res = await download(undefined, uuidv7())
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s with serve-citizen-panels off', async () => {
    const flag = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flag.mockRestore())

    const res = await download()

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
