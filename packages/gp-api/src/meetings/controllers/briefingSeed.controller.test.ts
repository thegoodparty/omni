import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ExperimentRunStatus } from '../../generated/prisma'

const service = useTestService()

const BASE = '/v1/meetings'
const MEETING_DATE = '2026-09-15'

let eoId: string
let eoOrgSlug: string

const eoHeaders = () => ({
  headers: { 'x-organization-slug': eoOrgSlug },
})

const seedBody = () => ({
  meetingDate: MEETING_DATE,
  meetingName: 'Cheyenne City Council',
  meetingTime: '19:00',
  meetingTimezone: 'America/Denver',
  location: 'Council Chambers, 2101 O Neil Ave',
  officialName: 'Test Official',
  items: [
    {
      title: 'Downtown rezoning ordinance',
      summary: 'Staff recommends approving the mixed-use overlay district.',
      budgetImpactSummary: 'A one-time $1.25M appropriation from reserves.',
      sentimentSummary: 'Residents lean supportive of denser downtown housing.',
      talkingPoints: [
        { text: 'Point one', why: 'Because one' },
        { text: 'Point two', why: 'Because two' },
        { text: 'Point three', why: 'Because three' },
      ],
    },
    {
      title: 'Street lighting contract renewal',
      summary: 'Renewal of the three-year LED maintenance contract.',
    },
  ],
})

// The seed uploads the artifact to S3 and both read paths fetch it back, so
// the test double has to behave like a bucket, not just swallow the write.
const stubS3 = () => {
  const objects = new Map<string, string>()
  const s3 = service.app.get(S3Service)
  vi.spyOn(s3, 'uploadFile').mockImplementation(async (bucket, body, key) => {
    objects.set(key, String(body))
    return `https://${bucket}.s3.amazonaws.com/${key}`
  })
  vi.spyOn(s3, 'getFile').mockImplementation(async (_bucket, key) =>
    objects.get(key),
  )
  return objects
}

beforeEach(async () => {
  eoId = uuidv7()
  eoOrgSlug = `eo-brief-${eoId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: eoId, userId: service.user.id, organizationSlug: eoOrgSlug },
  })
})

describe('POST /v1/meetings/briefings/seed', () => {
  it('writes a briefing the read endpoint serves back in full', async () => {
    stubS3()

    const res = await service.client.post<{
      briefingId: string
      meetingDate: string
      itemIds: string[]
    }>(`${BASE}/briefings/seed`, seedBody(), eoHeaders())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.meetingDate).toBe(MEETING_DATE)
    expect(res.data.itemIds).toEqual(['seed-item-1', 'seed-item-2'])
    expect(res.data.briefingId.length).toBeGreaterThan(0)

    const run = await service.prisma.experimentRun.findFirstOrThrow({
      where: { organizationSlug: eoOrgSlug },
    })
    expect(run.experimentType).toBe('meeting_briefing')
    expect(run.status).toBe(ExperimentRunStatus.COMPLETED)

    // The read endpoint re-parses the S3 object, so this asserts the seeded
    // artifact survives the real serve path — not just that a row exists.
    const read = await service.client.get<{
      briefing_id: string
      briefing_status: string
      meeting_name: string
      meeting_time: string
      items: {
        id: string
        title: string
        display: {
          summary: string
          budget_impact: { summary: string } | null
          constituent_sentiment: { summary: string } | null
          talking_points: { text: string; why: string }[] | null
        }
      }[]
      sources: { id: string }[]
    }>(`${BASE}/${MEETING_DATE}/briefing`, eoHeaders())

    expect(read.status).toBe(HttpStatus.OK)
    expect(read.data.briefing_id).toBe(res.data.briefingId)
    expect(read.data.briefing_status).toBe('briefing_ready')
    expect(read.data.meeting_name).toBe('Cheyenne City Council')
    expect(read.data.meeting_time).toBe('19:00')
    expect(read.data.items).toHaveLength(2)

    const first = read.data.items[0]!
    expect(first.title).toBe('Downtown rezoning ordinance')
    expect(first.display.summary).toBe(
      'Staff recommends approving the mixed-use overlay district.',
    )
    expect(first.display.budget_impact?.summary).toBe(
      'A one-time $1.25M appropriation from reserves.',
    )
    expect(first.display.constituent_sentiment?.summary).toBe(
      'Residents lean supportive of denser downtown housing.',
    )
    expect(first.display.talking_points).toHaveLength(3)

    // Section source pills resolve item source_ids against the top-level
    // sources array — an unresolvable id renders nothing.
    expect(read.data.sources.map((s) => s.id)).toEqual([
      'seed-source-1',
      'seed-source-2',
    ])

    const second = read.data.items[1]!
    expect(second.display.budget_impact).toBeNull()
    expect(second.display.talking_points).toBeNull()
  })

  it('is idempotent for the same meeting date', async () => {
    stubS3()

    const first = await service.client.post<{ briefingId: string }>(
      `${BASE}/briefings/seed`,
      seedBody(),
      eoHeaders(),
    )
    const second = await service.client.post<{ briefingId: string }>(
      `${BASE}/briefings/seed`,
      { ...seedBody(), meetingName: 'Renamed Council' },
      eoHeaders(),
    )

    expect(second.data.briefingId).toBe(first.data.briefingId)
    const rows = await service.prisma.meetingBriefing.findMany({
      where: { electedOfficeId: eoId },
    })
    expect(rows).toHaveLength(1)
    const runs = await service.prisma.experimentRun.findMany({
      where: { organizationSlug: eoOrgSlug },
    })
    expect(runs).toHaveLength(1)
  })

  it('returns 403 when OTEL_SERVICE_ENVIRONMENT is a customer env (prod)', async () => {
    stubS3()
    const prev = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    try {
      const res = await service.client.post(
        `${BASE}/briefings/seed`,
        seedBody(),
        eoHeaders(),
      )
      expect(res.status).toBe(HttpStatus.FORBIDDEN)
    } finally {
      if (prev === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = prev
    }
  })

  it('returns 403 when OTEL_SERVICE_ENVIRONMENT is unknown (fails closed)', async () => {
    stubS3()
    const prev = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'staging'
    try {
      const res = await service.client.post(
        `${BASE}/briefings/seed`,
        seedBody(),
        eoHeaders(),
      )
      expect(res.status).toBe(HttpStatus.FORBIDDEN)
    } finally {
      if (prev === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = prev
    }
  })

  it.each(['dev', 'preview', 'local', 'test'])(
    'stays enabled on the %s deploy',
    async (env) => {
      stubS3()
      const prev = process.env.OTEL_SERVICE_ENVIRONMENT
      process.env.OTEL_SERVICE_ENVIRONMENT = env
      try {
        const res = await service.client.post(
          `${BASE}/briefings/seed`,
          seedBody(),
          eoHeaders(),
        )
        expect(res.status).toBe(HttpStatus.CREATED)
      } finally {
        if (prev === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
        else process.env.OTEL_SERVICE_ENVIRONMENT = prev
      }
    },
  )

  it('rejects an empty item list', async () => {
    stubS3()
    const res = await service.client.post(
      `${BASE}/briefings/seed`,
      { ...seedBody(), items: [] },
      eoHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('rejects more than five items', async () => {
    stubS3()
    const base = seedBody().items[1]!
    const res = await service.client.post(
      `${BASE}/briefings/seed`,
      {
        ...seedBody(),
        items: Array.from({ length: 6 }, (_, i) => ({
          ...base,
          title: `Item ${i + 1}`,
        })),
      },
      eoHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s for a caller with no elected office', async () => {
    stubS3()
    const res = await service.client.post(
      `${BASE}/briefings/seed`,
      seedBody(),
      { headers: { 'x-organization-slug': 'nonexistent' } },
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
