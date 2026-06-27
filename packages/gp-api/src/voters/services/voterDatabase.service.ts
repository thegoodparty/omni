import { Injectable, OnModuleDestroy, StreamableFile } from '@nestjs/common'
import { Pool } from 'pg'
import { to as copyTo } from 'pg-copy-streams'
import { Transform } from 'stream'
import { HEADER_MAPPING } from '../constants/headerMapping.const'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { GetVoterFileSchema } from '../voterFile/schemas/GetVoterFile.schema'
import { PinoLogger } from 'nestjs-pino'
import { requireEnv } from 'src/shared/util/env.util'
import { neutralizeCsvFormula } from 'src/shared/util/csv.util'

const VOTER_DATASTORE = requireEnv('VOTER_DATASTORE')

@Injectable()
export class VoterDatabaseService implements OnModuleDestroy {
  private readonly pool: Pool

  constructor(
    private readonly slack: SlackService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VoterDatabaseService.name)
    this.pool = new Pool({
      connectionString: VOTER_DATASTORE,
      // Preview shares the dev voter cluster across every PR stack; cap the
      // pool so 25+ previews don't exhaust it (pg defaults to max 10).
      max: process.env.IS_PREVIEW === 'true' ? 5 : undefined,
    })
  }

  onModuleDestroy() {
    this.pool.end()
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    queryString: string,
  ) {
    return this.pool.query<R>(queryString)
  }

  async csvStream(
    queryString: string,
    fileName: string = 'people',
    selectedColumns?: GetVoterFileSchema['selectedColumns'],
  ) {
    const client = await this.pool.connect()

    // Build the header mapping
    const headerMapping = { ...HEADER_MAPPING }
    if (selectedColumns?.length) {
      selectedColumns.forEach((col) => {
        if (col.label) {
          headerMapping[col.db] = neutralizeCsvFormula(col.label)
        }
      })
    }

    // Define the mapping of old headers to new headers
    let isFirstChunk = true
    const transformHeaders = new Transform({
      objectMode: true,
      transform(chunk: Buffer, _encoding, callback) {
        let data: string = chunk.toString()
        if (isFirstChunk) {
          isFirstChunk = false
          // Replace headers on the first chunk. Use the function-replacer form
          // so `$`-sequences in a user-supplied label (e.g. `$&`, `$1`) stay
          // literal instead of being expanded as replacement patterns.
          for (const [oldHeader, newHeader] of Object.entries(headerMapping)) {
            data = data.replace(oldHeader, () => newHeader)
          }
        }
        callback(null, data)
      },
    })

    const stream = client
      .query(copyTo(`COPY(${queryString}) TO STDOUT WITH CSV HEADER`))
      .pipe(transformHeaders)
      .on('error', async (err) => {
        this.logger.error(err, 'Error in stream:')
        await this.slack.errorMessage({
          message: 'Error in stream:',
          error: err,
        })
        throw err
      })
      .on('end', async () => {
        client.release()
      })

    return new StreamableFile(stream, {
      type: 'text/csv',
      disposition: `attachment; filename="${fileName}.csv"`,
    })
  }

  async csvReadableStream(
    queryString: string,
    selectedColumns?: GetVoterFileSchema['selectedColumns'],
  ) {
    const client = await this.pool.connect()

    // Build the header mapping
    const headerMapping = { ...HEADER_MAPPING }
    if (selectedColumns?.length) {
      selectedColumns.forEach((col) => {
        if (col.label) {
          headerMapping[col.db] = neutralizeCsvFormula(col.label)
        }
      })
    }

    // Define the mapping of old headers to new headers
    let isFirstChunk = true
    const transformHeaders = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        let data: string = chunk.toString()
        if (isFirstChunk) {
          isFirstChunk = false
          // Replace headers on the first chunk. Use the function-replacer form
          // so `$`-sequences in a user-supplied label (e.g. `$&`, `$1`) stay
          // literal instead of being expanded as replacement patterns.
          for (const [oldHeader, newHeader] of Object.entries(headerMapping)) {
            data = data.replace(oldHeader, () => newHeader)
          }
        }
        callback(null, data)
      },
    })

    const stream = client
      .query(copyTo(`COPY(${queryString}) TO STDOUT WITH CSV HEADER`))
      .pipe(transformHeaders)
      .on('error', async (err) => {
        this.logger.error(err, 'Error in stream:')
        await this.slack.errorMessage({
          message: 'Error in stream:',
          error: err,
        })
        client.release()
        throw err
      })
      .on('end', async () => {
        client.release()
      })

    return stream
  }
}
