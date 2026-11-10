import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { ContactUploadStatus } from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { ElectionDistrictService } from '@/peopleDb/services/electionDistrict.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { AnalyticsService } from '@/analytics/analytics.service'

const service = useTestService({ jobs: true })

const HEADER = 'x-organization-slug'
const PERSON_A = '0a0a0a0a-0000-4000-8000-00000000000a'

let slug: string
const bucketObjects = new Map<string, Buffer>()

beforeEach(async () => {
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
    async ({ feature }) => feature === SERVE_IMPORT_CONTACTS_FLAG,
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
  vi.spyOn(
    service.app.get(S3Service),
    'getSignedUrlForSizedUpload',
  ).mockResolvedValue('https://s3.example/put?sig=1')
  vi.spyOn(service.app.get(S3Service), 'headObject').mockImplementation(
    async (bucket, key) => {
      const file =
        bucket === process.env.CONTACT_UPLOADS_BUCKET
          ? bucketObjects.get(key)
          : undefined
      return file ? { contentLength: file.length } : null
    },
  )
  vi.spyOn(service.app.get(S3Service), 'getFileStream').mockImplementation(
    async (bucket, key) => {
      const file =
        bucket === process.env.CONTACT_UPLOADS_BUCKET
          ? bucketObjects.get(key)
          : undefined
      return file ? Readable.from([file]) : undefined
    },
  )
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(
    vi.fn().mockResolvedValue(undefined),
  )
})

describe('the contactUploadProcess job', () => {
  it('imports a confirmed upload on its pg-boss worker', async () => {
    vi.spyOn(
      service.app.get(VoterQueryService),
      'matchContactUploadRows',
    ).mockResolvedValue([
      {
        rowIndex: 0,
        personId: PERSON_A,
        firstNameMatch: 'exact',
        phoneAgrees: true,
        addressAgrees: false,
        candidateCount: 1,
      },
    ])
    const file = Buffer.from(
      'First,Last,Email,Cell\n' +
        'Ann,Able,ann@example.com,616-555-0101\n' +
        'Ben,Baker,,\n',
    )
    const presign = await service.client.post(
      '/v1/contact-uploads/presign',
      {
        byteSize: file.length,
        fileName: 'people.csv',
        name: 'Newsletter',
        consentAffirmed: true,
        columnMapping: {
          firstName: 'First',
          lastName: 'Last',
          email: 'Email',
          cellPhone: 'Cell',
          landline: null,
          addressLine: null,
          city: null,
          zip: null,
        },
      },
      { headers: { [HEADER]: slug } },
    )
    const uploadId: string = presign.data.uploadId
    bucketObjects.set(`${slug}/${uploadId}.csv`, file)

    const confirm = await service.client.post(
      `/v1/contact-uploads/${uploadId}/uploaded`,
      {},
      { headers: { [HEADER]: slug } },
    )
    expect(confirm.status).toBe(HttpStatus.OK)
    await service.jobs.settle()

    expect(
      await service.prisma.contactUpload.findUniqueOrThrow({
        where: { id: uploadId },
      }),
    ).toMatchObject({
      status: ContactUploadStatus.complete,
      rowCount: 2,
      matchedCount: 1,
      newCount: 1,
      completedAt: expect.any(Date),
    })
  })
})

describe('the contactUploadStuckSweep schedule', () => {
  // Processing, sent with a job pg-boss no longer holds.
  const processingUpload = (
    organizationSlug: string,
    processJobId: string | null,
  ) =>
    service.prisma.contactUpload.create({
      data: {
        organizationSlug,
        name: 'Newsletter',
        fileName: 'people.csv',
        fileKey: `${organizationSlug}/${randomUUID()}.csv`,
        firstNameColumn: 'First',
        lastNameColumn: 'Last',
        consentAffirmedAt: new Date(),
        status: ContactUploadStatus.processing,
        processJobId,
      },
    })

  it('fails uploads whose job is gone, in every organization', async () => {
    const otherSlug = `eo-import-${randomUUID()}`
    await service.prisma.organization.create({
      data: {
        slug: otherSlug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    const here = await processingUpload(slug, randomUUID())
    const there = await processingUpload(otherSlug, randomUUID())
    const legacy = await processingUpload(slug, null)

    await service.jobs.runSchedule('contactUploadStuckSweep')

    const status = async (id: string) =>
      (await service.prisma.contactUpload.findUniqueOrThrow({ where: { id } }))
        .status
    expect(await status(here.id)).toBe(ContactUploadStatus.failed)
    expect(await status(there.id)).toBe(ContactUploadStatus.failed)
    expect(await status(legacy.id)).toBe(ContactUploadStatus.processing)
  })
})
