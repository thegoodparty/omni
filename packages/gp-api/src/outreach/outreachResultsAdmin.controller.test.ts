import { addBusinessDays, addDays, parseISO } from 'date-fns'
import { beforeEach, describe, expect, it } from 'vitest'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
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

// `<kind>/<id>`: the inbox carries two products whose ids are neither the
// same type nor drawn from the same space, so the kind travels in the path.
const getQueue = () => service.client.get(`${BASE}/queue`)
const getTarget = (outreachId: number) =>
  service.client.get(`${BASE}/sms/${outreachId}`)
const post = (
  outreachId: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) => service.client.post(`${BASE}/sms/${outreachId}`, body, { headers })

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
      kind: 'sms',
      id: String(outreach.id),
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
    expect(result.data.items.map((item: { id: string }) => item.id)).toEqual([
      String(outreach.id),
    ])
  })

  it('omits a send whose results already came back', async () => {
    const done = await createSend(OutreachStatus.completed)
    await addRecipients(done.id)
    const result = await getQueue()
    expect(result.data.items.map((item: { id: string }) => item.id)).toEqual([
      String(outreach.id),
    ])
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
      kind: 'sms',
      id: String(outreach.id),
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
      outboundRows: 0,
      matched: 2,
      unmatched: 0,
      optOuts: 1,
      committed: false,
    })
    expect(await messageCount()).toBe(0)
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.in_progress)
  })

  // The shape a real fulfilment export has: one outbound row per recipient
  // plus a handful of replies. Those outbound rows used to be folded into
  // `unmatched`, so a 2-recipient send with one off-send reply reported 3
  // unmatched instead of 1 — and `unmatched` is the number the operator
  // acts on.
  it('reports outbound rows separately instead of inflating unmatched', async () => {
    const csv = [
      'Contact Phone Number,Message Text,Sent At,Send Direction',
      '3035550101,Budget hearing Tuesday.,2026-08-11T15:00:00.000Z,OUTBOUND',
      '+1 (303) 555-0102,Budget hearing Tuesday.,2026-08-11T15:00:01.000Z,OUTBOUND',
      '3035550101,I will be there,2026-08-11T15:04:05.000Z,INBOUND',
      '3035559999,Someone forwarded me this,2026-08-11T15:30:00.000Z,INBOUND',
    ].join('\n')

    const result = await upload(csv, true)

    expect(result.status).toBe(201)
    expect(result.data.outboundRows).toBe(2)
    expect(result.data.rowsParsed).toBe(2)
    expect(result.data.matched).toBe(1)
    expect(result.data.unmatched).toBe(1)
  })

  it('commits the same file through the shared ingest', async () => {
    const result = await upload(RESULTS_CSV, false)

    expect(result.data).toEqual({
      rowsParsed: 2,
      outboundRows: 0,
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
    const adapter = service.app.getHttpAdapter() as FastifyAdapter
    expect(adapter.getInstance().initialConfig.bodyLimit).toBe(
      FASTIFY_DEFAULT_BODY_LIMIT,
    )
  })
})

// The poll half of the one upload path. A poll is not an Outreach row and
// is never ingested here: the file is forwarded to the analysis pipeline by
// landing in the bucket its S3 notification watches, which is exactly what
// the `aws s3 cp` line in the Slack message used to ask a human to do.
describe('poll results through the same surface', () => {
  const POLL_BUCKET = 'serve-analyze-data-test'
  let pollId: string
  let uploadFile: ReturnType<typeof vi.spyOn>

  const POLL_CSV = [
    'Contact Phone Number,Message Text,Sent At,Send Direction',
    '3035550101,The potholes on Elm are getting worse,2026-08-11T15:04:05.000Z,INBOUND',
    '3035550102,Budget hearing Tuesday.,2026-08-11T15:00:00.000Z,OUTBOUND',
  ].join('\n')

  const uploadPoll = (dryRun: boolean, csv = POLL_CSV) =>
    service.client.post(`${BASE}/poll/${pollId}`, {
      fileName: 'poll-results.csv',
      csv,
      dryRun,
      sourceLabel: 'gp-admin upload by staffer@goodparty.org',
    })

  beforeEach(async () => {
    process.env.SERVE_ANALYSIS_BUCKET_NAME = POLL_BUCKET
    const office = await service.prisma.electedOffice.findFirstOrThrow({
      where: { organizationSlug: ORG_SLUG },
    })
    const poll = await service.prisma.poll.create({
      data: {
        name: 'Which roads first?',
        messageContent: 'Which roads need repair first? Reply to tell me.',
        targetAudienceSize: 1200,
        scheduledDate: new Date('2026-08-01T15:00:00.000Z'),
        estimatedCompletionDate: new Date('2026-08-06T15:00:00.000Z'),
        electedOfficeId: office.id,
      },
    })
    pollId = poll.id
    uploadFile = vi
      .spyOn(service.app.get(S3Service), 'uploadFile')
      .mockResolvedValue(undefined as never)
  })

  it('lists an incomplete poll in the same queue as the text sends', async () => {
    const result = await getQueue()

    expect(result.status).toBe(200)
    const poll = result.data.items.find(
      (item: { kind: string }) => item.kind === 'poll',
    )
    expect(poll).toMatchObject({
      kind: 'poll',
      id: pollId,
      name: 'Which roads first?',
      organizationSlug: ORG_SLUG,
      recipientCount: 1200,
    })
    // Both products, one queue: the send is still there too.
    expect(
      result.data.items.some((item: { kind: string }) => item.kind === 'sms'),
    ).toBe(true)
  })

  it('writes nothing on a dry run, so a bad file never starts a Fargate run', async () => {
    const result = await uploadPoll(true)

    expect(result.status).toBe(201)
    expect(result.data.committed).toBe(false)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  // The bytes matter: the pipeline parses this file itself, so anything we
  // re-serialized would make this service a second author of a format it
  // does not own.
  it('forwards the file verbatim to the key the pipeline watches', async () => {
    const result = await uploadPoll(false)

    expect(result.status).toBe(201)
    expect(result.data.committed).toBe(true)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    const [bucket, body, key] = uploadFile.mock.calls[0] as [
      string,
      string,
      string,
    ]
    expect(bucket).toBe(POLL_BUCKET)
    expect(key).toBe(`input/${pollId}.csv`)
    expect(body).toBe(POLL_CSV)
  })

  // Null rather than zero: there is no recipient map to match against and no
  // opt-out predicate run here. Zero would read as "nobody replied", when the
  // truth is that the pipeline answers that later by writing PollIssues.
  it('reports counts it can know and nulls the ones it cannot', async () => {
    const result = await uploadPoll(true)

    expect(result.data).toMatchObject({
      rowsParsed: 1,
      outboundRows: 1,
      matched: null,
      unmatched: null,
      optOuts: null,
    })
  })

  // The SMS path deliberately allows a re-upload: its ingest is a CAS, so
  // running it twice lands on the same rows. This path has no such property
  // — S3 fires ObjectCreated on the write whether or not the bytes changed,
  // so a second upload re-runs the analysis, and because that analysis is an
  // LLM job it can return different themes than the official already read.
  it('refuses a re-upload against a poll that already has results', async () => {
    await service.prisma.poll.update({
      where: { id: pollId },
      data: { isCompleted: true, completedDate: new Date() },
    })

    const result = await service.client.post(
      `${BASE}/poll/${pollId}`,
      {
        fileName: 'poll-results.csv',
        csv: POLL_CSV,
        dryRun: false,
        sourceLabel: 'staff',
      },
      { validateStatus: () => true },
    )

    expect(result.status).toBe(409)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  // The inbox filters these out, but it is not the only way in: the route is
  // reachable by URL and by an M2M token that never loaded the page. Results
  // for a poll that has not gone out cannot exist.
  it('refuses a poll whose send date has not arrived', async () => {
    await service.prisma.poll.update({
      where: { id: pollId },
      data: { scheduledDate: addDays(new Date(), 3) },
    })

    const result = await service.client.post(
      `${BASE}/poll/${pollId}`,
      {
        fileName: 'poll-results.csv',
        csv: POLL_CSV,
        dryRun: false,
        sourceLabel: 'staff',
      },
      { validateStatus: () => true },
    )

    expect(result.status).toBe(409)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  // The dry run is refused on the same grounds rather than reporting a
  // parse the operator could then act on: the answer is the same either way.
  it('refuses the dry run against a completed poll too', async () => {
    await service.prisma.poll.update({
      where: { id: pollId },
      data: { isCompleted: true, completedDate: new Date() },
    })

    const result = await service.client.post(
      `${BASE}/poll/${pollId}`,
      {
        fileName: 'poll-results.csv',
        csv: POLL_CSV,
        dryRun: true,
        sourceLabel: 'staff',
      },
      { validateStatus: () => true },
    )

    expect(result.status).toBe(409)
  })

  // The read the upload page does before it accepts anything. It has its
  // own query and its own 404s, and it sources resultsReceivedAt from
  // `completedDate` rather than the send path's field — none of which the
  // upload tests above exercise.
  it('returns what the page must show before the file is uploaded', async () => {
    const result = await service.client.get(`${BASE}/poll/${pollId}`)

    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      kind: 'poll',
      id: pollId,
      name: 'Which roads first?',
      organizationSlug: ORG_SLUG,
      recipientCount: 1200,
      resultsReceivedAt: null,
    })
    expect(result.data.message).toBe(
      'Which roads need repair first? Reply to tell me.',
    )
  })

  // What drives the "results already in" badge. A poll has no spine status,
  // so completedDate — written by the analysis pipeline — is the only thing
  // that says the round trip finished.
  it('says results are in once the pipeline has set completedDate', async () => {
    await service.prisma.poll.update({
      where: { id: pollId },
      data: { completedDate: new Date(), isCompleted: true },
    })

    const result = await service.client.get(`${BASE}/poll/${pollId}`)

    expect(result.status).toBe(200)
    expect(result.data.resultsReceivedAt).not.toBeNull()
  })

  it('404s a poll id that names nothing on the target read', async () => {
    const result = await service.client.get(`${BASE}/poll/does-not-exist`, {
      validateStatus: () => true,
    })

    expect(result.status).toBe(404)
  })

  // The second 404 branch: a poll whose elected office is gone has no
  // organization to scope the inbox by, so it is unreadable rather than
  // shown without an owner — the same treatment listAwaiting gives it.
  it('404s a poll with no organization scope', async () => {
    const orphan = await service.prisma.poll.create({
      data: {
        name: 'Orphaned poll',
        messageContent: 'Anyone there?',
        targetAudienceSize: 10,
        scheduledDate: new Date('2026-08-01T15:00:00.000Z'),
        estimatedCompletionDate: new Date('2026-08-06T15:00:00.000Z'),
      },
    })

    const result = await service.client.get(`${BASE}/poll/${orphan.id}`, {
      validateStatus: () => true,
    })

    expect(result.status).toBe(404)
  })

  it('refuses a poll id that names nothing', async () => {
    const result = await service.client.post(
      `${BASE}/poll/does-not-exist`,
      {
        fileName: 'r.csv',
        csv: POLL_CSV,
        dryRun: true,
        sourceLabel: 'staff',
      },
      { validateStatus: () => true },
    )

    expect(result.status).toBe(404)
  })

  // A 400, not a 404: the id may name something real, it is the routing
  // that is wrong, and saying so stops an operator hunting a missing record.
  it('refuses an unknown kind', async () => {
    const result = await service.client.post(
      `${BASE}/telepathy/${pollId}`,
      { fileName: 'r.csv', csv: POLL_CSV, dryRun: true, sourceLabel: 's' },
      { validateStatus: () => true },
    )

    expect(result.status).toBe(400)
  })
})
