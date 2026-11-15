import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { subHours } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactUploadStatus } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'

const service = useTestService({ jobs: true })

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

const runSweep = () => service.jobs.runSchedule('contactUploadAbandonedSweep')

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

describe('the contactUploadAbandonedSweep schedule', () => {
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

    await runSweep()

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

    const { deadLetters } = await service.jobs.runSchedule(
      'contactUploadAbandonedSweep',
      { allowDeadLetters: true },
    )
    expect(deadLetters).toEqual([
      {
        name: 'contactUploadAbandonedDelete',
        data: { uploadId: abandoned.id },
        error: 'Error communicating with AWS',
      },
    ])
    expect(await exists(abandoned.id)).toBe(true)

    mockPurge()
    await service.jobs.runSchedule('contactUploadAbandonedSweep', {
      allowDeadLetters: true,
    })
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

    await service.jobs.runSchedule('contactUploadAbandonedSweep', {
      timeoutMs: 60_000,
    })

    const left = await service.prisma.contactUpload.findMany({
      where: { organizationSlug: slug },
    })
    expect(left).toHaveLength(1)
    expect(left[0]?.createdAt).toEqual(subHours(now, 30))
  })
})
