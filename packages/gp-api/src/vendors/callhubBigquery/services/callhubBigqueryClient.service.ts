import { BigQuery } from '@google-cloud/bigquery'
import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { CallhubBigqueryConfig } from '../config/callhubBigqueryConfig'
import {
  BigqueryErrorHandlingService,
  isPermanentBigqueryError,
} from './bigqueryErrorHandling.service'

// The values a BigQuery named parameter accepts. Named parameters are the ONLY
// way values enter a query here — never string-concatenate a value into SQL.
export type BigqueryParamValue =
  | string
  | number
  | boolean
  | Date
  | null
  | BigqueryParamValue[]

export interface BigqueryQueryOptions {
  // Validate the query and report its byte estimate without running it or
  // returning rows. Handy for the probe and for costing a query before we trust
  // it in a billing path.
  dryRun?: boolean
}

const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// Pure infrastructure: a lazily-constructed, READ-ONLY BigQuery client and a
// single parameterized `query`. No DML/DDL helpers exist, and no count / billing
// / business logic lives here — that belongs to the (still-blocked) results
// reader. The client is built on first use, not at construction, so this module
// stays inert until something actually queries (config is asserted at use).
@Injectable()
export class CallhubBigqueryClientService extends CallhubBigqueryConfig {
  private client?: BigQuery

  constructor(
    protected readonly logger: PinoLogger,
    private readonly errorHandling: BigqueryErrorHandlingService,
  ) {
    super(logger)
  }

  private getClient(): BigQuery {
    if (!this.client) {
      this.client = new BigQuery(this.clientOptions())
    }
    return this.client
  }

  // Runs a parameterized read. Retries only the TRANSIENT classes (429 / 5xx /
  // network) with a short bounded backoff — a permanent error (auth, notFound,
  // bad SQL) never retries. Reads have no side effect, so retry-on-transient
  // cannot double-bill anything; the bound is there so a persistent transient
  // failure still surfaces promptly.
  async query<T>(
    sql: string,
    params?: Record<string, BigqueryParamValue>,
    options?: BigqueryQueryOptions,
  ): Promise<T[]> {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const [rows] = await this.getClient().query({
          query: sql,
          params,
          useLegacySql: false,
          dryRun: options?.dryRun ?? false,
        })
        // BigQuery types every row as `any`; T is the caller's asserted row
        // shape at this trust boundary. Callers Zod-parse when they need a
        // runtime guarantee (the pattern the vendor HTTP services use).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return rows as T[]
      } catch (error) {
        lastError = error
        if (isPermanentBigqueryError(error) || attempt === MAX_RETRIES) {
          return this.errorHandling.handleQueryError({
            error,
            logger: this.logger,
          })
        }
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
      }
    }
    return this.errorHandling.handleQueryError({
      error: lastError,
      logger: this.logger,
    })
  }
}
