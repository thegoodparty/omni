import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import {
  createServeOrg,
  seedKnockMemo,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService()

describe('feedback notes export route', () => {
  let slug: string

  beforeEach(async () => {
    slug = await createServeOrg(service)
  })

  const exportNotes = (outreachId: number, orgSlug = slug) =>
    service.client.get(
      `/v1/constituent-feedback/efforts/${outreachId}/export`,
      {
        headers: { 'x-organization-slug': orgSlug },
        responseType: 'arraybuffer' as const,
        validateStatus: () => true,
      },
    )

  it('streams every note as a CSV, escaping commas, quotes and newlines', async () => {
    const effort = await seedTurfEffort(service, slug, { people: 2 })
    await service.prisma.outreach.update({
      where: { id: effort.outreachId },
      data: { name: 'East Side Turf' },
    })
    const [a, b] = effort.targets
    await seedKnockMemo(service, {
      slug,
      outreachId: effort.outreachId,
      personId: a!.personId,
      transcript:
        'Flooding, again. She said "fix it" and kept going.\nWants it done by spring.',
      desiredOutcome: 'Clear the storm drain, finally',
    })
    await seedKnockMemo(service, {
      slug,
      outreachId: effort.outreachId,
      personId: b!.personId,
      confirmed: false,
    })

    const res = await exportNotes(effort.outreachId)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('East Side Turf')
    expect(res.headers['content-disposition']).toContain(
      String(effort.outreachId),
    )

    const body = Buffer.from(res.data as ArrayBuffer).toString('utf-8')
    const rows = body.split('\r\n').filter((row) => row !== '')

    expect(rows[0]).toBe(
      '"Date","Recorded by","Source","Status","Note","Issues","Stance","Wants","Theme"',
    )
    expect(rows).toHaveLength(3)
    // Newest first: the pending memo for b was recorded after a's.
    expect(rows[1]).toContain('"Not yet reviewed"')
    const confirmedRow = rows[2]!
    expect(confirmedRow).toContain('"Johnny Goodparty"')
    expect(confirmedRow).toContain('"At the door"')
    expect(confirmedRow).toContain('"Confirmed"')
    expect(confirmedRow).toContain(
      '"Flooding, again. She said ""fix it"" and kept going.\nWants it done by spring."',
    )
    expect(confirmedRow).toContain('"Street flooding"')
    expect(confirmedRow).toContain('"Against it"')
    expect(confirmedRow).toContain('"Clear the storm drain, finally"')
  })

  it('returns only the header row for an effort with no notes', async () => {
    const effort = await seedTurfEffort(service, slug, { people: 1 })

    const res = await exportNotes(effort.outreachId)

    expect(res.status).toBe(HttpStatus.OK)
    const body = Buffer.from(res.data as ArrayBuffer).toString('utf-8')
    const rows = body.split('\r\n').filter((row) => row !== '')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('"Date"')
  })

  it('404s an effort from another org', async () => {
    const effort = await seedTurfEffort(service, slug, { people: 1 })
    const otherSlug = await createServeOrg(service)

    const res = await exportNotes(effort.outreachId, otherSlug)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
