import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { HttpStatus } from '@nestjs/common'
import { expect, it, vi } from 'vitest'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { ContactUploadStatus } from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { ElectionDistrictService } from '@/peopleDb/services/electionDistrict.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { JobsService } from '@/jobs/jobs.service'
import { EVENTS } from '@/vendors/segment/segment.types'

// Its own suite: the test shuts down the app's JobsService, and with it
// every worker the suite has.
const service = useTestService({ jobs: true })

const HEADER = 'x-organization-slug'

it('leaves the upload processing when its last attempt throws during a shutdown', async () => {
  const slug = `eo-import-${randomUUID()}`
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
  const file = Buffer.from('First,Last\nAnn,Able\n')
  vi.spyOn(
    service.app.get(S3Service),
    'getSignedUrlForSizedUpload',
  ).mockResolvedValue('https://s3.example/put?sig=1')
  vi.spyOn(service.app.get(S3Service), 'headObject').mockResolvedValue({
    contentLength: file.length,
  })
  vi.spyOn(service.app.get(S3Service), 'getFileStream').mockImplementation(
    async () => Readable.from([file]),
  )
  const track = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined)
  let stopping: Promise<void> | undefined
  let calls = 0
  vi.spyOn(
    service.app.get(VoterQueryService),
    'matchContactUploadRows',
  ).mockImplementation(async () => {
    calls++
    // The sixth and last attempt fails while this task shuts down.
    if (calls === 6) stopping = service.app.get(JobsService).onModuleDestroy()
    throw new Error('Databricks down')
  })

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
        email: null,
        cellPhone: null,
        landline: null,
        addressLine: null,
        city: null,
        zip: null,
      },
    },
    { headers: { [HEADER]: slug } },
  )
  const uploadId: string = presign.data.uploadId
  const confirm = await service.client.post(
    `/v1/contact-uploads/${uploadId}/uploaded`,
    {},
    { headers: { [HEADER]: slug } },
  )
  expect(confirm.status).toBe(HttpStatus.OK)
  await vi.waitFor(() => expect(stopping).toBeDefined(), { timeout: 15_000 })
  await stopping

  // Requeued at its last attempt, so it runs again rather than failing.
  const jobs = await service.prisma.$queryRaw<
    Array<{ state: string; retry_count: number }>
  >`SELECT state::text, retry_count FROM pgboss.job
    WHERE name = 'contactUploadProcess'`
  expect(jobs).toEqual([{ state: 'retry', retry_count: 5 }])
  const upload = await service.prisma.contactUpload.findUniqueOrThrow({
    where: { id: uploadId },
  })
  expect(upload).toMatchObject({
    status: ContactUploadStatus.processing,
    failureReason: null,
    failureKind: null,
  })
  expect(track).not.toHaveBeenCalledWith(
    expect.anything(),
    EVENTS.Contacts.ImportFailed,
    expect.anything(),
  )
})
