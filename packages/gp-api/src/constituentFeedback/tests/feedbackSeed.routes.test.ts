import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { DoorKnockOutcome, PhoneBankCallOutcome } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import {
  createServeOrg,
  ownerHeaders,
  seedPhoneEffort,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService()

describe('feedback seed route', () => {
  let slug: string

  beforeEach(async () => {
    slug = await createServeOrg(service)
  })

  const seed = (body: object) =>
    service.client.post(
      '/v1/constituent-feedback/seed',
      body,
      ownerHeaders(slug),
    )

  it('seeds confirmed memos and answered knocks on a turf', async () => {
    const effort = await seedTurfEffort(service, slug, {
      question: 'What should the city fix first?',
      people: 4,
    })

    const res = await seed({ outreachId: effort.outreachId, count: 12 })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ outreachId: effort.outreachId, created: 12 })
    const memos = await service.prisma.constituentFeedback.findMany({
      where: { organizationSlug: slug, outreachId: effort.outreachId },
    })
    expect(memos).toHaveLength(12)
    expect(memos.every((m) => m.confirmedAt !== null)).toBe(true)
    expect(memos.every((m) => m.doorKnockInteractionId !== null)).toBe(true)
    expect(new Set(memos.map((m) => m.issueLabel)).size).toBeGreaterThan(1)
    expect(memos[0]!.effortQuestion).toBe('What should the city fix first?')
    const knocks = await service.prisma.contactInteractionDoorKnock.findMany({
      where: { organizationSlug: slug, outreachId: effort.outreachId },
    })
    expect(knocks).toHaveLength(12)
    expect(knocks.every((k) => k.outcome === DoorKnockOutcome.answered)).toBe(
      true,
    )

    const report = await service.client.get(
      `/v1/constituent-feedback/efforts/${effort.outreachId}/report`,
      ownerHeaders(slug),
    )
    expect(report.data.denominators).toEqual({
      conversations: 4,
      memos: 12,
      confirmed: 12,
      pending: 0,
    })
  })

  // A call row is one per (list, person), so a list seeds at most one memo
  // per person on it.
  it('seeds a phone list up to one memo per person', async () => {
    const effort = await seedPhoneEffort(service, slug, { people: 3 })

    const res = await seed({ outreachId: effort.outreachId, count: 5 })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.created).toBe(3)
    const calls = await service.prisma.contactInteractionPhoneBanking.findMany({
      where: { phoneBankingListId: effort.listId },
    })
    expect(calls).toHaveLength(3)
    expect(
      calls.every((c) => c.outcome === PhoneBankCallOutcome.answered),
    ).toBe(true)
    expect(
      await service.prisma.constituentFeedback.count({
        where: { outreachId: effort.outreachId, confirmedAt: { not: null } },
      }),
    ).toBe(3)
  })

  it('404s on prod, writing nothing', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    const effort = await seedTurfEffort(service, slug, { people: 2 })

    const res = await seed({ outreachId: effort.outreachId, count: 5 })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(
      await service.prisma.constituentFeedback.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(0)
  })

  it('404s an effort from another org', async () => {
    const otherSlug = await createServeOrg(service)
    const theirs = await seedTurfEffort(service, otherSlug, { people: 2 })

    const res = await seed({ outreachId: theirs.outreachId, count: 5 })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
