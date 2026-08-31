import { Injectable } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { DatabricksVoterDownloadService } from '../databricks/databricksVoterDownload.service'
import { DownloadPeopleDTO } from '../schemas/people.schema'

@Injectable()
export class VoterDownloadService {
  constructor(
    private readonly databricksDownload: DatabricksVoterDownloadService,
  ) {}

  // No read-log line here, unlike every other voter read. An export is a
  // stream measured in minutes and gigabytes, so per-request latency is not
  // the number that describes it, and the statement ids a cold-start
  // attribution wants are the chunk fetches rather than one submit.
  async streamPeopleCsv(
    dto: DownloadPeopleDTO,
    res: FastifyReply,
    responseOptions?: {
      filename?: string
      extraHeaders?: Record<string, string>
    },
  ): Promise<void> {
    return this.databricksDownload.streamPeopleCsv(dto, res, responseOptions)
  }
}
