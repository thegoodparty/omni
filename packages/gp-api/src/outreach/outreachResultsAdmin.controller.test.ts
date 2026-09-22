import { addBusinessDays, parseISO } from 'date-fns'
import { beforeEach, describe, expect, it } from 'vitest'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { useTestService } from '@/test-service'
import { RESULTS_UPLOAD_BODY_LIMIT_BYTES } from './util/outreachResultsBodyLimit.util'
import {
  Outreach,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  UserRole,
} from '../generated/prisma'

// Driven through the real routes rather than by instantiating the controller:
// the guard, the Zod body pipe and the response interceptor are all part of
// what gp-admin was built against, and the routes themselves ARE the contract
// — task A8 wrote the page against these three paths before they existed.

const service = useTestService()

const ORG_SLUG = 'serve-org-results'
const SCHEDULED_LOCAL_DATE = '2026-08-10'
const BASE = '/v1/outreach/admin/results'

const PERSON_1 = { personId: 'person-1', phone: '+13035550101' }
const PERSON_2 = { personId: 'person-2', phone: '(303) 555-0102' }

const RESULTS_CSV = [
  'Contact Phone Number,Message Text,Sent At,Send Direction',
  '3035550101,The potholes on Elm are getting worse,2026-08-11T15:04:05.000Z,INBOUND',
  '+1 (303) 555-0102,STOP,2026-08-11T16:00:00.000Z,INBOUND',
].join('\n')

let outreach: Outreach

const createSend = (
  status: OutreachStatus,
  outreachType: OutreachType = OutreachType.text,
) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: ORG_SLUG,
      outreachType,
      status,
      name: 'September newsletter text',
      message: 'Hi from the Mayor. Reply STOP to opt out.',
      scheduledLocalDate: SCHEDULED_LOCAL_DATE,
    },
  })

// What the delivery layer writes at handoff. Its presence, not the spine
// status, is what means a human has this send.
const addRecipients = async (outreachId: number) => {
  const recipients = [PERSON_1, PERSON_2]
  await service.prisma.outreachTextRecipient.createMany({
    data: recipients.map((recipient) => ({
      outreachId,
      organizationSlug: ORG_SLUG,
      personId: recipient.personId,
      phone: recipient.phone,
    })),
  })
  await service.prisma.contactInteractionText.createMany({
    data: recipients.map((recipient) => ({
      outreachId,
      organizationSlug: ORG_SLUG,
      personId: recipient.personId,
      occurredAt: new Date(),
    })),
  })
}

const getQueue = () => service.client.get(`${BASE}/queue`)
const getTarget = (outreachId: number) =>
  service.client.get(`${BASE}/${outreachId}`)
const post = (
  outreachId: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) => service.client.post(`${BASE}/${outreachId}`, body, { headers })

const upload = (csv: string, dryRun: boolean, outreachId = outreach.id) =>
  post(outreachId, {
    fileName: 'results.csv',
    csv,
    dryRun,
    sourceLabel: 'gp-admin upload by staffer@goodparty.org',
  })

const messageCount = () =>
  service.prisma.pollIndividualMessage.count({
    where: { outreachId: outreach.id },
  })

const statusOf = async (outreachId: number) =>
  (
    await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
  ).status

beforeEach(async () => {
  // The whole surface is AdminOrM2M-gated and the default test user is not an
  // admin, so every test but the 403 one needs the promotion.
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })
  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: ORG_SLUG, userId: service.user.id },
  })
  outreach = await createSend(OutreachStatus.in_progress)
  await addRecipients(outreach.id)
})

describe('GET /v1/outreach/admin/results/queue', () => {
  it('lists a handed-off send with counts read off the recipient map', async () => {
    const result = await getQueue()

    expect(result.status).toBe(200)
    expect(result.data.items).toHaveLength(1)
    expect(result.data.items[0]).toMatchObject({
      outreachId: outreach.id,
      name: 'September newsletter text',
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.text,
      recipientCount: 2,
      // Three business days after the scheduled day — the same promise polls
      // already makes, so the two Serve products say one thing.
      expectedBy: addBusinessDays(
        parseISO(SCHEDULED_LOCAL_DATE),
        3,
      ).toISOString(),
    })
    expect(result.data.items[0].sentAt).not.toBeNull()
  })

  it('omits a send that has not reached fulfilment yet', async () => {
    // `in_progress` alone is not enough: delivery claims the spine a beat
    // before it resolves the audience, and reverts the claim on failure.
    await createSend(OutreachStatus.in_progress)
    const result = await getQueue()
    expect(
      result.data.items.map((item: { outreachId: number }) => item.outreachId),
    ).toEqual([outreach.id])
  })

  it('omits a send whose results already came back', async () => {
    const done = await createSend(OutreachStatus.completed)
    await addRecipients(done.id)
    const result = await getQueue()
    expect(
      result.data.items.map((item: { outreachId: number }) => item.outreachId),
    ).toEqual([outreach.id])
  })

  it('is refused for a signed-in user who is not an admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.candidate] },
    })
    expect((await getQueue()).status).toBe(403)
  })
})

describe('GET /v1/outreach/admin/results/:outreachId', () => {
  it('returns what the page must show before it accepts a file', async () => {
    const result = await getTarget(outreach.id)

    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      outreachId: outreach.id,
      message: 'Hi from the Mayor. Reply STOP to opt out.',
      imageUrl: null,
      recipientCount: 2,
      resultsReceivedAt: null,
    })
  })

  it('stays openable after results land, and says they did', async () => {
    await upload(RESULTS_CSV, false)
    const result = await getTarget(outreach.id)
    expect(result.data.resultsReceivedAt).not.toBeNull()
  })

  it('404s anything that is not a text send: this surface is SMS-only', async () => {
    const other = await createSend(
      OutreachStatus.in_progress,
      OutreachType.socialMedia,
    )
    expect((await getTarget(other.id)).status).toBe(404)
  })
})

describe('POST /v1/outreach/admin/results/:outreachId', () => {
  it('writes nothing on a dry run and says so', async () => {
    const result = await upload(RESULTS_CSV, true)

    expect(result.status).toBe(201)
    expect(result.data).toEqual({
      rowsParsed: 2,
      matched: 2,
      unmatched: 0,
      optOuts: 1,
      committed: false,
    })
    expect(await messageCount()).toBe(0)
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.in_progress)
  })

  it('commits the same file through the shared ingest', async () => {
    const result = await upload(RESULTS_CSV, false)

    expect(result.data).toEqual({
      rowsParsed: 2,
      matched: 2,
      unmatched: 0,
      // Server-computed from the one opt-out predicate, not from anything
      // the page or the file claimed.
      optOuts: 1,
      committed: true,
    })
    const messages = await service.prisma.pollIndividualMessage.findMany({
      where: { outreachId: outreach.id },
    })
    expect(messages).toHaveLength(2)
    expect(
      messages.every(
        (message) => message.sender === PollIndividualMessageSender.CONSTITUENT,
      ),
    ).toBe(true)
    const optedOut =
      await service.prisma.contactInteractionText.findUniqueOrThrow({
        where: {
          outreachId_personId: {
            outreachId: outreach.id,
            personId: PERSON_2.personId,
          },
        },
      })
    expect(optedOut.optedOutAt).not.toBeNull()
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.completed)
  })

  it('counts a row the parse threw out as a row that matched nobody', async () => {
    const result = await upload(
      `${RESULTS_CSV}\n,A reply with no number attached\n`,
      true,
    )
    // The operator uploaded three rows; one of them can never match, and
    // reporting two would understate what they handed over.
    expect(result.data.rowsParsed).toBe(3)
    expect(result.data.matched).toBe(2)
    expect(result.data.unmatched).toBe(1)
  })

  it('refuses a file cut off mid-value before anything is written', async () => {
    const result = await upload(
      'phone_number,message_text,send_direction\n3035550101,"cut off here',
      false,
    )
    expect(result.status).toBe(400)
    expect(await messageCount()).toBe(0)
  })

  it('refuses a file whose rows can none of them be used', async () => {
    const result = await upload(
      'phone_number,message_text,send_direction\n,nothing to attach this to,INBOUND\n',
      false,
    )
    expect(result.status).toBe(400)
    expect(await messageCount()).toBe(0)
  })

  it('refuses a body that is not an upload request', async () => {
    expect((await post(outreach.id, { csv: RESULTS_CSV })).status).toBe(400)
  })

  it('404s an outreach that does not exist', async () => {
    expect((await upload(RESULTS_CSV, true, 987654321)).status).toBe(404)
  })

  it('is refused for a signed-in user who is not an admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.candidate] },
    })
    expect((await upload(RESULTS_CSV, true)).status).toBe(403)
    expect(await messageCount()).toBe(0)
  })
})

describe('POST /v1/outreach/admin/results/:outreachId — send state', () => {
  // The guard exists because the ingest's People DB fallback will happily
  // attribute a reply to a real constituent even when the send has no
  // recipient map. Without it, an upload against a draft writes message rows
  // and lands reply/opt-out events on live CRM interaction rows for a send
  // nobody ever received; `advanceToCompleted`'s CAS refuses only the final
  // status flip, by which point those writes are committed.
  const assertNothingWritten = async (outreachId: number) => {
    expect(
      await service.prisma.pollIndividualMessage.count({
        where: { outreachId },
      }),
    ).toBe(0)
  }

  it('refuses a send that has not been paid for', async () => {
    const draft = await createSend(OutreachStatus.pending_payment)
    const result = await upload(RESULTS_CSV, false, draft.id)
    expect(result.status).toBe(409)
    await assertNothingWritten(draft.id)
  })

  it('refuses a send that is paid but not yet handed to fulfilment', async () => {
    const waiting = await createSend(OutreachStatus.pending)
    await addRecipients(waiting.id)
    const result = await upload(RESULTS_CSV, false, waiting.id)
    expect(result.status).toBe(409)
    await assertNothingWritten(waiting.id)
  })

  it('refuses a canceled send', async () => {
    const canceled = await createSend(OutreachStatus.canceled)
    await addRecipients(canceled.id)
    expect((await upload(RESULTS_CSV, false, canceled.id)).status).toBe(409)
    await assertNothingWritten(canceled.id)
  })

  it('refuses a claimed send whose recipient map has not been written yet', async () => {
    // Delivery flips the spine to `in_progress` a beat before it resolves the
    // audience. In that window the status alone would let an upload through
    // with nothing for a reply phone to match against.
    const claimed = await createSend(OutreachStatus.in_progress)
    expect((await upload(RESULTS_CSV, false, claimed.id)).status).toBe(409)
    await assertNothingWritten(claimed.id)
  })

  it('accepts a completed send, because a re-upload is idempotent', async () => {
    await upload(RESULTS_CSV, false)
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.completed)
    expect((await upload(RESULTS_CSV, false)).status).toBe(201)
  })

  it('still opens the page for an undispatched send: only the upload is gated', async () => {
    const draft = await createSend(OutreachStatus.pending_payment)
    const result = await getTarget(draft.id)
    expect(result.status).toBe(200)
    expect(result.data.recipientCount).toBe(0)
    expect(result.data.sentAt).toBeNull()
  })
})

describe('POST /v1/outreach/admin/results/:outreachId — body size', () => {
  // A results CSV is a raw string inside a JSON body, and the adapter in
  // src/app.ts sets no bodyLimit, so Fastify's 1 MiB default applied here
  // until a route-scoped limit was added. That made the endpoint's own 5MB
  // cap unreachable: a real file for a large send was refused with an opaque
  // 413 before any readable sentence could be produced.
  const FASTIFY_DEFAULT_BODY_LIMIT = 1024 * 1024

  // Both phones are on the recipient map, so nothing reaches the People DB
  // fallback and the test stays off the network.
  const bigCsv = (rows: number) => {
    const content = 'The crossing on Elm still needs work. '.repeat(6)
    const lines = ['Contact Phone Number,Message Text,Sent At,Send Direction']
    for (let i = 0; i < rows; i += 1) {
      const phone = i % 2 === 0 ? '3035550101' : '3035550102'
      lines.push(`${phone},${content},2026-08-11T15:04:05.000Z,INBOUND`)
    }
    return lines.join('\n')
  }

  it("accepts a results file larger than Fastify's default limit", async () => {
    const csv = bigCsv(5000)
    const body = {
      fileName: 'results.csv',
      csv,
      dryRun: true,
      sourceLabel: 'gp-admin upload by staffer@goodparty.org',
    }
    // Assert the fixture is actually testing what it claims: if this ever
    // falls under the default, the test below would pass for the wrong
    // reason.
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeGreaterThan(
      FASTIFY_DEFAULT_BODY_LIMIT,
    )
    expect(RESULTS_UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThan(
      FASTIFY_DEFAULT_BODY_LIMIT,
    )

    const result = await post(outreach.id, body)

    expect(result.status).toBe(201)
    expect(result.data.rowsParsed).toBe(5000)
    expect(result.data.matched).toBe(5000)
  })

  it('leaves every other route on the default limit', () => {
    // The point of scoping it: widening the limit for ~380 endpoints, several
    // of them public, to fix one staff upload would be a real change in
    // exposure. Asserted on the server's own frozen config rather than by
    // posting an oversized body to a second route — Fastify tears the socket
    // down mid-upload when it refuses one, so that request races and reports
    // EPIPE instead of a status. This fails the moment someone raises the
    // adapter's limit in src/app.ts instead of scoping it here.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const adapter = service.app.getHttpAdapter() as FastifyAdapter
    expect(adapter.getInstance().initialConfig.bodyLimit).toBe(
      FASTIFY_DEFAULT_BODY_LIMIT,
    )
  })
})
