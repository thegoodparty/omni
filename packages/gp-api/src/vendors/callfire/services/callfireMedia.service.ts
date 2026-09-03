import { BadRequestException, Injectable } from '@nestjs/common'
import FormData from 'form-data'
import { PinoLogger } from 'nestjs-pino'
import {
  CALLFIRE_SOUND_MIME_TYPES,
  CallfireCampaignSoundSchema,
} from '../schemas/callfireMedia.schema'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

const UPLOAD_SOUND_PATH = '/campaigns/sounds/files'
// A robocall clip is ≤60s; this generous byte ceiling only guards against an
// absurd upload.
const MAX_FILE_SIZE = 25 * 1024 * 1024

interface UploadSoundParams {
  file: Buffer
  fileName: string
  mimeType: string
}

// CallFire does not ingest a URL — the audio bytes must be POSTed as
// multipart. Callers download the recording from our S3 bucket and hand the
// buffer here. Returns the broadcast sound id used to attach the audio to a
// voice broadcast.
@Injectable()
export class CallfireMediaService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallfireHttpService,
    private readonly errorHandling: CallfireErrorHandlingService,
  ) {
    this.logger.setContext(CallfireMediaService.name)
  }

  async uploadSound(params: UploadSoundParams): Promise<{ mediaId: string }> {
    const allowed: readonly string[] = CALLFIRE_SOUND_MIME_TYPES
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

    try {
      const data = await this.http.post(UPLOAD_SOUND_PATH, form, {
        headers: form.getHeaders(),
        maxBodyLength: MAX_FILE_SIZE,
        maxContentLength: MAX_FILE_SIZE,
      })
      const sound = CallfireCampaignSoundSchema.parse(data)
      return { mediaId: sound.id }
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire sound upload failed',
      })
    }
  }
}
