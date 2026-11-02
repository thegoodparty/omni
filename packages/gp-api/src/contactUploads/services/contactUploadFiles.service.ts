import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ContactUpload } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'

export type ContactUploadFile = Pick<
  ContactUpload,
  'organizationSlug' | 'fileKey'
>

export const CONTACT_UPLOAD_FILE_SELECT = {
  organizationSlug: true,
  fileKey: true,
} as const

@Injectable()
export class ContactUploadFilesService extends createPrismaBase(
  MODELS.ContactUpload,
) {
  constructor(private readonly s3: S3Service) {
    super()
  }

  async deleteFiles(files: ContactUploadFile[]): Promise<void> {
    if (files.length === 0) return
    const bucket = process.env.CONTACT_UPLOADS_BUCKET
    if (!bucket) {
      throw new ServiceUnavailableException(
        'CONTACT_UPLOADS_BUCKET is not configured',
      )
    }
    const slugs = new Set(files.map((file) => file.organizationSlug))
    for (const organizationSlug of slugs) {
      const keys = files
        .filter((file) => file.organizationSlug === organizationSlug)
        .map((file) => file.fileKey)
      try {
        await this.s3.deleteAllObjectVersions(bucket, keys)
      } catch (err) {
        this.logger.error(
          { err, organizationSlug },
          'Failed to delete contact upload files',
        )
        throw err
      }
    }
  }
}
