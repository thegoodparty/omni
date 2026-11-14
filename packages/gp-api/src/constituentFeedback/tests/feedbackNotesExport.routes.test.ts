import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutreachStatus, OutreachType } from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { useTestService } from '@/test-service'
import {
  createServeOrg,
  createWinOrg,
  seedKnockMemo,
  seedReply,
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

describe('feedback text export route', () => {
  let slug: string
  let campaignId: number

  const findPeople = vi.fn()

  beforeEach(async () => {
    const win = await createWinOrg(service)
    slug = win.slug
    campaignId = win.campaignId
    findPeople.mockReset().mockResolvedValue({ people: [] })
    vi.spyOn(
      service.app.get(ContactsService),
      'resolveEligibleDistrict',
    ).mockResolvedValue({
      districtId: '33333333-3333-4333-8333-333333333333',
      dataset: { base: 'voters' },
    } as Awaited<ReturnType<ContactsService['resolveEligibleDistrict']>>)
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockImplementation(findPeople)
  })

  const seedWinSend = () =>
    service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        campaignId,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.completed,
        name: 'Likely voters SMS',
      },
    })

  const exportCsv = (outreachId: number, orgSlug = slug) =>
    service.client.get(
      `/v1/constituent-feedback/efforts/${outreachId}/export`,
      {
        headers: { 'x-organization-slug': orgSlug },
        responseType: 'arraybuffer' as const,
        validateStatus: () => true,
      },
    )

  const toRows = (data: unknown) =>
    Buffer.from(data as ArrayBuffer)
      .toString('utf-8')
      .split('\r\n')
      .filter((row) => row !== '')

  it('writes one row per person texted, with replies joined and opt-outs set', async () => {
    const send = await seedWinSend()
    const [replier, optedOut, silent] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ]
    const base = new Date('2026-11-01T10:00:00Z')
    await service.prisma.contactInteractionText.createMany({
      data: [
        {
          organizationSlug: slug,
          outreachId: send.id,
          personId: replier,
          occurredAt: base,
          respondedAt: base,
        },
        {
          organizationSlug: slug,
          outreachId: send.id,
          personId: optedOut,
          occurredAt: base,
          respondedAt: base,
          optedOutAt: base,
        },
        {
          organizationSlug: slug,
          outreachId: send.id,
          personId: silent,
          occurredAt: base,
        },
      ],
    })
    await seedReply(service, {
      outreachId: send.id,
      personId: replier,
      content: 'Fix Elm first',
      sentAt: new Date('2026-11-01T11:00:00Z'),
    })
    await seedReply(service, {
      outreachId: send.id,
      personId: replier,
      content: '=SUM(1)',
      sentAt: new Date('2026-11-01T12:00:00Z'),
    })
    await seedReply(service, {
      outreachId: send.id,
      personId: optedOut,
      content: 'STOP',
      isOptOut: true,
    })

    findPeople.mockResolvedValue({
      people: [
        {
          id: replier,
          firstName: 'Ana',
          lastName: 'Lee',
          cellPhone: '+15551234567',
        },
      ],
    })

    const res = await exportCsv(send.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.headers['content-disposition']).toContain('-responses.csv')
    const rows = toRows(res.data)
    expect(rows[0]).toBe(
      '"Name","Phone","Texted at","Replied","Reply text","Opted out"',
    )
    const body = Buffer.from(res.data as ArrayBuffer).toString('utf-8')
    expect(rows).toHaveLength(4)
    expect(body).toContain('"Fix Elm first\n=SUM(1)"')
    expect(body).toContain('"STOP","Yes"')
    expect(body).toContain('"Ana Lee","+15551234567"')
    expect(body).toContain('"+13035550100"')
    expect(body).not.toContain(`"'+1`)
    expect(body).toContain('"2026-11-01T10:00:00.000Z","No","","No"')
  })

  it('escapes a formula that leads the first reply', async () => {
    const send = await seedWinSend()
    const person = randomUUID()
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        outreachId: send.id,
        personId: person,
        occurredAt: new Date(),
      },
    })
    await seedReply(service, {
      outreachId: send.id,
      personId: person,
      content: '=SUM(1)',
    })

    const res = await exportCsv(send.id)

    expect(Buffer.from(res.data as ArrayBuffer).toString('utf-8')).toContain(
      `"'=SUM(1)"`,
    )
  })

  it('fails instead of returning blank names when people-api throws', async () => {
    const send = await seedWinSend()
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        outreachId: send.id,
        personId: randomUUID(),
        occurredAt: new Date(),
      },
    })
    findPeople.mockRejectedValue(new Error('people-api returned 503'))

    const res = await exportCsv(send.id)

    expect(res.status).toBeGreaterThanOrEqual(HttpStatus.INTERNAL_SERVER_ERROR)
  })

  it("404s another org's send", async () => {
    const send = await seedWinSend()
    const other = await createServeOrg(service)

    const res = await exportCsv(send.id, other)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('admits a Win p2p send to the report, and not for another org', async () => {
    const send = await seedWinSend()
    const other = await createServeOrg(service)
    const report = (orgSlug: string) =>
      service.client.get(`/v1/constituent-feedback/efforts/${send.id}/report`, {
        headers: { 'x-organization-slug': orgSlug },
        validateStatus: () => true,
      })

    expect((await report(slug)).status).toBe(HttpStatus.OK)
    expect((await report(other)).status).toBe(HttpStatus.NOT_FOUND)
  })
})
