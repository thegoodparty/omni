import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import {
  EMAIL_IMAGE_MAX_BYTES,
  EMAIL_SAMPLE_IMAGE_URLS,
  EmailImagePresignRequest,
  EmailImagePresignResponse,
} from '@goodparty_org/contracts'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { EmailSendScope } from '../emailOutreach.types'

const UPLOAD_URL_EXPIRES_IN = 600
const IMAGE_FOLDER = 'email-images'

const EXTENSION_BY_TYPE: Record<
  EmailImagePresignRequest['contentType'],
  string
> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
}

const imagePrefix = (organizationSlug: string): string =>
  `https://${ASSET_DOMAIN}/${IMAGE_FOLDER}/${organizationSlug}/`

const SAMPLE_IMAGE_URLS: string[] = Object.values(EMAIL_SAMPLE_IMAGE_URLS)

// A saved image must be one this module presigned for the same organization,
// or one of the sample images the gallery and examples use.
export const assertEmailImageUrl = (
  scope: EmailSendScope,
  imageUrl: string | undefined,
): void => {
  if (
    imageUrl !== undefined &&
    !SAMPLE_IMAGE_URLS.includes(imageUrl) &&
    !new RegExp(
      `^${imagePrefix(scope.organizationSlug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9a-f-]{36}\\.(jpg|png|gif)$`,
    ).test(imageUrl)
  ) {
    throw new BadRequestException('Upload the image through the email composer')
  }
}

@Injectable()
export class OutreachEmailImageService {
  constructor(private readonly s3: S3Service) {}

  // Stateless: the client holds the public URL until it saves the draft.
  async createUploadUrl(
    scope: EmailSendScope,
    input: EmailImagePresignRequest,
  ): Promise<EmailImagePresignResponse> {
    const key = `${IMAGE_FOLDER}/${scope.organizationSlug}/${randomUUID()}.${
      EXTENSION_BY_TYPE[input.contentType]
    }`
    const { url, fields } = await this.s3.createPresignedUpload(
      ASSET_DOMAIN,
      key,
      {
        expiresIn: UPLOAD_URL_EXPIRES_IN,
        contentType: input.contentType,
        maxBytes: EMAIL_IMAGE_MAX_BYTES,
      },
    )
    return {
      url,
      fields,
      publicUrl: `${imagePrefix(scope.organizationSlug)}${key.split('/').pop()}`,
      expiresIn: UPLOAD_URL_EXPIRES_IN,
    }
  }
}
