import { describe, expect, it, vi } from 'vitest'
import { ATTACHMENT_MAX_BYTES } from '@goodparty_org/contracts'
import { ExperimentRunStatus, OcrStatus } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OcrService } from '@/ocr/ocr.service'

const service = useTestService({ jobs: true })

const seedElectedOffice = async (orgSlug: string, userId?: number) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: userId ?? service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: {
      organizationSlug: orgSlug,
      userId: userId ?? service.user.id,
    },
  })
}

const seedBriefingAndNote = async (
  orgSlug: string,
  userId: number = service.user.id,
  authorUserId: number = userId,
) => {
  const eo = await seedElectedOffice(orgSlug, userId)
  const briefingRun = await service.prisma.experimentRun.create({
    data: {
      organizationSlug: orgSlug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
    },
  })
  const briefing = await service.prisma.meetingBriefing.create({
    data: {
      electedOfficeId: eo.id,
      meetingDate: new Date('2026-06-08T00:00:00Z'),
      meetingTime: '19:00',
      meetingTimezone: 'America/Denver',
      experimentRunId: briefingRun.runId,
      artifactBucket: 'briefing-bucket',
      artifactKey: '2026-06-08.json',
    },
  })
  const annotation = await service.prisma.annotation.create({
    data: {
      author: { connect: { id: authorUserId } },
      kind: 'note',
      resourceType: 'briefing',
      resourceId: briefing.id,
      note: { create: { body: null } },
    },
    include: { note: true },
  })
  return { eo, briefing, annotation, noteId: annotation.noteId! }
}

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const validPresign = {
  file_name: 'photo.jpg',
  mime_type: 'image/jpeg' as const,
  size_bytes: 1_500_000,
}

const mockS3 = () => {
  const s3 = service.app.get(S3Service)
  return {
    upload: vi
      .spyOn(s3, 'getSignedUrlForUpload')
      .mockResolvedValue('https://s3.example/upload-url'),
    view: vi
      .spyOn(s3, 'getSignedUrlForViewing')
      .mockResolvedValue('https://s3.example/download-url'),
    exists: vi.spyOn(s3, 'objectExists').mockResolvedValue(true),
    head: vi.spyOn(s3, 'headObject').mockResolvedValue({ contentLength: 1234 }),
    get: vi.spyOn(s3, 'getFileBytes').mockResolvedValue(Buffer.from('binary')),
    del: vi.spyOn(s3, 'deleteObject').mockResolvedValue(undefined),
  }
}

const mockOcr = (text: string) =>
  vi.spyOn(service.app.get(OcrService), 'process').mockResolvedValue({
    text,
    confidence: 0.95,
    meta: { provider: 'fake' },
    ocrStatus: OcrStatus.completed,
  })

// Presigns and completes an upload the way the briefing note sheet does,
// then lets the ocrAttachment job run.
const uploadAndSettle = async (annotationId: string, orgSlug: string) => {
  const presign = await service.client.post(
    `/v1/annotations/${annotationId}/note/attachments/presign`,
    validPresign,
    orgHeader(orgSlug),
  )
  expect(presign.status).toBe(201)
  const attachmentId: string = presign.data.attachment_id
  const complete = await service.client.post(
    `/v1/annotations/${annotationId}/note/attachments/${attachmentId}/complete`,
    {},
    orgHeader(orgSlug),
  )
  expect(complete.status).toBe(204)
  await service.jobs.settle()
  return attachmentId
}

describe('POST /v1/annotations/:annotationId/note/attachments/presign', () => {
  it('returns a signed URL and creates a pending attachment row', async () => {
    const { annotation, noteId } = await seedBriefingAndNote('eo-presign')
    const s3 = mockS3()

    const result = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-presign'),
    )

    expect(result.status).toBe(201)
    expect(result.data).toMatchObject({
      upload_url: 'https://s3.example/upload-url',
    })
    expect(typeof result.data.attachment_id).toBe('string')

    const row = await service.prisma.annotationNoteAttachment.findUnique({
      where: { id: result.data.attachment_id },
    })
    expect(row).toMatchObject({
      noteId,
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1_500_000,
      ocrStatus: OcrStatus.pending,
    })
    expect(s3.upload).toHaveBeenCalledOnce()
  })

  it('rejects another attachment once the per-note cap is reached', async () => {
    const { annotation } = await seedBriefingAndNote('eo-cap')
    mockS3()

    // The service caps attachments at 20 per note. Fill it up, then assert
    // the 21st request is forbidden.
    for (let i = 0; i < 20; i++) {
      const accepted = await service.client.post(
        `/v1/annotations/${annotation.id}/note/attachments/presign`,
        validPresign,
        orgHeader('eo-cap'),
      )
      expect(accepted.status).toBe(201)
    }

    const overflow = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-cap'),
    )
    expect(overflow.status).toBe(403)
  })

  it('rejects disallowed mime types', async () => {
    const { annotation } = await seedBriefingAndNote('eo-mime')
    mockS3()

    const result = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      { ...validPresign, mime_type: 'application/zip' },
      orgHeader('eo-mime'),
    )

    expect(result.status).toBe(400)
  })

  it('rejects files larger than the 20 MB cap', async () => {
    const { annotation } = await seedBriefingAndNote('eo-size')
    mockS3()

    const result = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      { ...validPresign, size_bytes: 21 * 1024 * 1024 },
      orgHeader('eo-size'),
    )

    expect(result.status).toBe(400)
  })

  it('rejects when the annotation belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: 'other_presign',
        email: 'other@goodparty.org',
        firstName: 'A',
        lastName: 'B',
      },
    })
    const { annotation } = await seedBriefingAndNote('eo-foreign', otherUser.id)

    // The requesting user owns a different elected office so the org-header
    // route resolves to "no access" before the author check fires.
    await seedElectedOffice('eo-mine-presign')
    mockS3()

    const result = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-mine-presign'),
    )

    expect(result.status).toBe(403)
  })
})

describe('POST /v1/annotations/:annotationId/note/attachments/:attachmentId/complete', () => {
  it('runs OCR on the ocrAttachment job once S3 confirms the upload', async () => {
    const { annotation } = await seedBriefingAndNote('eo-complete')
    const s3 = mockS3()
    const ocr = mockOcr('detected text')

    const attachmentId = await uploadAndSettle(annotation.id, 'eo-complete')

    expect(s3.head).toHaveBeenCalled()
    expect(ocr).toHaveBeenCalledOnce()
    const row = await service.prisma.annotationNoteAttachment.findUnique({
      where: { id: attachmentId },
    })
    expect(row?.ocrStatus).toBe(OcrStatus.completed)
  })

  it('returns 400 when the file has not actually landed in S3', async () => {
    const { annotation } = await seedBriefingAndNote('eo-missing-upload')
    const s3 = mockS3()
    s3.head.mockResolvedValueOnce(null)

    const presign = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-missing-upload'),
    )

    const result = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/${presign.data.attachment_id}/complete`,
      {},
      orgHeader('eo-missing-upload'),
    )

    expect(result.status).toBe(400)
  })

  it('returns 400 when the uploaded object exceeds the size cap', async () => {
    const { annotation } = await seedBriefingAndNote('eo-too-large')
    const s3 = mockS3()
    s3.head.mockResolvedValueOnce({ contentLength: ATTACHMENT_MAX_BYTES + 1 })
    const ocr = mockOcr('never read')

    const presign = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-too-large'),
    )

    const result = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/${presign.data.attachment_id}/complete`,
      {},
      orgHeader('eo-too-large'),
    )

    expect(result.status).toBe(400)
    // The OCR job must NOT run for an over-cap object.
    await service.jobs.settle()
    expect(ocr).not.toHaveBeenCalled()
  })

  it('returns 400 when S3 HEAD reports an unverifiable (null) Content-Length', async () => {
    const { annotation } = await seedBriefingAndNote('eo-null-length')
    const s3 = mockS3()
    s3.head.mockResolvedValueOnce({ contentLength: null })
    const ocr = mockOcr('never read')

    const presign = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-null-length'),
    )

    const result = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/${presign.data.attachment_id}/complete`,
      {},
      orgHeader('eo-null-length'),
    )

    expect(result.status).toBe(400)
    await service.jobs.settle()
    expect(ocr).not.toHaveBeenCalled()
  })
})

describe('GET /v1/annotations/:annotationId/note/attachments/:attachmentId/download-url', () => {
  it('returns a presigned S3 GET URL plus an ISO expiry', async () => {
    const { annotation } = await seedBriefingAndNote('eo-download')
    const s3 = mockS3()

    const presign = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-download'),
    )
    expect(presign.status).toBe(201)
    const attachmentId = presign.data.attachment_id

    const result = await service.client.get(
      `/v1/annotations/${annotation.id}/note/attachments/${attachmentId}/download-url`,
      orgHeader('eo-download'),
    )

    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      download_url: 'https://s3.example/download-url',
    })
    expect(typeof result.data.expires_at).toBe('string')
    expect(Number.isNaN(Date.parse(result.data.expires_at))).toBe(false)
    expect(s3.view).toHaveBeenCalledOnce()
  })

  it('returns 404 for an unknown attachment id', async () => {
    const { annotation } = await seedBriefingAndNote('eo-download-missing')
    mockS3()

    const result = await service.client.get(
      `/v1/annotations/${annotation.id}/note/attachments/does-not-exist/download-url`,
      orgHeader('eo-download-missing'),
    )

    expect(result.status).toBe(404)
  })

  it('rejects access through an elected office that does not own the briefing', async () => {
    // The briefing lives under another user's elected office, but the
    // calling (default) user authored the annotation. Since a user owns at
    // most one elected office, the caller reaches the annotation through
    // their own office header and the briefing-access check must 403.
    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: 'other_download',
        email: 'other-download@goodparty.org',
        firstName: 'A',
        lastName: 'B',
      },
    })
    const { annotation, noteId } = await seedBriefingAndNote(
      'eo-download-foreign',
      otherUser.id,
      service.user.id,
    )
    const attachment = await service.prisma.annotationNoteAttachment.create({
      data: {
        noteId,
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1_500_000,
        storageKey: `annotations/${annotation.id}/seed`,
        ocrStatus: OcrStatus.pending,
      },
    })
    mockS3()

    await seedElectedOffice('eo-download-mine')
    const result = await service.client.get(
      `/v1/annotations/${annotation.id}/note/attachments/${attachment.id}/download-url`,
      orgHeader('eo-download-mine'),
    )

    expect(result.status).toBe(403)
  })

  it('rejects callers who did not author the annotation', async () => {
    // Annotation is authored by another user, but the briefing lives under
    // the requesting user's own elected office. Only the author check should
    // fire; if it were removed the briefing-access check would pass and the
    // request would succeed, making this a true regression guard.
    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: 'other_download_author',
        email: 'other-download-author@goodparty.org',
        firstName: 'A',
        lastName: 'B',
      },
    })
    const { annotation, noteId } = await seedBriefingAndNote(
      'eo-download-mine-author',
      service.user.id,
      otherUser.id,
    )
    const attachment = await service.prisma.annotationNoteAttachment.create({
      data: {
        noteId,
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1_500_000,
        storageKey: `annotations/${annotation.id}/seed`,
        ocrStatus: OcrStatus.pending,
      },
    })
    mockS3()

    const result = await service.client.get(
      `/v1/annotations/${annotation.id}/note/attachments/${attachment.id}/download-url`,
      orgHeader('eo-download-mine-author'),
    )

    expect(result.status).toBe(403)
  })
})

describe('DELETE /v1/annotations/:annotationId/note/attachments/:attachmentId', () => {
  it('removes the attachment row and best-effort deletes the S3 object', async () => {
    const { annotation } = await seedBriefingAndNote('eo-delete-att')
    const s3 = mockS3()

    const presign = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-delete-att'),
    )
    expect(presign.status).toBe(201)
    const attachmentId = presign.data.attachment_id

    const result = await service.client.delete(
      `/v1/annotations/${annotation.id}/note/attachments/${attachmentId}`,
      orgHeader('eo-delete-att'),
    )

    expect(result.status).toBe(204)
    expect(
      await service.prisma.annotationNoteAttachment.findUnique({
        where: { id: attachmentId },
      }),
    ).toBeNull()
    expect(s3.del).toHaveBeenCalled()
  })

  it('returns 404 when the attachment does not exist', async () => {
    const { annotation } = await seedBriefingAndNote('eo-delete-missing')
    mockS3()

    const result = await service.client.delete(
      `/v1/annotations/${annotation.id}/note/attachments/does-not-exist`,
      orgHeader('eo-delete-missing'),
    )

    expect(result.status).toBe(404)
  })
})

describe('the ocrAttachment job', () => {
  it('writes ocrText and completed status on success', async () => {
    const { annotation } = await seedBriefingAndNote('eo-ocr-success')
    mockS3()
    mockOcr('detected text')

    const attachmentId = await uploadAndSettle(annotation.id, 'eo-ocr-success')

    const row = await service.prisma.annotationNoteAttachment.findUnique({
      where: { id: attachmentId },
    })
    expect(row?.ocrStatus).toBe(OcrStatus.completed)
    expect(row?.ocrText).toBe('detected text')
    expect(row?.ocrCompletedAt).not.toBeNull()
  })

  it('backfills the parent note body with OCR text when body was null', async () => {
    const { annotation, noteId } = await seedBriefingAndNote('eo-ocr-backfill')
    mockS3()
    mockOcr('extracted body content')

    await uploadAndSettle(annotation.id, 'eo-ocr-backfill')

    const note = await service.prisma.annotationNote.findUnique({
      where: { id: noteId },
    })
    expect(note?.body).toBe('extracted body content')
  })

  it('does not overwrite a body the user typed', async () => {
    const eo = await seedElectedOffice('eo-ocr-noclobber')
    const briefing = await service.prisma.experimentRun
      .create({
        data: {
          organizationSlug: 'eo-ocr-noclobber',
          experimentType: 'meeting_briefing',
          status: ExperimentRunStatus.COMPLETED,
        },
      })
      .then((run) =>
        service.prisma.meetingBriefing.create({
          data: {
            electedOfficeId: eo.id,
            meetingDate: new Date('2026-06-08T00:00:00Z'),
            meetingTime: '19:00',
            meetingTimezone: 'America/Denver',
            experimentRunId: run.runId,
            artifactBucket: 'briefing-bucket',
            artifactKey: 'noclobber.json',
          },
        }),
      )
    const annotation = await service.prisma.annotation.create({
      data: {
        author: { connect: { id: service.user.id } },
        kind: 'note',
        resourceType: 'briefing',
        resourceId: briefing.id,
        note: { create: { body: 'user-typed caption' } },
      },
      include: { note: true },
    })
    mockS3()
    mockOcr('OCR text that should NOT win')

    await uploadAndSettle(annotation.id, 'eo-ocr-noclobber')

    const note = await service.prisma.annotationNote.findUnique({
      where: { id: annotation.noteId! },
    })
    expect(note?.body).toBe('user-typed caption')
  })

  it('writes failed status + error message when the provider throws, without retrying', async () => {
    const { annotation } = await seedBriefingAndNote('eo-ocr-fail')
    mockS3()
    const ocr = vi
      .spyOn(service.app.get(OcrService), 'process')
      .mockRejectedValue(new Error('textract_down'))

    const attachmentId = await uploadAndSettle(annotation.id, 'eo-ocr-fail')

    expect(ocr).toHaveBeenCalledOnce()
    const row = await service.prisma.annotationNoteAttachment.findUnique({
      where: { id: attachmentId },
    })
    expect(row?.ocrStatus).toBe(OcrStatus.failed)
    expect(row?.ocrError).toBe('textract_down')
  })

  it('runs OCR once when the upload is completed twice', async () => {
    const { annotation } = await seedBriefingAndNote('eo-ocr-idem')
    mockS3()
    const ocr = mockOcr('detected once')

    const presign = await service.client.post(
      `/v1/annotations/${annotation.id}/note/attachments/presign`,
      validPresign,
      orgHeader('eo-ocr-idem'),
    )
    const attachmentId = presign.data.attachment_id
    const completeUrl = `/v1/annotations/${annotation.id}/note/attachments/${attachmentId}/complete`
    const [first, second] = await Promise.all([
      service.client.post(completeUrl, {}, orgHeader('eo-ocr-idem')),
      service.client.post(completeUrl, {}, orgHeader('eo-ocr-idem')),
    ])
    expect([first.status, second.status]).toContain(204)
    await service.jobs.settle()

    expect(ocr).toHaveBeenCalledOnce()
    const row = await service.prisma.annotationNoteAttachment.findUnique({
      where: { id: attachmentId },
    })
    expect(row?.ocrText).toBe('detected once')
  })
})
