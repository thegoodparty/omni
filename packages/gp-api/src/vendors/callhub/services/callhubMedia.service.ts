import { BadRequestException, Injectable } from '@nestjs/common'
import FormData from 'form-data'
import { PinoLogger } from 'nestjs-pino'
import {
  CALLHUB_MEDIA_MIME_TYPES,
  CreateMediaResponse,
  CreateMediaResponseSchema,
} from '../schemas/callhubMedia.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const UPLOAD_PATH = '/v1/media/upload/'
// CallHub caps uploaded audio at 40 minutes; a robocall clip is ≤60s, so this
// generous byte ceiling only guards against an absurd upload.
const MAX_FILE_SIZE = 25 * 1024 * 1024

interface UploadMediaParams {
  file: Buffer
  fileName: string
  mimeType: string
  // Optional CallHub-side label (≤150 chars).
  name?: string
}

// CallHub does not ingest a URL — the audio bytes must be POSTed as
// multipart. Callers download the recording from our S3 bucket and hand the
// buffer here.
@Injectable()
export class CallhubMediaService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubMediaService.name)
  }

  async uploadMedia(params: UploadMediaParams): Promise<CreateMediaResponse> {
    const allowed: readonly string[] = CALLHUB_MEDIA_MIME_TYPES
    if (!allowed.includes(params.mimeType)) {
      throw new BadRequestException(
        `Unsupported audio type ${params.mimeType}; allowed: ${allowed.join(', ')}`,
      )
    }
    if (params.file.length > MAX_FILE_SIZE) {
      throw new BadRequestException('Audio file is too large to upload')
    }

    const form = new FormData()
    form.append('file', params.file, {
      filename: params.fileName,
      contentType: params.mimeType,
      knownLength: params.file.length,
    })
    if (params.name) form.append('name', params.name.slice(0, 150))

    try {
      const data = await this.http.post(UPLOAD_PATH, form, {
        headers: form.getHeaders(),
        maxBodyLength: MAX_FILE_SIZE,
        maxContentLength: MAX_FILE_SIZE,
      })
      return CreateMediaResponseSchema.parse(data)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub media upload failed',
      })
    }
  }
}
