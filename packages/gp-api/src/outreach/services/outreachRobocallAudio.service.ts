import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  RobocallAudioPresignRequest,
  RobocallAudioPresignResponse,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { S3Service } from '@/vendors/aws/services/s3.service'

const UPLOAD_URL_EXPIRES_IN = 600

// Filename extension per allowed content type — only used to make the stored
// object recognizable; the object's ContentType is set from the request.
const EXTENSION_BY_TYPE: Record<
  RobocallAudioPresignRequest['contentType'],
  string
> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
}

@Injectable()
export class OutreachRobocallAudioService {
  private readonly bucket: string

  constructor(
    private readonly s3: S3Service,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachRobocallAudioService.name)
    const bucket = process.env.ROBOCALL_AUDIO_BUCKET
    if (!bucket) {
      throw new Error('ROBOCALL_AUDIO_BUCKET is not configured')
    }
    this.bucket = bucket
  }

  // Stateless: the key is returned for the client to hold and persist against
  // the send in a later step. Nothing is written server-side here.
  async createUploadUrl(
    input: RobocallAudioPresignRequest,
    campaignId: number,
  ): Promise<RobocallAudioPresignResponse> {
    const key = `robocall/${campaignId}/${randomUUID()}.${
      EXTENSION_BY_TYPE[input.contentType]
    }`

    const uploadUrl = await this.s3.getSignedUrlForUpload(this.bucket, key, {
      expiresIn: UPLOAD_URL_EXPIRES_IN,
      contentType: input.contentType,
    })

    return { uploadUrl, key, expiresIn: UPLOAD_URL_EXPIRES_IN }
  }
}
