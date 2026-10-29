import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONTACT_UPLOAD_MAX_BYTES,
  SERVE_IMPORT_CONTACTS_FLAG,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  ContactUploadMatchMethod,
  ContactUploadMatchOutcome,
  ContactUploadStatus,
} from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { ElectionDistrictService } from '@/peopleDb/services/electionDistrict.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import {
  buildContactUploadMatchSql,
  CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS,
  type ContactUploadMatchCandidateRow,
} from '@/peopleDb/databricks/contactUploadMatchSql.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { ContactsService } from '@/contacts/services/contacts.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ConstituentActivityType } from '@/contactEngagement/contactEngagement.types'
import {
  ContactUploadMatchJobService,
  MATCH_CHUNK_SIZE,
} from '../services/contactUploadMatchJob.service'

const service = useTestService()

const HEADER = 'x-organization-slug'
const PERSON_A = '0a0a0a0a-0000-4000-8000-00000000000a'
const PERSON_B = '0b0b0b0b-0000-4000-8000-00000000000b'
const PERSON_C = '0c0c0c0c-0000-4000-8000-00000000000c'
const PERSON_D = '0d0d0d0d-0000-4000-8000-00000000000d'
const PERSON_E = '0e0e0e0e-0000-4000-8000-00000000000e'
const PERSON_F = '0f0f0f0f-0000-4000-8000-00000000000f'

const MAPPING = {
  firstName: 'First',
  lastName: 'Last',
  email: 'Email',
  cellPhone: 'Cell',
  landline: null,
  addressLine: 'Address',
  city: null,
  zip: 'Zip',
}
const HEADER_ROW = 'First,Last,Email,Cell,Address,Zip'

let slug: string
let flagOn: boolean
const bucketObjects = new Map<string, Buffer>()
const presignPut = vi.fn()
const sendMessage = vi.fn()
const track = vi.fn()

const candidate = (
  rowIndex: number,
  personId: string,
  phoneAgrees: boolean,
  addressAgrees: boolean,
  nameCount: number,
): ContactUploadMatchCandidateRow => ({
  rowIndex,
  personId,
  phoneAgrees,
  addressAgrees,
  nameCount,
})

const person = (id: string, firstName: string, lastName: string) => ({
  id,
  firstName,
  lastName,
  age: 40,
  address: { line1: `1 ${lastName} St`, city: 'Lansing', zip: '48933' },
})

const presign = (byteSize: number, orgSlug = slug) =>
  service.client.post(
    '/v1/contact-uploads/presign',
    { byteSize },
    { headers: { [HEADER]: orgSlug }, validateStatus: () => true },
  )

const create = (body: Record<string, unknown>, orgSlug = slug) =>
  service.client.post(
    '/v1/contact-uploads',
    {
      fileName: 'people.csv',
      name: 'Newsletter',
      consentAffirmed: true,
      columnMapping: MAPPING,
      ...body,
    },
    { headers: { [HEADER]: orgSlug }, validateStatus: () => true },
  )

// The browser's two steps: a presigned PUT straight to S3 (stood in for by
// bucketObjects), then the create call naming the upload id.
const upload = async (
  csv: string,
  body: Record<string, unknown> = {},
  orgSlug = slug,
) => {
  const file = Buffer.from(csv)
  const { data } = await presign(file.length, orgSlug)
  if (data?.uploadId) {
    bucketObjects.set(`${orgSlug}/${data.uploadId}.csv`, file)
  }
  return create({ uploadId: data?.uploadId ?? randomUUID(), ...body }, orgSlug)
}

const runMatch = async (uploadId: string, receiveCount = 1) =>
  service.app
    .get(ContactUploadMatchJobService)
    .handleQueuedMatch(uploadId, receiveCount)

const rowsOf = (uploadId: string) =>
  service.prisma.contactUploadMatch.findMany({
    where: { uploadId },
    orderBy: { rowIndex: 'asc' },
  })

const mockMatch = (rows: ContactUploadMatchCandidateRow[]) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'matchContactUploadRows')
    .mockClear()
    .mockResolvedValue(rows)

beforeEach(async () => {
  flagOn = true
  slug = `eo-import-${randomUUID()}`
  await service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: randomUUID(),
    },
  })
  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: slug },
  })

  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(
    async ({ feature }) => flagOn && feature === SERVE_IMPORT_CONTACTS_FLAG,
  )
  vi.spyOn(
    service.app.get(ElectionDistrictService),
    'findDistrictById',
  ).mockImplementation(async (id: string) => ({
    id,
    type: 'City',
    name: 'Lansing',
    state: 'MI',
  }))
  bucketObjects.clear()
  presignPut.mockReset().mockResolvedValue('https://s3.example/put?sig=1')
  vi.spyOn(
    service.app.get(S3Service),
    'getSignedUrlForSizedUpload',
  ).mockImplementation(presignPut)
  vi.spyOn(service.app.get(S3Service), 'getFileBytes').mockImplementation(
    async (bucket, key) =>
      bucket === process.env.CONTACT_UPLOADS_BUCKET
        ? bucketObjects.get(key)
        : undefined,
  )
  sendMessage.mockReset().mockResolvedValue(undefined)
  vi.spyOn(
    service.app.get(QueueProducerService),
    'sendMessage',
  ).mockImplementation(sendMessage)
  track.mockReset().mockResolvedValue(undefined)
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(track)
})

describe('POST /v1/contact-uploads/presign', () => {
  it('signs a PUT for exactly the declared size under the org', async () => {
    const res = await presign(5_500_000)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      uploadId: expect.any(String),
      uploadUrl: 'https://s3.example/put?sig=1',
      expiresAt: expect.any(String),
    })
    expect(presignPut).toHaveBeenCalledWith(
      process.env.CONTACT_UPLOADS_BUCKET,
      `${slug}/${res.data.uploadId}.csv`,
      { expiresIn: 900, contentType: 'text/csv', contentLength: 5_500_000 },
    )
  })

  it('400s for a file over 25 MB', async () => {
    const res = await presign(CONTACT_UPLOAD_MAX_BYTES + 1)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(presignPut).not.toHaveBeenCalled()
  })

  it('503s when the bucket is not configured', async () => {
    vi.stubEnv('CONTACT_UPLOADS_BUCKET', '')
    try {
      const res = await presign(100)

      expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
      expect(presignPut).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('404s when the flag is off for the org owner', async () => {
    flagOn = false

    const res = await presign(100)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(presignPut).not.toHaveBeenCalled()
  })
})

describe('POST /v1/contact-uploads', () => {
  it('reads the file from S3, stores normalized rows, then queues matching', async () => {
    const res = await upload(
      `${HEADER_ROW}\n` +
        'Ann,Able,ANN@Example.com,616-555-0101,123 Oak St,49503-1111\n' +
        'Ben,,ben@example.com,,,\n' +
        'Cal,Cole,not-an-email,12,,\n',
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      name: 'Newsletter',
      fileName: 'people.csv',
      status: 'processing',
      rowCount: 3,
      invalidCount: 1,
      columnMapping: MAPPING,
      uploadedBy: { id: service.user.id },
    })
    const id: string = res.data.id

    expect(sendMessage).toHaveBeenCalledWith(
      { type: QueueType.CONTACT_UPLOAD_MATCH, data: { uploadId: id } },
      `${MessageGroup.contactUploadMatch}-${slug}`,
      expect.objectContaining({ throwOnError: true }),
    )

    const stored = await service.prisma.contactUpload.findUniqueOrThrow({
      where: { id },
    })
    expect(stored).toMatchObject({
      organizationSlug: slug,
      fileKey: `${slug}/${id}.csv`,
      emailColumn: 'Email',
      landlineColumn: null,
    })
    expect(
      (await rowsOf(id)).map((row) => ({
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        cellPhone: row.cellPhone,
        addressLine: row.addressLine,
        zip: row.zip,
        outcome: row.outcome,
      })),
    ).toEqual([
      {
        firstName: 'Ann',
        lastName: 'Able',
        email: 'ann@example.com',
        cellPhone: '(616) 555-0101',
        addressLine: '123 Oak St',
        zip: '49503',
        outcome: ContactUploadMatchOutcome.pending,
      },
      {
        firstName: 'Ben',
        lastName: null,
        email: 'ben@example.com',
        cellPhone: null,
        addressLine: null,
        zip: null,
        outcome: ContactUploadMatchOutcome.invalid,
      },
      {
        firstName: 'Cal',
        lastName: 'Cole',
        email: null,
        cellPhone: null,
        addressLine: null,
        zip: null,
        outcome: ContactUploadMatchOutcome.pending,
      },
    ])
  })

  it('400s and writes nothing when the file never reached S3', async () => {
    const { data } = await presign(100)

    const res = await create({ uploadId: data.uploadId })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.contactUpload.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(0)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("400s for another org's upload id", async () => {
    const otherSlug = `eo-import-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const { data } = await presign(100, otherSlug)
    bucketObjects.set(
      `${otherSlug}/${data.uploadId}.csv`,
      Buffer.from(`${HEADER_ROW}\nAnn,Able,,,,\n`),
    )

    const res = await create({ uploadId: data.uploadId })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('409s when the same upload id is imported twice', async () => {
    const first = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`)

    const res = await create({ uploadId: first.data.id })

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('400s when the stored file is over 25 MB', async () => {
    const { data } = await presign(100)
    bucketObjects.set(
      `${slug}/${data.uploadId}.csv`,
      Buffer.alloc(CONTACT_UPLOAD_MAX_BYTES + 1),
    )

    const res = await create({ uploadId: data.uploadId })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toBe('upload_too_large')
  })

  it('400s when consent is not affirmed', async () => {
    const res = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`, {
      consentAffirmed: false,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s when a mapped column is missing from the file', async () => {
    const res = await upload('First,Last\nAnn,Able\n')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.contactUpload.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(0)
  })

  it('404s when the flag is off for the org owner', async () => {
    flagOn = false

    const res = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`)
    const list = await service.client.get('/v1/contact-uploads', {
      headers: { [HEADER]: slug },
      validateStatus: () => true,
    })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(list.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s for a Win org even with the flag on', async () => {
    const winSlug = `campaign-import-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug: winSlug, ownerId: service.user.id },
    })

    const res = await upload(
      `${HEADER_ROW}\nAnn,Able,,,,\n`,
      undefined,
      winSlug,
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('the match job', () => {
  it('applies every outcome rule and finishes needing input', async () => {
    const { data } = await upload(
      `${HEADER_ROW}\n` +
        'Ann,Able,ann@example.com,616-555-0101,,\n' +
        'Ben,Baker,,,12 Elm St,48933\n' +
        'Cal,Cole,,616-555-0103,,\n' +
        'Dee,Dunn,,,,\n' +
        'Eve,Eads,,,,\n' +
        'Fay,Fox,fay@example.com,,,\n' +
        'Annie,Able,ann@example.com,,,\n' +
        'Gil,,,,,\n',
    )
    const match = mockMatch([
      candidate(0, PERSON_A, true, false, 1),
      candidate(1, PERSON_B, false, true, 2),
      candidate(2, PERSON_C, true, false, 2),
      candidate(2, PERSON_D, false, true, 2),
      candidate(3, PERSON_D, false, false, 1),
      candidate(4, PERSON_E, false, false, 2),
      candidate(4, PERSON_F, false, false, 2),
    ])

    expect(await runMatch(data.id)).toBe(true)

    expect(match).toHaveBeenCalledTimes(1)
    const [, , inputs] = match.mock.calls[0]!
    expect(inputs.map((input) => input.rowIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(inputs[1]).toEqual({
      rowIndex: 1,
      firstKey: 'ben',
      lastKey: 'baker',
      cell: null,
      landline: null,
      house: '12',
      streetKey: 'elm',
      zip: '48933',
    })

    const rows = await rowsOf(data.id)
    const fay = rows[5]!
    expect(
      rows.map((row) => [
        row.outcome,
        row.method,
        row.personId,
        row.candidatePersonIds,
        row.suggestedPersonId,
      ]),
    ).toEqual([
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.name_and_phone,
        PERSON_A,
        [],
        null,
      ],
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.name_and_address,
        PERSON_B,
        [],
        null,
      ],
      [
        ContactUploadMatchOutcome.needs_input,
        null,
        null,
        [PERSON_C, PERSON_D],
        null,
      ],
      [ContactUploadMatchOutcome.needs_input, null, null, [PERSON_D], PERSON_D],
      [
        ContactUploadMatchOutcome.needs_input,
        null,
        null,
        [PERSON_E, PERSON_F],
        null,
      ],
      [ContactUploadMatchOutcome.new, null, fay.personId, [], null],
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.name_and_phone,
        PERSON_A,
        [],
        null,
      ],
      [ContactUploadMatchOutcome.invalid, null, null, [], null],
    ])
    expect(fay.isNewPerson).toBe(true)
    expect(fay.personId).toMatch(/^[0-9a-f-]{36}$/)

    const finished = await service.prisma.contactUpload.findUniqueOrThrow({
      where: { id: data.id },
    })
    expect(finished).toMatchObject({
      status: ContactUploadStatus.needs_input,
      matchedCount: 3,
      newCount: 1,
      needsInputCount: 3,
      invalidCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      completedAt: null,
    })
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Contacts.ImportCompleted,
      expect.objectContaining({
        rowCount: 8,
        matchedCount: 3,
        newCount: 1,
        ambiguousCount: 3,
        emailsGained: 2,
        isReimport: false,
      }),
    )
  })

  it('completes an upload with no valid rows without asking the warehouse', async () => {
    const { data } = await upload(`${HEADER_ROW}\nAnn,,,,,\n`)
    const match = mockMatch([])

    await runMatch(data.id)

    expect(match).not.toHaveBeenCalled()
    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: data.id },
      }),
    ).toMatchObject({
      status: ContactUploadStatus.complete,
      invalidCount: 1,
      completedAt: expect.any(Date),
    })
  })

  it('matches the org’s earlier uploads first and records what a re-import changed', async () => {
    const first = await upload(
      `${HEADER_ROW}\n` +
        'Ann,Able,ann@example.com,616-555-0101,,\n' +
        'Ben,Baker,,616-555-0102,12 Elm St,48933\n' +
        'Cal,Cole,,,7 Pine Rd,48933\n',
    )
    mockMatch([])
    await runMatch(first.data.id)
    const firstRows = await rowsOf(first.data.id)

    const second = await upload(
      `${HEADER_ROW}\n` +
        'Ann,Able,ANN@example.com,616-555-0199,,\n' +
        'Ben,Baker,,616-555-0102,,\n' +
        'Cal,Cole,,,7 Pine Road,\n',
    )
    const match = mockMatch([])
    await runMatch(second.data.id)

    expect(match).not.toHaveBeenCalled()
    const rows = await rowsOf(second.data.id)
    expect(
      rows.map((row) => [
        row.outcome,
        row.method,
        row.personId,
        row.isNewPerson,
        row.changedFields,
      ]),
    ).toEqual([
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.prior_upload,
        firstRows[0]!.personId,
        true,
        ['cellPhone'],
      ],
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.prior_upload,
        firstRows[1]!.personId,
        true,
        [],
      ],
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.prior_upload,
        firstRows[2]!.personId,
        true,
        ['addressLine'],
      ],
    ])
    const finished = await service.prisma.contactUpload.findUniqueOrThrow({
      where: { id: second.data.id },
    })
    expect(finished).toMatchObject({
      status: ContactUploadStatus.complete,
      matchedCount: 3,
      updatedCount: 2,
      unchangedCount: 1,
    })
    expect(track).toHaveBeenLastCalledWith(
      service.user.id,
      EVENTS.Contacts.ImportCompleted,
      expect.objectContaining({ isReimport: true, emailsGained: 0 }),
    )

    await service.prisma.contactUpload.update({
      where: { id: second.data.id },
      data: { status: ContactUploadStatus.processing },
    })
    await runMatch(second.data.id)
    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: second.data.id },
      }),
    ).toMatchObject({
      status: ContactUploadStatus.complete,
      matchedCount: 3,
      newCount: 0,
      updatedCount: 2,
      unchangedCount: 1,
    })
  })

  it('matches one chunk per delivery and queues the next until no rows are pending', async () => {
    const { data } = await upload(`${HEADER_ROW}
Ann,Able,,,,
`)
    await service.prisma.contactUploadMatch.createMany({
      data: Array.from({ length: MATCH_CHUNK_SIZE }, (_, index) => ({
        uploadId: data.id,
        organizationSlug: slug,
        rowIndex: index + 1,
        firstName: 'Ben',
        lastName: 'Baker',
      })),
    })
    await service.prisma.contactUpload.update({
      where: { id: data.id },
      data: { rowCount: MATCH_CHUNK_SIZE + 1 },
    })
    sendMessage.mockClear()
    const match = mockMatch([])

    expect(await runMatch(data.id)).toBe(true)

    expect(match).toHaveBeenCalledTimes(1)
    expect(match.mock.calls[0]![2]).toHaveLength(MATCH_CHUNK_SIZE)
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      { type: QueueType.CONTACT_UPLOAD_MATCH, data: { uploadId: data.id } },
      `${MessageGroup.contactUploadMatch}-${slug}`,
      {
        throwOnError: true,
        deduplicationId: `${QueueType.CONTACT_UPLOAD_MATCH}-${data.id}-${MATCH_CHUNK_SIZE}`,
      },
    )
    expect(
      await service.prisma.contactUploadMatch.count({
        where: {
          uploadId: data.id,
          outcome: ContactUploadMatchOutcome.pending,
        },
      }),
    ).toBe(1)
    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: data.id },
      }),
    ).toMatchObject({ status: ContactUploadStatus.processing, newCount: 0 })
    expect(track).not.toHaveBeenCalled()

    sendMessage.mockClear()
    expect(await runMatch(data.id)).toBe(true)

    expect(match).toHaveBeenCalledTimes(2)
    expect(match.mock.calls[1]![2].map((input) => input.rowIndex)).toEqual([
      MATCH_CHUNK_SIZE,
    ])
    expect(sendMessage).not.toHaveBeenCalled()
    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: data.id },
      }),
    ).toMatchObject({
      status: ContactUploadStatus.complete,
      newCount: MATCH_CHUNK_SIZE + 1,
    })
  })

  it('sizes a chunk of long rows to fit one Databricks parameter', async () => {
    const { data } = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`)
    await service.prisma.contactUploadMatch.createMany({
      data: Array.from({ length: MATCH_CHUNK_SIZE }, (_, index) => ({
        uploadId: data.id,
        organizationSlug: slug,
        rowIndex: index + 1,
        firstName: 'A'.repeat(60),
        lastName: 'B'.repeat(60),
        cellPhone: `(616) 555-${String(index).padStart(4, '0')}`,
        landline: `(517) 555-${String(index).padStart(4, '0')}`,
        addressLine: `123456 ${'C'.repeat(40)} St`,
        zip: '49503',
      })),
    })
    sendMessage.mockClear()
    const match = mockMatch([])

    expect(await runMatch(data.id)).toBe(true)

    const [, , inputs] = match.mock.calls[0]!
    const { params } = buildContactUploadMatchSql({
      district: {
        districtId: randomUUID(),
        state: 'MI',
        districtType: 'City',
        districtName: 'Lansing',
        useVoterOnlyPath: false,
        dataset: { base: 'constituents' },
        table: '',
      },
      rows: inputs,
    })
    expect(inputs.length).toBeLessThan(MATCH_CHUNK_SIZE)
    expect(params[0]?.value?.length).toBeLessThanOrEqual(
      CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS,
    )
    expect(CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS).toBeLessThan(1_048_576)
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      { type: QueueType.CONTACT_UPLOAD_MATCH, data: { uploadId: data.id } },
      `${MessageGroup.contactUploadMatch}-${slug}`,
      {
        throwOnError: true,
        deduplicationId: `${QueueType.CONTACT_UPLOAD_MATCH}-${data.id}-${inputs.length}`,
      },
    )
    expect(
      await service.prisma.contactUploadMatch.count({
        where: {
          uploadId: data.id,
          outcome: ContactUploadMatchOutcome.pending,
        },
      }),
    ).toBe(MATCH_CHUNK_SIZE + 1 - inputs.length)
  })

  it('reuses the person a name-only row was resolved to by hand', async () => {
    const first = await upload(
      `${HEADER_ROW}\n` +
        'Dee,Dunn,,,,\n' +
        'Dee,Dunn,,,,\n' +
        'Eve,Eads,,,,\n' +
        'Hal,Hart,,,,\n' +
        'Ivy,Ives,,,,\n' +
        'Ivy,Ives,,,,\n' +
        'Jo,Jones,,616-555-0105,,\n',
    )
    mockMatch(
      [0, 1, 2, 3, 4, 5, 6].flatMap((rowIndex) =>
        [PERSON_A, PERSON_B, PERSON_C, PERSON_D].map((personId) =>
          candidate(rowIndex, personId, false, false, 4),
        ),
      ),
    )
    await runMatch(first.data.id)
    const firstRows = await rowsOf(first.data.id)
    const resolutions: [number, object][] = [
      [0, { personId: PERSON_D }],
      [1, { personId: PERSON_D }],
      [2, { skip: true }],
      [3, { newPerson: true }],
      [4, { personId: PERSON_A }],
      [5, { personId: PERSON_B }],
      [6, { personId: PERSON_C }],
    ]
    for (const [rowIndex, body] of resolutions) {
      const res = await service.client.put(
        `/v1/contact-uploads/${first.data.id}/rows/${firstRows[rowIndex]!.id}/match`,
        body,
        { headers: { [HEADER]: slug } },
      )
      expect(res.status).toBe(HttpStatus.OK)
    }
    const hal = (await rowsOf(first.data.id))[3]!

    const second = await upload(
      `${HEADER_ROW}\n` +
        'DEE,dunn,,,,\n' +
        'Eve,Eads,,,,\n' +
        'Hal,Hart,,,,\n' +
        'Ivy,Ives,,,,\n' +
        'Jo,Jones,,,,\n' +
        'Dee,Dunn,,,,48933\n',
    )
    const match = mockMatch([])
    await runMatch(second.data.id)

    expect(match.mock.calls[0]![2].map((input) => input.rowIndex)).toEqual([
      1, 3, 4, 5,
    ])
    const rows = await rowsOf(second.data.id)
    expect(
      [rows[0]!, rows[2]!].map((row) => [
        row.outcome,
        row.method,
        row.personId,
        row.isNewPerson,
      ]),
    ).toEqual([
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.prior_upload,
        PERSON_D,
        false,
      ],
      [
        ContactUploadMatchOutcome.matched,
        ContactUploadMatchMethod.prior_upload,
        hal.personId,
        true,
      ],
    ])
  })

  it('redelivers when the next chunk cannot be queued, keeping the chunk it matched', async () => {
    const { data } = await upload(`${HEADER_ROW}
Ann,Able,,,,
`)
    await service.prisma.contactUploadMatch.createMany({
      data: Array.from({ length: MATCH_CHUNK_SIZE }, (_, index) => ({
        uploadId: data.id,
        organizationSlug: slug,
        rowIndex: index + 1,
        firstName: 'Ben',
        lastName: 'Baker',
      })),
    })
    mockMatch([])
    sendMessage.mockReset().mockRejectedValue(new Error('sqs down'))

    expect(await runMatch(data.id)).toBe(false)

    expect(
      await service.prisma.contactUploadMatch.count({
        where: {
          uploadId: data.id,
          outcome: ContactUploadMatchOutcome.pending,
        },
      }),
    ).toBe(1)
    expect(
      (
        await service.prisma.contactUpload.findUniqueOrThrow({
          where: { id: data.id },
        })
      ).status,
    ).toBe(ContactUploadStatus.processing)
  })

  it('asks SQS to redeliver a failure, and marks the upload failed on the last delivery', async () => {
    const { data } = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`)
    vi.spyOn(
      service.app.get(VoterQueryService),
      'matchContactUploadRows',
    ).mockRejectedValue(new Error('warehouse down'))

    expect(await runMatch(data.id, 1)).toBe(false)
    expect(
      (
        await service.prisma.contactUpload.findUniqueOrThrow({
          where: { id: data.id },
        })
      ).status,
    ).toBe(ContactUploadStatus.processing)

    expect(await runMatch(data.id, 3)).toBe(true)
    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: data.id },
      }),
    ).toMatchObject({
      status: ContactUploadStatus.failed,
      failureReason: 'Matching did not finish',
    })
  })

  it('acks an upload that already finished without touching it', async () => {
    const { data } = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`)
    mockMatch([])
    await runMatch(data.id)
    const match = mockMatch([])

    expect(await runMatch(data.id)).toBe(true)
    expect(match).not.toHaveBeenCalled()
  })
})

describe('review', () => {
  const uploadNeedingInput = async () => {
    const { data } = await upload(
      `${HEADER_ROW}\n` +
        'Cal,Cole,cal@example.com,,,\n' +
        'Dee,Dunn,,,,\n' +
        'Ann,Able,,616-555-0101,,\n',
    )
    mockMatch([
      candidate(0, PERSON_C, false, false, 2),
      candidate(0, PERSON_D, false, false, 2),
      candidate(1, PERSON_D, false, false, 1),
      candidate(2, PERSON_A, true, false, 1),
    ])
    await runMatch(data.id)
    return { uploadId: data.id as string, rows: await rowsOf(data.id) }
  }

  it('pages rows needing input with their candidates, and searches by name and email', async () => {
    const { uploadId } = await uploadNeedingInput()
    const findPeople = vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 0,
          currentPage: 1,
          pageSize: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [
          person(PERSON_C, 'Cal', 'Cole'),
          person(PERSON_D, 'Dee', 'Dunn'),
        ] as never,
      })

    const res = await service.client.get(
      `/v1/contact-uploads/${uploadId}/rows`,
      {
        params: { outcome: 'needs_input', take: 1 },
        headers: { [HEADER]: slug },
      },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.total).toBe(2)
    expect(res.data.nextCursor).toBe(0)
    expect(res.data.rows).toHaveLength(1)
    expect(res.data.rows[0]).toMatchObject({
      rowIndex: 0,
      outcome: 'needs_input',
      candidates: [
        {
          personId: PERSON_C,
          firstName: 'Cal',
          lastName: 'Cole',
          addressLine: '1 Cole St',
          city: 'Lansing',
          zip: '48933',
          age: 40,
        },
        { personId: PERSON_D },
      ],
    })
    const [dto] = findPeople.mock.calls[0]!
    expect(dto.filters.filterOperators.id).toMatchObject({
      operator: 'in',
      values: [PERSON_C, PERSON_D],
    })

    const next = await service.client.get(
      `/v1/contact-uploads/${uploadId}/rows`,
      {
        params: { outcome: 'needs_input', cursor: 0 },
        headers: { [HEADER]: slug },
      },
    )
    expect(
      next.data.rows.map((row: { rowIndex: number }) => row.rowIndex),
    ).toEqual([1])

    const search = await service.client.get(
      `/v1/contact-uploads/${uploadId}/rows`,
      {
        params: { outcome: 'needs_input', search: 'CAL@example' },
        headers: { [HEADER]: slug },
      },
    )
    expect(search.data.total).toBe(1)
    expect(search.data.rows[0].rowIndex).toBe(0)

    const processed = await service.client.get(
      `/v1/contact-uploads/${uploadId}/rows`,
      { headers: { [HEADER]: slug } },
    )
    expect(processed.data.rows).toMatchObject([
      { rowIndex: 2, outcome: 'matched', personId: PERSON_A, candidates: [] },
    ])
  })

  it('resolves rows by candidate, new person or skip, and completes at zero', async () => {
    const { uploadId, rows } = await uploadNeedingInput()
    const put = (rowId: string, body: object) =>
      service.client.put(
        `/v1/contact-uploads/${uploadId}/rows/${rowId}/match`,
        body,
        { headers: { [HEADER]: slug }, validateStatus: () => true },
      )

    const picked = await put(rows[0]!.id, { personId: PERSON_D })
    expect(picked.status).toBe(HttpStatus.OK)
    expect(picked.data).toMatchObject({
      status: 'needs_input',
      needsInputCount: 1,
      matchedCount: 2,
    })

    const created = await put(rows[1]!.id, { newPerson: true })
    expect(created.data).toMatchObject({
      status: 'complete',
      needsInputCount: 0,
      newCount: 1,
      completedAt: expect.any(String),
    })

    const skipped = await put(rows[2]!.id, { skip: true })
    expect(skipped.data).toMatchObject({ matchedCount: 1, skippedCount: 1 })

    const stored = await rowsOf(uploadId)
    expect(
      stored.map((row) => [
        row.outcome,
        row.method,
        row.personId === null,
        row.isNewPerson,
        row.resolvedByUserId,
      ]),
    ).toEqual([
      [
        ContactUploadMatchOutcome.resolved,
        ContactUploadMatchMethod.manual,
        false,
        false,
        service.user.id,
      ],
      [
        ContactUploadMatchOutcome.resolved,
        ContactUploadMatchMethod.manual,
        false,
        true,
        service.user.id,
      ],
      [
        ContactUploadMatchOutcome.skipped,
        ContactUploadMatchMethod.manual,
        true,
        false,
        service.user.id,
      ],
    ])
    expect(stored[0]!.personId).toBe(PERSON_D)
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Contacts.AmbiguousRowResolved,
      { resolution: 'person', rowIndex: 0 },
    )
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Contacts.MatchChanged,
      { from: 'l2', to: 'none' },
    )
  })

  it('checks a person outside the candidates is one the org can read', async () => {
    const { uploadId, rows } = await uploadNeedingInput()
    const findPerson = vi
      .spyOn(service.app.get(ContactsService), 'findPerson')
      .mockResolvedValue({} as never)

    const res = await service.client.put(
      `/v1/contact-uploads/${uploadId}/rows/${rows[2]!.id}/match`,
      { personId: PERSON_E },
      { headers: { [HEADER]: slug } },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(findPerson).toHaveBeenCalledWith(
      PERSON_E,
      expect.objectContaining({ slug }),
    )
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Contacts.MatchChanged,
      { from: 'l2', to: 'l2' },
    )
  })

  it('accepts every lone suggestion in one go', async () => {
    const { uploadId } = await uploadNeedingInput()

    const res = await service.client.post(
      `/v1/contact-uploads/${uploadId}/accept-suggested`,
      {},
      { headers: { [HEADER]: slug } },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({
      accepted: 1,
      upload: { needsInputCount: 1, matchedCount: 2, status: 'needs_input' },
    })
    const dee = (await rowsOf(uploadId))[1]!
    expect(dee).toMatchObject({
      outcome: ContactUploadMatchOutcome.resolved,
      method: ContactUploadMatchMethod.manual,
      personId: PERSON_D,
      resolvedByUserId: service.user.id,
    })
  })

  it('404s another org’s upload', async () => {
    const { uploadId } = await uploadNeedingInput()
    const otherSlug = `eo-other-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })

    const res = await service.client.get(`/v1/contact-uploads/${uploadId}`, {
      headers: { [HEADER]: otherSlug },
      validateStatus: () => true,
    })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/contact-uploads/:id/retry', () => {
  const failedUpload = async () => {
    const { data } = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`)
    await service.prisma.contactUpload.update({
      where: { id: data.id },
      data: {
        status: ContactUploadStatus.failed,
        failureReason: 'Matching did not finish',
      },
    })
    sendMessage.mockClear()
    return data.id as string
  }

  const retry = (uploadId: string, orgSlug = slug) =>
    service.client.post(
      `/v1/contact-uploads/${uploadId}/retry`,
      {},
      { headers: { [HEADER]: orgSlug }, validateStatus: () => true },
    )

  it('puts a failed upload back to processing and queues matching again', async () => {
    const uploadId = await failedUpload()

    const res = await retry(uploadId)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({
      id: uploadId,
      status: 'processing',
      failureReason: null,
    })
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      { type: QueueType.CONTACT_UPLOAD_MATCH, data: { uploadId } },
      `${MessageGroup.contactUploadMatch}-${slug}`,
      { throwOnError: true },
    )

    mockMatch([])
    await runMatch(uploadId)
    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: uploadId },
      }),
    ).toMatchObject({ status: ContactUploadStatus.complete, newCount: 1 })
  })

  it('409s an upload that has not failed', async () => {
    const { data } = await upload(`${HEADER_ROW}\nAnn,Able,,,,\n`)
    sendMessage.mockClear()

    const res = await retry(data.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('502s and stays failed when matching cannot be queued', async () => {
    const uploadId = await failedUpload()
    sendMessage.mockRejectedValue(new Error('sqs down'))

    const res = await retry(uploadId)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: uploadId },
      }),
    ).toMatchObject({
      status: ContactUploadStatus.failed,
      failureReason: 'Matching could not be started',
    })
  })

  it('404s when the flag is off, and for another org’s upload', async () => {
    const uploadId = await failedUpload()
    const otherSlug = `eo-other-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })

    expect((await retry(uploadId, otherSlug)).status).toBe(HttpStatus.NOT_FOUND)
    flagOn = false
    expect((await retry(uploadId)).status).toBe(HttpStatus.NOT_FOUND)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('GET /v1/contacts/:personId/sources', () => {
  it('names the latest upload per field and falls back to the constituent file', async () => {
    const first = await upload(
      `${HEADER_ROW}\nAnn,Able,ann@example.com,616-555-0101,,\n`,
    )
    mockMatch([candidate(0, PERSON_A, true, false, 1)])
    await runMatch(first.data.id)
    const second = await upload(`${HEADER_ROW}\nAnn,Able,,616-555-0101,,\n`, {
      name: 'Ward 3 event',
    })
    await runMatch(second.data.id)

    const res = await service.client.get(`/v1/contacts/${PERSON_A}/sources`, {
      headers: { [HEADER]: slug },
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.fields).toEqual({
      email: {
        kind: 'upload',
        uploadId: first.data.id,
        uploadName: 'Newsletter',
        uploadedAt: first.data.createdAt,
      },
      cellPhone: {
        kind: 'upload',
        uploadId: second.data.id,
        uploadName: 'Ward 3 event',
        uploadedAt: second.data.createdAt,
      },
      landline: { kind: 'constituent_file' },
      address: { kind: 'constituent_file' },
    })
    expect(
      res.data.uploadRows.map((row: { uploadId: string }) => row.uploadId),
    ).toEqual([second.data.id, first.data.id])
    expect(res.data.hasActivity).toBe(false)

    await service.prisma.contactNote.create({
      data: { organizationSlug: slug, personId: PERSON_A, body: 'Called' },
    })
    const withNote = await service.client.get(
      `/v1/contacts/${PERSON_A}/sources`,
      { headers: { [HEADER]: slug } },
    )
    expect(withNote.data.hasActivity).toBe(true)
  })

  it('404s when the flag is off', async () => {
    flagOn = false

    const res = await service.client.get(`/v1/contacts/${PERSON_A}/sources`, {
      headers: { [HEADER]: slug },
      validateStatus: () => true,
    })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('the person activity feed', () => {
  it('lists the upload rows pointing at the person', async () => {
    const { data } = await upload(
      `${HEADER_ROW}\nAnn,Able,ann@example.com,616-555-0101,,\nDee,Dunn,,,,\n`,
    )
    mockMatch([
      candidate(0, PERSON_A, true, false, 1),
      candidate(1, PERSON_A, false, false, 1),
    ])
    await runMatch(data.id)
    const rows = await rowsOf(data.id)
    await service.client.put(
      `/v1/contact-uploads/${data.id}/rows/${rows[1]!.id}/match`,
      { personId: PERSON_A },
      { headers: { [HEADER]: slug } },
    )

    const res = await service.client.get(
      `/v1/contact-engagement/${PERSON_A}/activities`,
      { headers: { [HEADER]: slug } },
    )

    expect(res.status).toBe(HttpStatus.OK)
    const imports = res.data.results.filter(
      (item: { type: string }) =>
        item.type === ConstituentActivityType.CONTACT_IMPORT,
    )
    expect(imports).toHaveLength(2)
    expect(imports[0].data).toMatchObject({
      activityId: rows[1]!.id,
      uploadName: 'Newsletter',
      isNewPerson: false,
      isFirstImport: false,
      suppliedFields: ['firstName', 'lastName'],
      manual: true,
      actorUserId: service.user.id,
    })
    expect(imports[1]).toMatchObject({
      date: data.createdAt,
      data: {
        activityId: rows[0]!.id,
        uploadId: data.id,
        isFirstImport: true,
        suppliedFields: ['firstName', 'lastName', 'email', 'cellPhone'],
        changedFields: [],
        manual: false,
        actorName: null,
      },
    })

    const page = await service.client.get(
      `/v1/contact-engagement/${PERSON_A}/activities`,
      { params: { take: 1 }, headers: { [HEADER]: slug } },
    )
    expect(page.data.results).toHaveLength(1)
    const rest = await service.client.get(
      `/v1/contact-engagement/${PERSON_A}/activities`,
      {
        params: { take: 1, after: page.data.nextCursor },
        headers: { [HEADER]: slug },
      },
    )
    expect(rest.data.results[0].data.activityId).toBe(rows[0]!.id)
  })

  it('marks only the upload that created a new person as its first import', async () => {
    mockMatch([])
    const first = await upload(`${HEADER_ROW}\nAnn,Able,ann@example.com,,,\n`)
    await runMatch(first.data.id)
    const [created] = await rowsOf(first.data.id)
    const second = await upload(
      `${HEADER_ROW}\nAnn,Able,ann@example.com,,,\n`,
      { name: 'Ward 3 event' },
    )
    expect(second.status).toBe(HttpStatus.CREATED)
    await runMatch(second.data.id)
    const [later] = await rowsOf(second.data.id)
    expect(later).toMatchObject({
      personId: created!.personId,
      isNewPerson: true,
      changedFields: [],
    })

    const res = await service.client.get(
      `/v1/contact-engagement/${created!.personId}/activities`,
      { headers: { [HEADER]: slug } },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(
      res.data.results.map(
        (item: { data: { activityId: string; isFirstImport: boolean } }) => ({
          activityId: item.data.activityId,
          isFirstImport: item.data.isFirstImport,
        }),
      ),
    ).toEqual([
      { activityId: later!.id, isFirstImport: false },
      { activityId: created!.id, isFirstImport: true },
    ])
  })
})
