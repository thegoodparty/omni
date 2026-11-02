import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { addHours, subHours } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactUploadStatus } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ContactUploadAbandonedSweepService } from '../services/contactUploadAbandonedSweep.service'

const service = useTestService()

let slug: string

const uploadData = (status: ContactUploadStatus, createdAt: Date) => {
  const id = randomUUID()
  return {
    id,
    organizationSlug: slug,
    name: 'Newsletter',
    fileName: 'people.csv',
    fileKey: `${slug}/${id}.csv`,
    firstNameColumn: 'First',
    lastNameColumn: 'Last',
    consentAffirmedAt: createdAt,
    status,
    createdAt,
  }
}

const seedUpload = (status: ContactUploadStatus, createdAt: Date) =>
  service.prisma.contactUpload.create({ data: uploadData(status, createdAt) })

const exists = async (id: string) =>
  (await service.prisma.contactUpload.count({ where: { id } })) === 1

const sweeper = () => service.app.get(ContactUploadAbandonedSweepService)

const mockPurge = () =>
  vi
    .spyOn(service.app.get(S3Service), 'deleteAllObjectVersions')
    .mockResolvedValue(1)

beforeEach(async () => {
  slug = `eo-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
})

describe('ContactUploadAbandonedSweepService', () => {
  it('deletes uploads waiting for their file over a day, and their files', async () => {
    const now = new Date()
    const abandoned = await seedUpload(
      ContactUploadStatus.awaiting_file,
      subHours(now, 25),
    )
    const recent = await seedUpload(
      ContactUploadStatus.awaiting_file,
      subHours(now, 23),
    )
    const imported = await seedUpload(
      ContactUploadStatus.complete,
      subHours(now, 48),
    )
    const purge = mockPurge()

    await sweeper().sweep(now)

    expect(purge).toHaveBeenCalledTimes(1)
    expect(purge).toHaveBeenCalledWith(process.env.CONTACT_UPLOADS_BUCKET, [
      abandoned.fileKey,
    ])
    expect(await exists(abandoned.id)).toBe(false)
    expect(await exists(recent.id)).toBe(true)
    expect(await exists(imported.id)).toBe(true)
  })

  it('keeps the upload when its file does not delete, for the next run', async () => {
    const now = new Date()
    const abandoned = await seedUpload(
      ContactUploadStatus.awaiting_file,
      subHours(now, 25),
    )
    vi.spyOn(
      service.app.get(S3Service),
      'deleteAllObjectVersions',
    ).mockRejectedValue(new BadGatewayException('Error communicating with AWS'))

    await sweeper().sweep(now)
    expect(await exists(abandoned.id)).toBe(true)

    mockPurge()
    await sweeper().sweep(addHours(now, 1))
    expect(await exists(abandoned.id)).toBe(false)
  })

  it('deletes at most 200 uploads a run, oldest first', async () => {
    const now = new Date()
    await service.prisma.contactUpload.createMany({
      data: Array.from({ length: 201 }, (_, i) =>
        uploadData(ContactUploadStatus.awaiting_file, subHours(now, 30 + i)),
      ),
    })
    mockPurge()

    await sweeper().sweep(now)

    const left = await service.prisma.contactUpload.findMany({
      where: { organizationSlug: slug },
    })
    expect(left).toHaveLength(1)
    expect(left[0]?.createdAt).toEqual(subHours(now, 30))
  })

  // Prod runs more than one replica, and each fires the same @Cron.
  it('runs once per hourly slot', async () => {
    const now = new Date()
    mockPurge()
    await sweeper().sweep(now)
    const abandoned = await seedUpload(
      ContactUploadStatus.awaiting_file,
      subHours(now, 25),
    )

    await sweeper().sweep(now)
    expect(await exists(abandoned.id)).toBe(true)

    await sweeper().sweep(addHours(now, 1))
    expect(await exists(abandoned.id)).toBe(false)
  })
})
