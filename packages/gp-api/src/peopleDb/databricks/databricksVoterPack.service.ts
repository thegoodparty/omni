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

// A district is drained in many chunks and the whole build dies with any one
// of them, so the odds of losing a pack are the per-chunk failure rate
// multiplied by the chunk count — a transient blip that would be invisible on
// a single request is close to routine across a 698,649-row scan. Three
// attempts rather than more because the failure this exists for is a stale
// pooled socket, which the immediate retry already resolves; anything still
// failing on the third go is not transient, and the user is waiting.
const CHUNK_FETCH_ATTEMPTS = 3

// Linear, and short. The client holds the whole build open while this waits,
// under a heartbeat that keeps the gateway from hanging up, so the budget here
// is a fraction of the drain rather than the usual exponential ladder.
const CHUNK_RETRY_BACKOFF_MS = 250

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

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
      // The next chunk's link and download are started BEFORE the current one
      // is parsed, so the network and the CSV parse overlap instead of taking
      // turns. Drained strictly in series, a 698,649-row district measured
      // 22.6s of drain against 736ms of query -- of which ~6.5s was link round
      // trips waiting on nothing. Two chunks in memory rather than one.
      let chunk: PeopleDbxCsvChunk | null = firstChunk
      let body = this.readChunk(chunk)
      let ahead: Promise<PeopleDbxCsvChunk> | null = null
      try {
        while (chunk && !signal?.aborted) {
          ahead = chunk.nextChunkLink
            ? this.client.fetchCsvChunk(chunk.nextChunkLink)
            : null
          await this.parseChunk(await body, encoder)
          chunk = ahead ? await ahead : null
          ahead = null
          body = chunk
            ? this.readChunk(chunk)
            : Promise.resolve(Buffer.alloc(0))
        }
      } finally {
        // Both reads are hoisted so this can reach either one still in flight
        // when the loop leaves early: a loop-scoped `ahead` is unreachable once
        // `await body` has thrown, and its rejection would go unhandled.
        void body.catch(() => undefined)
        void ahead?.catch(() => undefined)
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

  private async readChunk(chunk: PeopleDbxCsvChunk): Promise<Buffer> {
    let lastError: unknown

    for (let attempt = 0; attempt < CHUNK_FETCH_ATTEMPTS; attempt++) {
      if (attempt > 0) await delay(CHUNK_RETRY_BACKOFF_MS * attempt)

      let response: Response
      try {
        response = await fetch(chunk.externalLink)
      } catch (err) {
        // A rejected fetch is a transport failure, not an answer: the socket
        // closed, DNS blipped, the TLS handshake died. Retried rather than
        // raised because the overwhelmingly common one here is a keep-alive
        // race — chunks are downloaded with a CSV parse in between, so a
        // pooled connection sits idle long enough for the storage host to
        // close it while undici still believes it is open, and the next
        // request onto that socket fails as "other side closed".
        lastError = err
        continue
      }

      if (response.ok) return Buffer.from(await response.arrayBuffer())

      // A 5xx is the storage host having a moment and is worth asking again.
      // A 4xx is an answer — most often the ~15 minute presigned expiry, which
      // no number of retries will talk round, and a long multi-chunk build can
      // genuinely reach.
      lastError = new PeopleDbxUnavailableError(
        `CSV chunk fetch failed with ${response.status}`,
      )
      if (response.status < 500) break
    }

    // Classified, not bare, whichever way it failed. A plain Error escapes
    // build()'s catch unlogged and lands as a 500, which reads as a bug in the
    // pack rather than the upstream fetch failure it is.
    throw lastError instanceof PeopleDbxUnavailableError
      ? lastError
      : new PeopleDbxUnavailableError(
          `CSV chunk fetch failed: ${errorMessage(lastError)}`,
        )
  }

  private async parseChunk(body: Buffer, encoder: PackEncoder): Promise<void> {
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
