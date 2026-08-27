import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Readable } from 'node:stream'
import csvParser from 'csv-parser'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import {
  contactsMadeToBytes,
  PackEncoder,
  PackRow,
  statusesToBytes,
} from '../utils/packEncoder.utils'
import { buildPackSql, PACK_CSV_COLUMNS } from './databricksVoterSql.util'
import { DatabricksVoterService } from './databricksVoter.service'
import {
  PeopleDbxStatementClient,
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
  type PeopleDbxCsvChunk,
} from './peopleDbxStatement.client'

const SCAN_TIMEOUT_MESSAGE =
  'The voter map took too long to build. Please try again.'

const UNAVAILABLE_MESSAGE =
  'Voter data is temporarily unavailable, so the voter map could not be ' +
  'built. This is a connection problem, not an empty district.'

const NUMERIC_COLUMNS = new Set<string>([
  'Age_Int',
  'Estimated_Income_Amount_Int',
])

const BOOLEAN_COLUMNS = new Set<string>([
  'registered',
  'hasCellPhone',
  'hasLandline',
])

// Every value arrives as text. A SQL NULL was coalesced to '' by the
// projection, so '' is the null case rather than an ambiguous literal `null`.
const toPackRow = (record: Record<string, string>): PackRow => {
  const row: Record<string, string | number | boolean | null> = {
    id: record.id ?? '',
    lat: Number(record.lat),
    lng: Number(record.lng),
    hhKey: record.hhKey ?? '',
  }
  for (const column of PACK_CSV_COLUMNS) {
    if (column === 'id' || column === 'lat' || column === 'lng') continue
    if (column === 'hhKey') continue
    const value = record[column] ?? ''
    row[column] = BOOLEAN_COLUMNS.has(column)
      ? value === 'true'
      : value === ''
        ? null
        : NUMERIC_COLUMNS.has(column)
          ? Number(value)
          : value
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return row as PackRow
}

@Injectable()
export class DatabricksVoterPackService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly client: PeopleDbxStatementClient,
    private readonly voters: DatabricksVoterService,
  ) {
    this.logger.setContext(DatabricksVoterPackService.name)
  }

  // The one voter read that drains a whole district, so it goes out through
  // EXTERNAL_LINKS + CSV rather than the inline JSON path every other query
  // uses: `PeopleDbxStatementClient.query` accumulates every chunk before it
  // returns, which for 600k rows is the unbounded materialization the Postgres
  // cursor exists to avoid. One chunk is read, parsed into the SoA encoder,
  // and dropped before the next link is requested.
  async build(
    request: DoorKnockingPackRequest,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const district = await this.voters.resolveDistrict(request.districtId)
    const encoder = new PackEncoder(
      statusesToBytes(request.knockStatuses ?? []),
      contactsMadeToBytes(request.contactsMade),
    )

    try {
      const { firstChunk } = await this.client.startCsvExport(
        buildPackSql({ district }),
      )
      let chunk: PeopleDbxCsvChunk | null = firstChunk
      while (chunk && !signal?.aborted) {
        await this.pumpChunk(chunk, encoder)
        chunk = chunk.nextChunkLink
          ? await this.client.fetchCsvChunk(chunk.nextChunkLink)
          : null
      }
    } catch (err) {
      if (err instanceof PeopleDbxTimeoutError) {
        this.logger.error({ err }, 'databricks pack scan exceeded its ceiling')
        throw new GatewayTimeoutException(SCAN_TIMEOUT_MESSAGE)
      }
      if (err instanceof PeopleDbxUnavailableError) {
        this.logger.error({ err }, 'databricks voter data is unreachable')
        throw new BadGatewayException(UNAVAILABLE_MESSAGE)
      }
      throw err
    }

    return encoder.toBuffer(new Date().toISOString())
  }

  private async pumpChunk(
    chunk: PeopleDbxCsvChunk,
    encoder: PackEncoder,
  ): Promise<void> {
    const response = await fetch(chunk.externalLink)
    if (!response.ok) {
      // Classified, not bare: presigned chunk links expire in ~15 minutes, so
      // a long multi-chunk build can genuinely lose one mid-scan. A plain
      // Error escapes build()'s catch unlogged and lands as a 500, which reads
      // as a bug in the pack rather than the upstream fetch failure it is.
      throw new PeopleDbxUnavailableError(
        `CSV chunk fetch failed with ${response.status}`,
      )
    }
    const body = Buffer.from(await response.arrayBuffer())

    // Headers are pinned to the projection rather than read off the file, so
    // a column's position is decided by the SELECT and not by parsing. Only
    // chunk 0 carries a header line (which is what lets the CSV download
    // concatenate chunks), so the header row is dropped by value rather than
    // by chunk index — cheaper than threading the index through and correct
    // if that ever changes.
    await new Promise<void>((resolve, reject) => {
      Readable.from(body)
        .pipe(csvParser({ headers: [...PACK_CSV_COLUMNS] }))
        .on('data', (record: Record<string, string>) => {
          if (record.id === 'id') return
          encoder.add(toPackRow(record))
        })
        .on('end', resolve)
        .on('error', reject)
    })
  }
}
